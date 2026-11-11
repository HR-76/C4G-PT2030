'use strict';
const { coverage, completion, fail } = require('./pq1UiContracts');
const { loadEditorialRevision } = require('./editorialSource');
function project(content) {
  const clean = value => Array.isArray(value) ? value.map(clean) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([k]) => !/digest|authorizationEvidence|ownerOrganizationId/i.test(k)).map(([k,v])=>[k,clean(v)])) : value;
  return clean({ assertions:content.assertions,experiences:content.experiences,links:content.links,verifications:content.verifications,observedAt:content.observedAt });
}
function createPq1UiRepository({ organizationId, tokens, clock = () => new Date() }) {
  async function labels(client, items, locale = 'pt-PT') {
    const result = [];
    for (const item of items) {
      let conceptRef = null, label = null, labelLocale = null;
      if (item.knowledgeStatus === 'KNOWN') {
        const ref = item.conceptRef;
        if (!ref) fail('REFERENCE_UNAVAILABLE');
        const rows = (await client.query(`SELECT c.concept_id,c.scheme_id,c.release_id,r.release_version,l.label,l.locale
          FROM organization_profile.concept c JOIN organization_profile.catalog_release r USING(release_id)
          JOIN organization_profile.scheme s ON s.scheme_id=c.scheme_id AND s.release_id=c.release_id
          JOIN organization_profile.concept_label l ON l.concept_id=c.concept_id AND l.label_kind='PREFERRED'
          WHERE c.concept_id=$1 AND c.release_id=$2 AND c.scheme_id=$3 AND r.release_version=$4
          AND r.lifecycle='PUBLISHED' AND c.deprecated_at IS NULL AND s.scheme_code=$5
          AND (c.organization_id IS NULL OR c.organization_id=$6)
          AND l.locale IN ($7,r.provenance#>>'{governance,defaultLocale}') ORDER BY (l.locale=$7) DESC`,
        [ref.conceptId, ref.releaseId, ref.schemeId, ref.releaseVersion, item.domain, organizationId, locale])).rows;
        if (!rows.length || (rows.length > 1 && rows[0].locale === rows[1].locale)) fail('REFERENCE_UNAVAILABLE');
        const row = rows[0];
        conceptRef = { conceptId: row.concept_id, schemeId: row.scheme_id, releaseId: row.release_id, releaseVersion: row.release_version };
        label = row.label; labelLocale = row.locale;
      } else if (item.knowledgeStatus !== 'UNKNOWN') fail('REFERENCE_UNAVAILABLE');
      result.push({ itemId: item.itemId, itemVersionId: item.itemVersionId, domain: item.domain, knowledgeStatus: item.knowledgeStatus,
        conceptRef, label, labelLocale, factualStatus: 'UNVERIFIED' });
    }
    return result;
  }
  async function draft(client, id, revision = null) {
    const row = (await client.query(`SELECT d.draft_id,d.head_revision,d.lifecycle FROM organization_profile.profile_draft d
      JOIN organization_profile.profile_scope s USING(organization_id,profile_scope_id)
      WHERE d.organization_id=$1 AND d.draft_id=$2 AND s.scope_type='ORGANIZATION' AND s.scope_id IS NULL`, [organizationId, id])).rows[0];
    if (!row) fail('RESOURCE_NOT_AVAILABLE');
    const source = await loadEditorialRevision(client, organizationId, id, revision || Number(row.head_revision));
    const extracted = await require('./pq1Source').loadPq1Material(client, organizationId, source, clock().toISOString());
    return { draftId: id, revision: revision || Number(row.head_revision), lifecycle: row.lifecycle, items: await labels(client, extracted.content.items), ...project(extracted.content), coverage };
  }
  async function currentVerifications(client, content) {
    const observedAt = clock().toISOString(), ids = content.verifications.map(v=>v.verificationId);
    const events = (await client.query('SELECT * FROM organization_profile.pq1_verification_status_event WHERE organization_id=$1 AND verification_id=ANY($2::uuid[])',[organizationId,ids])).rows;
    return { currentObservedAt:observedAt,verifications:project(content).verifications.map(v=>{
      const event=events.find(e=>e.verification_id===v.verificationId);
      const revocation=event?{eventId:event.event_id,verificationId:event.verification_id,status:event.status,recordedAt:event.recorded_at.toISOString()}:null;
      return {...v,currentStatus:require('./pq1Material').verificationState(v,observedAt,revocation)};
    }) };
  }
  async function editorial(client, method, loaded, raw) {
    const candidate = loaded.candidate, version = loaded.version;
    let versionId = version?.version_id || null;
    if (!version) versionId = (await client.query('SELECT version_id FROM organization_profile.pq1_version WHERE organization_id=$1 AND candidate_id=$2', [organizationId, candidate.candidate_id])).rows[0]?.version_id || null;
    return { ...(method === 'candidate' ? { candidateId: candidate.candidate_id, state: 'SUBMITTED', sourceRevision: Number(candidate.source_revision), versionId }
      : { versionId, candidateId: candidate.candidate_id, state: raw.state, active: false }), items: await labels(client, raw.content.items), ...project(raw.content), ...await currentVerifications(client,raw.content), coverage, completion: completion(raw.completion) };
  }
  async function page(client, method, query, context, mayRead) {
    const { cursor, limit, ...filters } = query;
    const binding = { subjectId: context.actor.id, organizationId, route: method, filters };
    let position = cursor ? tokens.openCursor(cursor, binding) : null;
    const rows = [], wanted = limit + 1;
    // Bound the amount of work independently of disclosure. Insufficient budget
    // fails closed instead of exposing a cursor derived from denied resources.
    for (let scanned = 0; rows.length < wanted && scanned < 10000; scanned += 100) {
      let batch;
      if (method === 'catalog') {
        batch = (await client.query(`SELECT c.concept_id AS id,c.release_id,r.release_version,c.scheme_id,s.scheme_code AS domain
          FROM organization_profile.concept c JOIN organization_profile.catalog_release r USING(release_id)
          JOIN organization_profile.scheme s ON s.scheme_id=c.scheme_id AND s.release_id=c.release_id
          WHERE (c.organization_id IS NULL OR c.organization_id=$1) AND r.lifecycle='PUBLISHED' AND c.deprecated_at IS NULL
          AND s.scheme_code=$2 AND ($3::uuid IS NULL OR c.release_id=$3)
          AND ($4::uuid IS NULL OR (c.release_id,c.concept_id)>($4::uuid,$5::uuid)) ORDER BY c.release_id,c.concept_id LIMIT 100`,
        [organizationId, query.domain, query.releaseId || null, position?.[0] || null, position?.[1] || null])).rows;
      } else {
        const queries = {
          drafts: `SELECT d.draft_id AS id,d.head_revision,d.lifecycle FROM organization_profile.profile_draft d JOIN organization_profile.profile_scope s USING(organization_id,profile_scope_id) WHERE d.organization_id=$1 AND s.scope_type='ORGANIZATION' AND s.scope_id IS NULL AND ($2::uuid IS NULL OR d.draft_id>$2) ORDER BY d.draft_id LIMIT 100`,
          candidates: `SELECT c.candidate_id AS id,c.completion_record->>'result' AS completion_result,v.version_id FROM organization_profile.pq1_candidate c LEFT JOIN organization_profile.pq1_version v USING(organization_id,candidate_id) WHERE c.organization_id=$1 AND ($2::uuid IS NULL OR c.candidate_id>$2) ORDER BY c.candidate_id LIMIT 100`,
          versions: `SELECT v.version_id AS id,p.publication_id FROM organization_profile.pq1_version v LEFT JOIN organization_profile.pq1_publication p USING(organization_id,version_id) WHERE v.organization_id=$1 AND ($2::uuid IS NULL OR v.version_id>$2) ORDER BY v.version_id LIMIT 100`
        };
        batch = (await client.query(queries[method], [organizationId, position])).rows;
      }
      for (const row of batch) {
        position = method === 'catalog' ? [row.release_id, row.id] : row.id;
        if (!await mayRead(method === 'catalog' ? row.release_id : row.id)) continue;
        let item;
        if (method === 'drafts') item = { draftId: row.id, revision: Number(row.head_revision), lifecycle: row.lifecycle };
        if (method === 'candidates') item = { candidateId: row.id, state: 'SUBMITTED', completionResult: row.completion_result,
          versionId: row.version_id && await mayRead(row.version_id) ? row.version_id : null };
        if (method === 'versions') item = { versionId: row.id, state: row.publication_id ? 'PUBLISHED' : 'APPROVED', active: false };
        if (method === 'catalog') {
          const projected = (await labels(client, [{ itemId: row.id, itemVersionId: row.id, domain: row.domain, knowledgeStatus: 'KNOWN',
            conceptRef: { conceptId: row.id, releaseId: row.release_id, schemeId: row.scheme_id, releaseVersion: row.release_version } }], query.locale))[0];
          item = { conceptRef: projected.conceptRef, label: projected.label, labelLocale: projected.labelLocale };
        }
        rows.push({ item, position });
        if (rows.length === wanted) break;
      }
      if (batch.length < 100 || rows.length === wanted) return { items: rows.slice(0, limit).map(r => r.item), nextCursor: rows.length > limit ? tokens.cursor(rows[limit - 1].position, binding) : null };
    }
    fail('SERVICE_UNAVAILABLE');
  }
  return Object.freeze({ draft, editorial, page, labels });
}
module.exports = { createPq1UiRepository };
