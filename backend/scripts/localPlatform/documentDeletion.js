'use strict';
// Explicit, local-only activation of tenant migration 039_document_deletion (irreversible).
// Default is a read-only check; --apply takes a verified tenant dump first, then applies the
// registered migration with the official runner and refreshes the local schema snapshot.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const cfg = require('./config');
const { withInstallerAuthority } = require('./installerAuthority');

const FROM = '038_application_task_details';
const TO = '039_document_deletion';

async function documentDigest(pool) {
  const result = {};
  for (const [name, order] of [['document', 'document_id'], ['document_version', 'version_id']]) {
    const rows = (await pool.query(`SELECT to_jsonb(t) AS row FROM document_storage.${name} t ORDER BY ${order}`)).rows;
    result[name] = { count: rows.length, digest: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
  }
  return result;
}

async function main() {
  const apply = process.argv.includes('--apply');
  assert(process.argv.slice(2).every(value => value === '--apply'));
  const config = cfg.readConfig();
  const state = JSON.parse(fs.readFileSync(path.join(cfg.folder, 'runtime.json')));
  // Target and tenant binding only; application runtime options (EU writer, funding) are irrelevant to a migration.
  assert.equal(state.phase, 'READY');
  for (const key of ['host', 'port', 'centralDatabase', 'tenantDatabase']) assert.equal(state.target?.[key], config[key], 'LOCAL_TARGET_MISMATCH');
  assert.equal(state.credentials?.database, config.tenantDatabase);
  assert.equal(state.credentials?.tenantId, state.tenantId);
  assert.equal(state.snapshot?.tenantId, state.tenantId);
  assert.equal(state.snapshot?.organizationId, state.organizationId);
  assert.equal(config.port, 5432);
  assert.equal(config.centralDatabase, 'c4g_central_dev');
  assert.equal(config.tenantDatabase, 'c4g_tenant_dev');
  const pool = new Pool(cfg.connection(config, config.tenantDatabase));
  try {
    const manifest = require('../../src/security/tenantMigrationManifest');
    assert.equal(manifest.documentDeletionManifest.at(-1).version, TO);
    const ledger = (await pool.query('SELECT migration_id, resulting_fingerprint FROM c4g_system.schema_migration ORDER BY ordinal DESC LIMIT 1')).rows[0];
    assert(ledger && [FROM, TO].includes(ledger.migration_id), 'LOCAL_TENANT_VERSION_UNEXPECTED');
    if (ledger.migration_id === TO) { console.log(JSON.stringify({ result: 'ALREADY_APPLIED', version: TO })); return; }
    assert.equal(ledger.resulting_fingerprint, manifest.applicationTaskDetailsManifest.at(-1).schemaFingerprint, 'LOCAL_TENANT_FINGERPRINT_UNEXPECTED');
    const before = await documentDigest(pool);
    if (!apply) {
      console.log(JSON.stringify({ result: 'READY_FOR_LOCAL_UPGRADE', from: ledger.migration_id, to: TO, documents: before.document.count, versions: before.document_version.count }));
      return;
    }
    const backup = path.join(cfg.folder, `document-deletion-039-backup-${Date.now()}`);
    fs.mkdirSync(backup);
    const identity = spawnSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
    const sid = identity.stdout.match(/S-1-5-[0-9-]+/)?.[0];
    assert(sid);
    assert.equal(spawnSync('icacls', [backup, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true }).status, 0);
    cfg.saveState(state, path.join(backup, 'runtime-before.json'));
    cfg.saveState(before, path.join(backup, 'documents-before.json'));
    const binary = 'C:/Program Files/PostgreSQL/18/bin/';
    const file = path.join(backup, `${config.tenantDatabase}.dump`);
    const dump = spawnSync(`${binary}pg_dump.exe`, ['-h', config.host, '-p', String(config.port), '-U', config.user, '-Fc', '-f', file, config.tenantDatabase],
      { env: { ...process.env, PGPASSWORD: config.password }, windowsHide: true });
    assert.equal(dump.status, 0);
    assert(fs.statSync(file).size > 1000);
    assert.equal(spawnSync(`${binary}pg_restore.exe`, ['--list', file], { windowsHide: true }).status, 0);

    await withInstallerAuthority(pool, {}, async ({ native, demote }) => {
      await require('../../src/security/tenantMigrationRunner').createDocumentDeletionMigrationRunner({
        pool: native, observationPublisher: { async publish() {} }, timeoutMs: 30000, scheduler: { setTimeout, clearTimeout }
      }).migrate({ tenantId: state.tenantId, databaseGenerationId: state.generationId, expectedRevision: 1,
        correlationId: state.installationId, idempotencyKey: `${state.installationId}-document-deletion` });
      await demote();
    });

    const observation = await require('../../src/security/tenantMigrationPreflight').preflightTenant(pool,
      { tenantId: state.tenantId, databaseGenerationId: state.generationId }, undefined, { timeoutMs: 15000 });
    assert.equal(observation.currentVersion, TO);
    assert(observation.capabilities.includes('DOCUMENT_DELETION'));
    assert.deepEqual(await documentDigest(pool), before);
    const functions = (await pool.query(`SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'document_storage' AND p.proname LIKE '%\\_document\\_deletion' ORDER BY 1`)).rows;
    assert.deepEqual(functions.map(row => [row.proname, row.owner, row.prosecdef]),
      [['begin_document_deletion', 'c4g_document_owner', true], ['cancel_document_deletion', 'c4g_document_owner', true], ['finish_document_deletion', 'c4g_document_owner', true]]);
    state.snapshot.schema = { ...state.snapshot.schema, currentVersion: observation.currentVersion, schemaFingerprint: observation.schemaFingerprint,
      verifiedCapabilities: Object.fromEntries(observation.capabilities.map(code => [code, true])) };
    cfg.saveState(state);
    cfg.saveState({ result: 'PASS', from: FROM, to: TO, documentsUnchanged: true, functions: functions.map(row => row.proname), fingerprint: observation.schemaFingerprint },
      path.join(backup, 'verification.json'));
    console.log('LOCAL_DOCUMENT_DELETION_UPGRADE_PASS');
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error.code || error.message || 'LOCAL_DOCUMENT_DELETION_UPGRADE_FAILED'); process.exitCode = 1; });
