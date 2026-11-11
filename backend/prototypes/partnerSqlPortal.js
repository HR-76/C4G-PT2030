'use strict';

// Isolated candidate, never imported by runtime composition/routes/startup.
// Requires the existing prepared transaction, role/GUCs and authority ports.
// A real PostgreSQL gate must verify READ COMMITTED and portal cleanup before
// integration. This module never opens a connection or owns the transaction.
const { randomUUID, createHash } = require('node:crypto');
const { canonicalize } = require('../src/organizationalProfile/canonicalization');
const { fail } = require('../src/applications/contracts');
const { resource } = require('../src/applications/repository');
const { isTrustedRuntimeFailure } = require('../src/security/tenantRuntimeErrors');

// Deliberately mirrors the private v1 semantics in applications/partners.js:
// extraction into shared runtime code is outside this prototype's scope.
function projection(row) {
  return { id: row.partner_id, ...row.body, people: row.body.people.filter(person => person.active),
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
    application_id: row.application_id, application_title: row.application_title,
    application_status: row.application_status, opportunity_title: row.opportunity_title };
}

function pageDigest(rows) {
  const hash = createHash('sha256').update('[');
  for (let index = 0; index < rows.length; index++) {
    if (index) hash.update(',');
    hash.update(canonicalize([rows[index]]).slice(1, -1));
  }
  return hash.update(']').digest('hex');
}

function resultPage(visible, input, cursor, organizationId, subjectId) {
  const countries = [...new Set(visible.map(row => row.country).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'));
  const needle = input.q.toLocaleLowerCase('pt');
  const matches = visible.filter(row => (!input.country || row.country === input.country)
    && (!input.person_role || row.people.some(person => person.role === input.person_role))
    && (!needle || [row.entity_name, row.country, row.research_area_interest, row.responsible_person, row.contact, row.email,
      ...row.people.flatMap(person => [person.name, person.research_area, person.contact, person.email])]
      .some(value => value.toLocaleLowerCase('pt').includes(needle))));
  matches.sort((a, b) => a.entity_name.localeCompare(b.entity_name, 'pt') || a.id.localeCompare(b.id));
  const { cursor: token, ...filters } = input;
  const binding = { organizationId, subjectId, route: 'partners-browse', ...filters };
  const digest = pageDigest(matches), position = token ? cursor.openCursor(token, binding) : null;
  if (position && (!Number.isSafeInteger(position.offset) || position.offset < 0 || position.offset % 25 || position.digest !== digest)) fail('INVALID_CURSOR');
  const offset = position?.offset || 0, pointer = value => cursor.cursor({ offset: value, digest }, binding);
  return { items: matches.slice(offset, offset + 25), total: matches.length, page: offset / 25 + 1,
    nextCursor: offset + 25 < matches.length ? pointer(offset + 25) : null,
    previousCursor: offset ? pointer(Math.max(0, offset - 25)) : null, countries };
}

function createPartnersPortalRepository({ organizationId, actor, protect, authorize, cursor }) {
  async function partnersBrowse(client, _id, input) {
    await protect({ operationCode: 'APPLICATION_READ', resource: resource(organizationId, organizationId) });
    let usable = true, opened = false;
    async function query(sql, values) {
      try { return await client.query(sql, values); }
      catch (error) {
        // A failed command may have aborted the transaction or lost its lease.
        // No probing/retry/CLOSE: only the outer owner may roll back/discard.
        usable = false;
        if (isTrustedRuntimeFailure(error)) throw error;
        fail('SERVICE_UNAVAILABLE');
      }
    }
    async function allowed(operation, target) {
      try { return await authorize(operation, target); }
      catch (error) {
        // The authority port can conceal a failed team/audit SQL command.
        usable = false;
        throw error;
      }
    }
    if (!(await query("SELECT to_regclass('opportunity_catalog.application_partner') AS relation")).rows[0].relation) fail('SCHEMA_UPGRADE_REQUIRED');
    const name = `c4g_partner_browse_${randomUUID().replaceAll('-', '')}`;
    if (!/^c4g_partner_browse_[a-f0-9]{32}$/.test(name)) fail('SERVICE_UNAVAILABLE');
    async function close() { await query(`CLOSE ${name}`); opened = false; }
    try {
      await query(`DECLARE ${name} NO SCROLL CURSOR WITHOUT HOLD FOR
        SELECT p.*,a.title AS application_title,a.status AS application_status,a.opportunity_id,a.evaluation_id,
        COALESCE(a.central_snapshot->>'title',o.title) AS opportunity_title FROM opportunity_catalog.application_partner p
        JOIN opportunity_catalog.application a USING(organization_id,application_id)
        LEFT JOIN opportunity_catalog.opportunity o ON o.organization_id=a.organization_id AND o.opportunity_id=a.opportunity_id
        WHERE p.organization_id=$1 AND p.active ORDER BY p.partner_id LIMIT 10001`, [organizationId]);
      opened = true;
      const visible = [];
      let examined = 0;
      for (;;) {
        const rows = (await query(`FETCH FORWARD ${examined === 10000 ? 1 : 100} FROM ${name}`)).rows;
        if (examined === 10000) {
          if (rows.length) fail('LIMIT_EXCEEDED');
          break;
        }
        for (const row of rows) {
          examined++;
          if (!await allowed('APPLICATION_READ', resource(row.application_id, organizationId))
            || !await allowed('OPPORTUNITY_READ', resource(row.opportunity_id || organizationId, organizationId, 'OPPORTUNITY'))
            || row.evaluation_id && !await allowed('F14_PREQUALIFICATION_READ', resource(row.evaluation_id, organizationId, 'PREQUALIFICATION_EVALUATION'))) continue;
          visible.push(projection(row));
        }
        if (rows.length < 100) break;
      }
      // No early filtering/canonicalization: retain authority/error precedence.
      const result = resultPage(visible, input, cursor, organizationId, actor.id);
      await close();
      return result;
    } catch (primary) {
      if (opened && usable) {
        // Only local processing failed. The prepared client's own lease check
        // still applies if it expires before cleanup; never bypass that check.
        try { await close(); } catch { /* Preserve primary; outer rollback remains mandatory. */ }
      }
      throw primary;
    }
  }
  return Object.freeze({ partnersBrowse });
}

module.exports = { createPartnersPortalRepository };
