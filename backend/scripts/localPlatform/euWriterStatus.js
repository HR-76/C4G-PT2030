'use strict';
// Read-only status of the EU (Funding & Tenders) writer on the local Central database. Changes nothing.
// Compares the writer configuration recorded in the database with the one the current code publishes,
// and counts what an out-of-date mapping would put under human review.
const { Pool } = require('pg');
const cfg = require('./config');

async function main() {
  const config = cfg.readConfig();
  if (config.port !== 5432 || config.centralDatabase !== 'c4g_central_dev') throw Object.assign(new Error('TARGET'), { code: 'LOCAL_TARGET_MISMATCH' });
  const pool = new Pool(cfg.connection(config, config.centralDatabase));
  try {
    const one = async sql => (await pool.query(sql)).rows;
    const code = require('../../src/fundingTenders/euWriter').euWriterConfiguration();
    const [control] = await one('SELECT state, fence, changed_at, eu_writer_mode, eu_writer_policy, eu_writer_mapping_digest FROM opportunity_catalog.eu_source_control_v2 ORDER BY changed_at DESC LIMIT 1');
    const migrations = (await one("SELECT version FROM public.c4g_schema_migration WHERE version >= '042' ORDER BY version")).map(row => row.version);
    const counts = {};
    for (const table of ['opportunity', 'provenance', 'source_identity_v2', 'funding_identity', 'funding_run', 'eu_source_control_receipt_v2']) {
      counts[table] = (await one(`SELECT count(*)::int AS n FROM opportunity_catalog.${table}`))[0].n;
    }
    const [runs] = await one(`SELECT count(*) FILTER (WHERE status NOT IN ('SUCCEEDED','FAILED','CANCELLED','COMPLETED'))::int AS unfinished, coalesce(sum(review_count),0)::int AS pending_review FROM opportunity_catalog.funding_run`);
    const registered = { mode: control?.eu_writer_mode ?? null, policy: control?.eu_writer_policy ?? null, mappingDigest: control?.eu_writer_mapping_digest ?? null };
    const current = { policy: code.policyVersion, mappingDigest: code.mappingDigest };
    const aligned = registered.policy === current.policy && registered.mappingDigest === current.mappingDigest;
    console.log(JSON.stringify({
      source: control ? { state: control.state, fence: Number(control.fence), changedAt: control.changed_at } : null,
      centralMigrations: migrations, counts, runs,
      writer: { registered: { ...registered, mappingDigest: registered.mappingDigest?.slice(0, 12) ?? null }, current: { ...current, mappingDigest: current.mappingDigest.slice(0, 12) }, aligned },
      euOpportunitiesAtRisk: counts.source_identity_v2,
      reading: aligned ? 'WRITER_ALIGNED' : 'WRITER_RECONFIGURATION_REQUIRED'
    }, null, 1));
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error.code || error.message || 'EU_WRITER_STATUS_FAILED'); process.exitCode = 1; });
