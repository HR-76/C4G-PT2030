'use strict';
// Read-only remediation inventory. No acceptance, source resume or SQL mutation.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('../backend/node_modules/pg');
const cfg = require('../backend/scripts/localPlatform/config');

async function main() {
  const config = cfg.readConfig();
  const pool = new Pool({ ...cfg.connection(config, config.centralDatabase), max: 1,
    options: '-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000' });
  const client = await pool.connect();
  let report;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const control = (await client.query("SELECT state,fence,eu_writer_mode FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS'")).rows[0];
    assert.equal(control?.state, 'QUIESCED');
    assert.equal(control.eu_writer_mode, 'CANONICAL_V2');
    const rows = (await client.query(`SELECT f.external_identifier,o.opportunity_id,o.current_revision_id,o.row_version,
      o.current_schema_version,f.source_review,
      (SELECT count(*)::int FROM opportunity_catalog.funding_candidate_v2 c
        WHERE c.external_identifier=f.external_identifier) AS candidate_archives,
      (SELECT count(*)::int FROM opportunity_catalog.eu_writer_decision_v2 d
        WHERE d.external_identifier=f.external_identifier AND d.decision='REVIEW') AS review_decisions
      FROM opportunity_catalog.funding_identity f
      JOIN opportunity_catalog.opportunity o USING(opportunity_id)
      WHERE f.external_identifier !~ '^(POCTEP|INTERREG_EUROPE):'
        AND f.last_source_fields->>'funderName'='European Commission'
      ORDER BY f.external_identifier`)).rows;
    const items = rows.map(row => ({ externalIdentifier: row.external_identifier,
      opportunityId: row.opportunity_id, currentRevisionId: row.current_revision_id,
      rowVersion: Number(row.row_version), schemaVersion: row.current_schema_version,
      sourceReview: row.source_review || null, candidateArchives: row.candidate_archives,
      reviewDecisions: row.review_decisions,
      proposedPath: row.current_schema_version === 2 ? 'RECONCILE_STALE_SOURCE_BASELINE'
        : row.candidate_archives && row.review_decisions ? 'AUTHENTICATED_V1_TO_V2_REVIEW'
        : 'FRESH_SOURCE_EVIDENCE_AND_REVIEW',
      decision: 'UNRESOLVED' }));
    assert.equal(items.length, 536);
    assert.equal(new Set(items.map(item => item.externalIdentifier)).size, items.length);
    const counts = Object.fromEntries([...new Set(items.map(item => item.proposedPath))]
      .sort().map(code => [code, items.filter(item => item.proposedPath === code).length]));
    report = { kind: 'eu-legacy-funder-remediation-inventory-v1', inspectedAt: new Date().toISOString(),
      readOnly: true, scope: 'Funding identities excluding POCTEP and Interreg Europe with legacy source label European Commission',
      sourceControl: control, count: items.length, counts, items,
      caveat: 'A candidate archive or review decision count does not authorize acceptance; revalidate exact archive, CAS and human authority before any mutation.' };
    await client.query('ROLLBACK');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); await pool.end(); }
  const folder = path.join(cfg.root, 'output', `eu-legacy-funder-inventory-${randomUUID()}`);
  fs.mkdirSync(folder, { recursive: false });
  fs.writeFileSync(path.join(folder, 'inventory.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const columns = ['externalIdentifier','opportunityId','currentRevisionId','rowVersion','schemaVersion','sourceReview','candidateArchives','reviewDecisions','proposedPath','decision'];
  const csvCell = value => {
    const raw = String(value ?? '');
    const safe = /^[=+@\-\t\r]/.test(raw) ? "'" + raw : raw;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  fs.writeFileSync(path.join(folder, 'queue.csv'), '\uFEFF' + [columns.join(','),
    ...report.items.map(item => columns.map(key => csvCell(item[key])).join(','))].join('\r\n') + '\r\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: 'PASS', count: report.count, counts: report.counts,
    evidence: path.relative(cfg.root, path.join(folder, 'inventory.json')).replaceAll('\\', '/'),
    queue: path.relative(cfg.root, path.join(folder, 'queue.csv')).replaceAll('\\', '/') }));
}
main().catch(error => { console.error(/^[A-Z0-9_]{3,100}$/.test(error.code || '') ? error.code : 'EU_LEGACY_FUNDER_INVENTORY_FAILED'); process.exitCode = 1; });
