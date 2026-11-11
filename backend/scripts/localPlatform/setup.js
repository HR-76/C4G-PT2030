'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { folder, readConfig, connection, saveState } = require('./config');
const { initialState, installSchemas } = require('./schema');
const { configureIdentity, seedAccess } = require('./identity');

async function setup() {
  const config = readConfig(), filename = path.join(folder, 'runtime.json');
  const lock = fs.openSync(path.join(folder, 'setup.lock'), 'wx');
  try {
    const state = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename)) : initialState(config);
    const persist = value => saveState(value, filename);
    persist(state);
    await installSchemas(config, state, persist);
    console.log('LOCAL_SCHEMAS_READY');
    const access = await configureIdentity(state, persist);
    const central = new Pool(connection(config, config.centralDatabase));
    const authority = new Pool({ ...connection(config, config.centralDatabase), user: 'c4g_authority_runtime', password: state.authorityPassword });
    try {
      await seedAccess(central, authority, state);
      await require('../../src/security/centralMigrationPreflight').preflightCentral(central);
    } finally { await authority.end(); await central.end(); }
    state.phase = 'READY'; persist(state);
    saveState(access, path.join(folder, 'access.json'));
    console.log('LOCAL_PLATFORM_READY: C4G; admin / hugo. Private access details: .tmp/local-platform/access.json');
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(path.join(folder, 'setup.lock'));
  }
}
if (require.main === module) setup().catch(error => {
  const code = error.internalCode || error.code || (/^[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'LOCAL_SETUP_FAILED');
  console.error(code);
  if (code === '28P01') console.error('Atualize PGPASSWORD em backend/.env. Nenhuma password foi apresentada.');
  if (code === 'DATABASE_CONFIGURATION_MISMATCH') console.error('O tenant exige UTF8, ICU und e UTC. A base existente foi preservada.');
  process.exitCode = 1;
});
module.exports = { setup };
