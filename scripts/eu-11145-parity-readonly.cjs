'use strict';
// Fixed-ID, read-only parity check. No source resume, candidate acceptance or SQL writes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('../backend/node_modules/pg');
const cfg = require('../backend/scripts/localPlatform/config');
const { createSource, LIMITS } = require('../backend/src/fundingTenders/source');
const { compareSnapshotsV2 } = require('../backend/src/opportunities/v2/digests');

const ID = 'CASCADE:11145';
async function main() {
  const source = createSource({ fetchImpl: globalThis.fetch, enrichmentEnabled: true,
    canonicalV2Enabled: true, limits: { ...LIMITS, retries: 0, totalMs: 20000 } });
  const live = await source.lookup({ externalIdentifier: ID });
  assert.equal(live.outcome, 'FOUND');
  assert.equal(live.received, 1);
  const candidate = live.canonicalSnapshot, metadata = live.evidence.variants[0].metadata;
  assert.equal(metadata.budget?.[0], '120000');
  assert.equal(metadata.currency, undefined);
  assert.equal(candidate.financing.allocations.value[0].money.amount, '120000');
  assert.equal(candidate.financing.allocations.value[0].money.currency.state, 'NOT_FOUND');
  assert.equal(candidate.parties.value.find(p => p.role === 'DIRECT_AWARDER')?.name, 'Gnomon Informatics SA');
  assert.equal(candidate.schedule.deadlines.value.length, 7);
  assert.equal(Object.hasOwn(live.record.fields, 'funderName'), false);

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
    const row = (await client.query(`SELECT o.current_revision_id,r.snapshot,f.last_source_fields FROM opportunity_catalog.funding_identity f
      JOIN opportunity_catalog.opportunity o USING(opportunity_id)
      JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id
      WHERE f.external_identifier=$1`, [ID])).rows[0];
    assert.equal(row?.snapshot?.schemaVersion, 2);
    const compared = compareSnapshotsV2(row.snapshot, candidate);
    assert.equal(compared.changed, false);
    assert.deepEqual(compared.reasonCodes, []);
    const amount = (await client.query(`SELECT amount_canonical,amount::text AS amount,currency_state,currency_code,
      pg_typeof(amount)::text AS sql_type FROM opportunity_catalog.revision_allocation_v2 WHERE revision_id=$1`,
      [row.current_revision_id])).rows;
    assert.equal(amount.length, 1);
    assert.deepEqual(amount[0], { amount_canonical: '120000', amount: '120000.00000000',
      currency_state: 'NOT_FOUND', currency_code: null, sql_type: 'numeric' });
    const deadlines = (await client.query('SELECT payload FROM opportunity_catalog.revision_deadline_v2 WHERE revision_id=$1 ORDER BY ordinal',
      [row.current_revision_id])).rows.map(r => r.payload);
    assert.deepEqual(deadlines, row.snapshot.schedule.deadlines.value);
    assert.deepEqual(deadlines, candidate.schedule.deadlines.value);
    const legacyInventory = (await client.query(`SELECT
      count(*)::int AS total_count,
      count(*) FILTER (WHERE o.current_schema_version=1)::int AS v1_count,
      count(*) FILTER (WHERE o.current_schema_version=1 AND f.last_source_fields->>'funderName'='European Commission')::int AS v1_with_commission_label,
      count(*) FILTER (WHERE f.last_source_fields->>'funderName'='European Commission')::int AS commission_source_labels,
      count(*) FILTER (WHERE o.current_schema_version=2 AND f.last_source_fields->>'funderName'='European Commission')::int AS v2_with_stale_source_label
      FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id)
      WHERE f.external_identifier !~ '^(POCTEP|INTERREG_EUROPE):'`)).rows[0];
    report = { kind: 'eu-11145-live-db-parity-v1', observedAt: live.observedAt, externalIdentifier: ID,
      readOnly: true, sourceControl: { state: control.state, fence: control.fence, writerMode: control.eu_writer_mode },
      currentRevisionId: row.current_revision_id, liveEvidenceFingerprint: live.evidence.fingerprint,
      semanticParity: true, amountCanonical: amount[0].amount_canonical, sqlNumeric: amount[0].amount,
      currencyState: amount[0].currency_state, currencyCode: amount[0].currency_code,
      directAwarder: candidate.parties.value.find(p => p.role === 'DIRECT_AWARDER').name,
      cutOffCount: deadlines.length,
      staleLegacyFunder: row.last_source_fields?.funderName === 'European Commission',
      legacyInventory,
      historicalDataChanged: false };
    await client.query('ROLLBACK');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); await pool.end(); }
  const file = path.join(cfg.root, 'output', `eu-11145-parity-${randomUUID()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: 'PASS', evidence: path.relative(cfg.root, file).replaceAll('\\', '/'),
    amount: report.amountCanonical, sqlNumeric: report.sqlNumeric, currencyState: report.currencyState,
    cutOffCount: report.cutOffCount, staleLegacyFunder: report.staleLegacyFunder,
    legacyInventory: report.legacyInventory,
    source: report.sourceControl.state }));
}
main().catch(error => { console.error(/^[A-Z0-9_]{3,100}$/.test(error.code || '') ? error.code : 'EU_11145_PARITY_FAILED'); process.exitCode = 1; });
