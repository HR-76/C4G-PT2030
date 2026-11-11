'use strict';
// Read-only role and SQL parity probe. No OIDC decision or candidate writes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Pool } = require('../backend/node_modules/pg');
const cfg = require('../backend/scripts/localPlatform/config');
const { loadPackage, assertCurrent } = require('../backend/src/opportunities/v2/euLegacyPreapproval');
const root = cfg.root;
async function main() {
  assert(process.argv.length === 3 && /^[a-f0-9-]{36}$/.test(process.argv[2]));
  const packageId = process.argv[2];
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'output', `eu-legacy-preapproval-${packageId}`, 'plan.json')));
  const preview = JSON.parse(fs.readFileSync(path.join(root, plan.preview.path)));
  const eligible = preview.entries.filter(item => item.action === 'CHANGE_REQUIRES_APPROVAL');
  assert.equal(eligible.length, 391);
  const samples = [eligible[0], ...eligible.filter(item => item.amount.length === 0)].filter(Boolean);
  assert.equal(samples.length, 3);
  const config = cfg.readConfig();
  const pool = new Pool({ ...cfg.connection(config, config.centralDatabase), max: 1,
    options: '-c timezone=UTC -c statement_timeout=30000 -c lock_timeout=3000' });
  const client = await pool.connect();
  try {
    // The source guard and head checks require FOR SHARE, which PostgreSQL
    // refuses inside READ ONLY transactions. The probe exposes SELECT only.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query('SET LOCAL ROLE c4g_opportunity_central_runtime');
    const reader = { query(sql, values) {
      assert(/^SELECT\s/i.test(sql));
      return client.query(sql, values);
    } };
    for (const item of samples) await assertCurrent(reader, loadPackage(root, packageId, item.itemDigest));
    await client.query('ROLLBACK');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); await pool.end(); }
  console.log(JSON.stringify({ status: 'PASS', role: 'c4g_opportunity_central_runtime',
    checked: samples.map(item => item.externalIdentifier), databaseWrites: 0 }));
}
main().catch(error => { console.error(/^[A-Z0-9_]{3,100}$/.test(error?.code || '') ? error.code : 'EU_LEGACY_PREAPPROVAL_PROBE_FAILED'); process.exitCode = 1; });
