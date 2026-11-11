'use strict';
// Daily chat retention for the local profile (one-shot; meant for the Windows Task Scheduler).
// Connects to c4g_tenant_dev with the local PostgreSQL administrator and acts as c4g_chat_retention_runtime.
// --check only verifies the target and schema (nothing is deleted). Exit code: 0 done, 1 failures or unfinished work, 2 not ready (migration 040 missing or target mismatch).
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const cfg = require('./config');
const { runChatRetention } = require('../../src/applications/chatRetentionRunner');

const READY_VERSION = '040_application_chat_retention';
const line = entry => process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);

async function main() {
  const config = cfg.readConfig();
  const state = JSON.parse(fs.readFileSync(path.join(cfg.folder, 'runtime.json')));
  const matches = state.phase === 'READY' && config.port === 5432 && config.tenantDatabase === 'c4g_tenant_dev'
    && state.target?.tenantDatabase === config.tenantDatabase && state.target?.port === config.port && Boolean(state.organizationId);
  if (!matches) { line({ event: 'CHAT_RETENTION_NOT_READY', reason: 'TARGET' }); process.exitCode = 2; return; }
  const probe = new Pool(cfg.connection(config, config.tenantDatabase));
  let version;
  try { version = (await probe.query('SELECT migration_id FROM c4g_system.schema_migration ORDER BY ordinal DESC LIMIT 1')).rows[0]?.migration_id; } finally { await probe.end(); }
  if (version !== READY_VERSION) { line({ event: 'CHAT_RETENTION_NOT_READY', reason: 'SCHEMA', version }); process.exitCode = 2; return; }
  if (process.argv.includes('--check')) { line({ event: 'CHAT_RETENTION_READY', version }); return; }
  const summary = await runChatRetention({
    listTenants: async () => [{ organizationId: state.organizationId }],
    openTenant: async () => { const pool = new Pool(cfg.connection(config, config.tenantDatabase)); return { pool, close: () => pool.end() }; },
    log: line
  });
  if (summary.failures > 0 || summary.incomplete > 0) process.exitCode = 1;
}
main().catch(error => { line({ event: 'CHAT_RETENTION_RUN_FAILED', code: error.code || 'UNKNOWN' }); process.exitCode = 1; });
