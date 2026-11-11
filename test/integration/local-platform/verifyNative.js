'use strict';
// Uses the already running npm dev servers. No schema or business-data writes.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { folder, readConfig, connection } = require('../../../backend/scripts/localPlatform/config');
const { Pool } = require('../../../backend/node_modules/pg');
async function main() {
  const config = readConfig(), state = JSON.parse(fs.readFileSync(path.join(folder, 'runtime.json')));
  const access = JSON.parse(fs.readFileSync(path.join(folder, 'access.json')));
  assert.equal(state.phase, 'READY'); assert.equal(state.identity.origin, 'http://localhost:3000');
  assert.equal((await fetch('http://localhost:3000/api/local-health')).status, 200);
  // Consolidated installations have real catalog/directory data. Their proof
  // never posts a refresh (the initial-installation test expects it disabled).
  if (state.consolidation) return require('./consolidated').main();
  const proofFolder = path.join(folder, 'native-proof'); fs.mkdirSync(proofFolder, { recursive: true });
  await require('./login').verify({ origin: state.identity.origin, access, state, folder: proofFolder });
  for (const database of [config.centralDatabase, config.tenantDatabase]) {
    const pool = new Pool(connection(config, database));
    try {
      const tables = (await pool.query(`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN('r','p')`)).rows[0].n;
      assert(tables > 0);
      assert.equal((await pool.query('SELECT count(*)::int n FROM opportunity_catalog.opportunity')).rows[0].n, 0);
      console.log('NATIVE_TABLES', database, tables, 'EMPTY_OPPORTUNITIES_PASS');
    } finally { await pool.end(); }
  }
  console.log('NATIVE_5432_NPM_DEV_ADMIN_HUGO_PASS');
}
if (require.main === module) main().catch(error => {
  console.error(error.code || (/^[A-Z0-9_]+$/.test(error.message || '') ? error.message : error.name)); process.exitCode = 1;
});
module.exports = { main };
