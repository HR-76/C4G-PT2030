'use strict';
// Explicit, backed-up reconciliation of the native installation. No imports.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process'), { createHash } = require('node:crypto');
const { Pool } = require('pg'), cfg = require('./config');
const { reconcileFunding } = require('../../src/fundingTenders/reconciliation');
const { CASCADE_BASE } = require('../../src/fundingTenders/identity');
const out = path.join(cfg.root, 'output/funding-programmes');
async function histories(pool) {
  const result = {};
  for (const table of ['revision', 'provenance', 'idempotency_record', 'funding_observation', 'funding_run', 'funding_run_item'])
    result[table] = (await pool.query(`SELECT to_jsonb(t)::text value FROM opportunity_catalog.${table} t ORDER BY to_jsonb(t)::text`)).rows.map(x => x.value);
  return result;
}
async function tenantFingerprint(pool) {
  const tables = (await pool.query("SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema IN ('opportunity_catalog','organizational_scope','organizational_profile') ORDER BY table_schema,table_name")).rows;
  const result = {};
  for (const t of tables) {
    const name = cfg.identifier(t.table_schema) + '.' + cfg.identifier(t.table_name);
    const values = (await pool.query(`SELECT to_jsonb(t)::text value FROM ${name} t ORDER BY to_jsonb(t)::text`)).rows;
    result[name] = { count: values.length, digest: createHash('sha256').update(JSON.stringify(values)).digest('hex') };
  }
  return result;
}
function corrections() {
  const official = JSON.parse(fs.readFileSync(path.join(out, 'classification-raw-records.json')));
  assert.equal(official.status, 200);
  const cerv = official.records.find(r => r.metadata.identifier[0] === 'CERV-2024-CITIZENS-VALUES' && r.metadata.callccm2Id[0] === '11674');
  const esc = official.records.find(r => r.metadata.identifier[0] === 'ESC-HUMAID-2021-QUAL-LABEL-FP');
  assert.equal(cerv.metadata.frameworkProgramme[0], '43251589'); assert.equal(esc.metadata.frameworkProgramme[0], '43254037');
  return [
    { callReference: cerv.metadata.identifier[0], sourceUrl: CASCADE_BASE + '11674', from: 'LIFE', rawProgrammeCode: '43251589' },
    { callReference: esc.metadata.identifier[0], sourceUrl: esc.url, from: '43254037', rawProgrammeCode: '43254037' }
  ];
}
async function main() {
  assert(process.argv.slice(2).every(x => x === '--apply')); const apply = process.argv.includes('--apply');
  const config = cfg.readConfig(), state = JSON.parse(fs.readFileSync(path.join(cfg.folder, 'runtime.json')));
  require('./runtime').runtimeEnvironment(config, state);
  assert.equal(config.centralDatabase, 'c4g_central_dev'); assert.equal(config.tenantDatabase, 'c4g_tenant_dev'); assert.equal(config.port, 5432);
  assert.equal(state.funding.approval, 'central-programmes-100');
  const pool = new Pool(cfg.connection(config, config.centralDatabase)), tenant = new Pool(cfg.connection(config, config.tenantDatabase));
  try {
    assert.equal((await require('../../src/security/centralMigrationPreflight').preflightCentral(pool)).currentVersion, '017_funding_programmes');
    const programmeCorrections = corrections(), preview = await reconcileFunding({ pool, programmeCorrections });
    if (!apply) { fs.writeFileSync(path.join(out, 'identity-reconciliation-preview.json'), JSON.stringify(preview, null, 2)); console.log(JSON.stringify(preview, null, 2)); return; }
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'cascade-disposable-verification.json'))).status, 'PASS');
    const approvedPreview = JSON.parse(fs.readFileSync(path.join(out, 'identity-reconciliation-preview.json')));
    assert.equal(preview.digest, approvedPreview.digest, 'PREVIEW_STALE');
    const before = await histories(pool), tenantBefore = await tenantFingerprint(tenant);
    const idsBefore = (await pool.query('SELECT opportunity_id FROM opportunity_catalog.funding_identity ORDER BY opportunity_id')).rows;
    const backup = path.join(cfg.folder, 'funding-identity-backup-' + Date.now()); fs.mkdirSync(backup);
    const identity = spawnSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
    const sid = identity.stdout.match(/S-1-5-[0-9-]+/)?.[0]; assert(sid);
    assert.equal(spawnSync('icacls', [backup, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true }).status, 0);
    cfg.saveState({ preview, history: before, tenant: tenantBefore }, path.join(backup, 'before.json'));
    const binary = 'C:/Program Files/PostgreSQL/18/bin/', dump = path.join(backup, 'central.dump');
    assert.equal(spawnSync(binary + 'pg_dump.exe', ['-h', config.host, '-p', String(config.port), '-U', config.user, '-Fc', '-f', dump, config.centralDatabase], { env: { ...process.env, PGPASSWORD: config.password }, windowsHide: true }).status, 0);
    assert(fs.statSync(dump).size > 1000);
    assert.equal(spawnSync(binary + 'pg_restore.exe', ['--list', dump], { windowsHide: true }).status, 0);
    const applied = await reconcileFunding({ pool, programmeCorrections, apply: true, expectedDigest: preview.digest });
    const after = await histories(pool);
    for (const [table, rows] of Object.entries(before)) { const current = new Set(after[table]); for (const row of rows) assert(current.has(row), 'HISTORY_CHANGED_' + table); }
    for (const table of ['funding_observation', 'funding_run', 'funding_run_item']) assert.deepEqual(after[table], before[table]);
    assert.deepEqual((await pool.query('SELECT opportunity_id FROM opportunity_catalog.funding_identity ORDER BY opportunity_id')).rows, idsBefore);
    assert.deepEqual(await tenantFingerprint(tenant), tenantBefore);
    assert.equal((await reconcileFunding({ pool, programmeCorrections })).changes.length, 0);
    const result = { status: 'PASS', checkedAt: new Date().toISOString(), ...applied, opportunityIdsPreserved: true, previousHistoryPreserved: true,
      tenantBusinessDataPreserved: true, noImportsPerformed: true, repeatedPreviewChanges: 0, backup: path.relative(cfg.root, backup) };
    fs.writeFileSync(path.join(out, 'identity-reconciliation-native.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ status: 'PASS', reconciled: applied.changes.length, identities: idsBefore.length, opportunityIdsPreserved: true, previousHistoryPreserved: true, tenantBusinessDataPreserved: true, noImportsPerformed: true }));
  } finally { await pool.end(); await tenant.end(); }
}
if (require.main === module) main().catch(e => { console.error(e.code || e.name, /^[A-Z0-9_]+$/.test(e.message) ? e.message : 'FUNDING_IDENTITY_RECONCILIATION_FAILED'); process.exitCode = 1; });
