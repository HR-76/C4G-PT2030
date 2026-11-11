const { Pool } = require('pg');
const { load } = require('../src/audit/migrationManifest');
const { auditPreflight } = require('../src/audit/preflight');
const { assertDisposableTarget } = require('../test/support/disposableTarget');

async function gate(scope, connectionString) {
  if (!connectionString) throw new Error(`Missing disposable F7 ${scope} target.`);
  // Loopback host, non-default port and an f7_synthetic_ database: the gate runs the audit rollback.
  assertDisposableTarget(connectionString, { prefix: 'f7_synthetic_' });
  const pool = new Pool({ connectionString, max: 2 });
  try {
    const version = Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num);
    if (Math.floor(version / 10000) !== 17) throw new Error('F7 gate requires PostgreSQL 17.');
    await pool.query(load(scope, 'down').sql);
    if (!(await pool.query(`SELECT to_regnamespace('audit') IS NULL AS absent`)).rows[0].absent) throw new Error('F7 rollback did not remove its schema.');
    await pool.query(load(scope, 'up').sql);
    await auditPreflight(pool);
    return { scope, version, rollback: true, reforward: true };
  } finally { await pool.end(); }
}

(async () => {
  const results = [];
  results.push(await gate('central', process.env.F7_CENTRAL_DATABASE_URL));
  results.push(await gate('tenant', process.env.F7_TENANT_DATABASE_URL));
  console.log(JSON.stringify(results));
})().catch(error => { console.error(error); process.exitCode = 1; });
