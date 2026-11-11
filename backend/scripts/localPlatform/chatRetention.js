'use strict';
// Explicit, local-only activation of tenant migration 040_application_chat_retention (irreversible).
// Default is a read-only check; --apply takes a verified tenant dump first, then applies the
// registered migration with the official runner and refreshes the local schema snapshot.
// It does not schedule or run any deletion: that needs a separate periodic executor.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const cfg = require('./config');
const { withInstallerAuthority } = require('./installerAuthority');
const { syncCentralObservation } = require('./centralObservation');

const FROM = '039_document_deletion';
const TO = '040_application_chat_retention';

async function chatDigest(pool) {
  const result = {};
  for (const [name, order] of [['application_chat_message', 'message_id'], ['application_chat_receipt', 'message_id']]) {
    const rows = (await pool.query(`SELECT to_jsonb(t) AS row FROM opportunity_catalog.${name} t ORDER BY ${order}`)).rows;
    result[name] = { count: rows.length, digest: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
  }
  return result;
}

async function main() {
  const apply = process.argv.includes('--apply');
  assert(process.argv.slice(2).every(value => value === '--apply'));
  const config = cfg.readConfig();
  const state = JSON.parse(fs.readFileSync(path.join(cfg.folder, 'runtime.json')));
  // Target and tenant binding only; application runtime options are irrelevant to a migration.
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
  const central = new Pool(cfg.connection(config, config.centralDatabase));
  // The runner below gets a silent publisher, so Central is synchronised here from a fresh tenant observation.
  const observe = () => require('../../src/security/tenantMigrationPreflight').preflightTenant(pool,
    { tenantId: state.tenantId, databaseGenerationId: state.generationId }, undefined, { timeoutMs: 15000 });
  const syncCentral = observation => syncCentralObservation({ central, observation, tenantId: state.tenantId, installationId: state.installationId, apply });
  try {
    const manifest = require('../../src/security/tenantMigrationManifest');
    assert.equal(manifest.chatRetentionManifest.at(-1).version, TO);
    const ledger = (await pool.query('SELECT migration_id, resulting_fingerprint FROM c4g_system.schema_migration ORDER BY ordinal DESC LIMIT 1')).rows[0];
    assert(ledger && [FROM, TO].includes(ledger.migration_id), 'LOCAL_TENANT_VERSION_UNEXPECTED');
    if (ledger.migration_id === TO) {
      // Repairs a Central directory left behind by an earlier run; read-only without --apply.
      console.log(JSON.stringify({ result: 'ALREADY_APPLIED', version: TO, central: (await syncCentral(await observe())).status }));
      return;
    }
    assert.equal(ledger.resulting_fingerprint, manifest.documentDeletionManifest.at(-1).schemaFingerprint, 'LOCAL_TENANT_FINGERPRINT_UNEXPECTED');
    const before = await chatDigest(pool);
    if (!apply) {
      console.log(JSON.stringify({ result: 'READY_FOR_LOCAL_UPGRADE', from: ledger.migration_id, to: TO,
        messages: before.application_chat_message.count, receipts: before.application_chat_receipt.count }));
      return;
    }
    const backup = path.join(cfg.folder, `chat-retention-040-backup-${Date.now()}`);
    fs.mkdirSync(backup);
    const identity = spawnSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
    const sid = identity.stdout.match(/S-1-5-[0-9-]+/)?.[0];
    assert(sid);
    assert.equal(spawnSync('icacls', [backup, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true }).status, 0);
    cfg.saveState(state, path.join(backup, 'runtime-before.json'));
    cfg.saveState(before, path.join(backup, 'chat-before.json'));
    const binary = 'C:/Program Files/PostgreSQL/18/bin/';
    const file = path.join(backup, `${config.tenantDatabase}.dump`);
    const dump = spawnSync(`${binary}pg_dump.exe`, ['-h', config.host, '-p', String(config.port), '-U', config.user, '-Fc', '-f', file, config.tenantDatabase],
      { env: { ...process.env, PGPASSWORD: config.password }, windowsHide: true });
    assert.equal(dump.status, 0);
    assert(fs.statSync(file).size > 1000);
    assert.equal(spawnSync(`${binary}pg_restore.exe`, ['--list', file], { windowsHide: true }).status, 0);

    await withInstallerAuthority(pool, {}, async ({ native, demote }) => {
      await require('../../src/security/tenantMigrationRunner').createChatRetentionMigrationRunner({
        pool: native, observationPublisher: { async publish() {} }, timeoutMs: 30000, scheduler: { setTimeout, clearTimeout }
      }).migrate({ tenantId: state.tenantId, databaseGenerationId: state.generationId, expectedRevision: 1,
        correlationId: state.installationId, idempotencyKey: `${state.installationId}-chat-retention` });
      await demote();
    });

    const observation = await observe();
    assert.equal(observation.currentVersion, TO);
    assert(observation.capabilities.includes('APPLICATION_CHAT_RETENTION'));
    assert.deepEqual(await chatDigest(pool), before);
    const fn = (await pool.query(`SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'opportunity_catalog' AND p.proname = 'purge_closed_application_chat_v1'`)).rows;
    assert.deepEqual(fn.map(row => [row.owner, row.prosecdef]), [['c4g_opportunity_tenant_owner', true]]);
    const role = (await pool.query("SELECT rolcanlogin, rolsuper FROM pg_roles WHERE rolname = 'c4g_chat_retention_runtime'")).rows;
    assert.deepEqual(role.map(row => [row.rolcanlogin, row.rolsuper]), [[false, false]]);
    state.snapshot.schema = { ...state.snapshot.schema, currentVersion: observation.currentVersion, schemaFingerprint: observation.schemaFingerprint,
      verifiedCapabilities: Object.fromEntries(observation.capabilities.map(code => [code, true])) };
    cfg.saveState(state);
    const centralState = await syncCentral(observation);
    assert(['PUBLISHED', 'IN_SYNC'].includes(centralState.status));
    cfg.saveState({ result: 'PASS', from: FROM, to: TO, chatUnchanged: true, fingerprint: observation.schemaFingerprint, central: centralState.status },
      path.join(backup, 'verification.json'));
    console.log('LOCAL_CHAT_RETENTION_UPGRADE_PASS');
  } finally { await pool.end(); await central.end(); }
}
main().catch(error => { console.error(error.code || error.message || 'LOCAL_CHAT_RETENTION_UPGRADE_FAILED'); process.exitCode = 1; });
