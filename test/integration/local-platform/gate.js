'use strict';
// Local Windows PostgreSQL 18 proof. Requires the isolated cluster prepared at
// 127.0.0.1:5564; never accepts the user's 5432 server and never drops a database.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { Pool } = require('../../../backend/node_modules/pg');
const root = path.resolve(__dirname, '../../..'), folder = path.join(root, '.tmp/local-platform-validation');
const { initialState, installSchemas } = require('../../../backend/scripts/localPlatform/schema');
const { connection, saveState } = require('../../../backend/scripts/localPlatform/config');
const { configureIdentity, seedAccess } = require('../../../backend/scripts/localPlatform/identity');
const { startNative } = require('../../../backend/scripts/localPlatform/runtime');
async function main() {
  const { OidcClient } = require('../../../backend/src/security/oidcClient');
  const originalCallback = OidcClient.prototype.callback;
  OidcClient.prototype.callback = async function (...args) {
    const result = await originalCallback.apply(this, args);
    assert.equal(result.claims.acr, 'c4g-loa1');
    assert(result.claims.amr?.includes('pwd'));
    assert(!result.claims.amr?.includes('otp'));
    return result;
  };
  const config = { host: '127.0.0.1', port: 5564, user: 'c4g_validation_setup',
    password: fs.readFileSync(path.join(folder, 'password'), 'utf8'),
    centralDatabase: 'c4g_native_validation_central', tenantDatabase: 'c4g_native_validation_tenant' };
  const admin = new Pool(connection(config, 'postgres'));
  let central, tenant, authority, instance, frontend;
  try {
    assert.equal((await admin.query("SELECT current_setting('server_version_num') version")).rows[0].version.slice(0,2), '18');
    for (const name of [config.centralDatabase, config.tenantDatabase]) {
      if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount) await admin.query(`CREATE DATABASE ${name}`);
    }
    const filename = path.join(folder, 'installation.json');
    const state = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename)) : initialState(config);
    const persist = value => saveState(value, filename); persist(state);
    await installSchemas(config, state, persist);
    central = new Pool(connection(config, config.centralDatabase)); tenant = new Pool(connection(config, config.tenantDatabase));
    authority = new Pool({ ...connection(config, config.centralDatabase), user: 'c4g_authority_runtime', password: state.authorityPassword });
    const owner = (await central.query("SELECT rolcanlogin,rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname='c4g_f12_admin'")).rows[0];
    assert(Object.values(owner).every(value => value === false));
    const before = await tenant.query('SELECT * FROM c4g_system.schema_migration ORDER BY ordinal');
    await installSchemas(config, state, persist);
    assert.deepEqual((await tenant.query('SELECT * FROM c4g_system.schema_migration ORDER BY ordinal')).rows, before.rows);
    const api = new Pool({ ...connection(config, config.centralDatabase), user: 'c4g_local_api', password: state.tenantPassword });
    try { await assert.rejects(() => api.query('SELECT 1'), { code: '42501' }); } finally { await api.end(); }
    const access = await configureIdentity(state, persist, { clientId: 'c4g-native-validation',
      username: 'c4g-native-validation-hugo', origin: 'http://localhost:5190' });
    await seedAccess(central, authority, state); await seedAccess(central, authority, state);
    assert.equal((await central.query('SELECT count(*)::int n FROM public.global_user')).rows[0].n, 2);
    assert.equal((await central.query('SELECT count(*)::int n FROM public.organization_membership')).rows[0].n, 1);
    assert.equal((await central.query('SELECT count(*)::int n FROM opportunity_catalog.opportunity')).rows[0].n, 0);
    state.phase = 'READY'; persist(state); saveState(access, path.join(folder, 'access.json'));
    console.log('INSTALLER_IDEMPOTENCY_EMPTY_CATALOG_AND_DB_ISOLATION_PASS');
    instance = await startNative({ config, state, port: 5191 });
    const { pathToFileURL } = require('node:url');
    const { createServer } = await import(pathToFileURL(path.join(root, 'frontend/node_modules/vite/dist/node/index.js')));
    frontend = await createServer({ root: path.join(root, 'frontend'),
      configFile: path.join(root, 'frontend/vite.config.js'),
      server: { host: 'localhost', port: 5190, strictPort: true, open: false,
        proxy: { '/api': { target: 'http://localhost:5191', changeOrigin: true } } } });
    await frontend.listen();
    assert.equal((await fetch('http://localhost:5190/api/local-health')).status, 200);
    await require('./login').verify({ origin: 'http://localhost:5190', access, state, folder });
    // Enrollment is exercised exclusively on the isolated validation identity.
    OidcClient.prototype.callback = originalCallback;
    await require('./optionalMfa').verify({ origin: 'http://localhost:5190', access, state, folder,
      reinstall: () => configureIdentity(state, persist, { clientId: 'c4g-native-validation',
        username: 'c4g-native-validation-hugo', origin: 'http://localhost:5190' }) });
    await instance.close(); instance = await startNative({ config, state, port: 5191 });
    assert.equal((await fetch('http://localhost:5190/api/local-health')).status, 200);
    assert.equal((await central.query('SELECT count(*)::int n FROM public.global_user')).rows[0].n, 2);
    console.log('NATIVE_RESTART_PRESERVES_IDENTITIES_PASS');
  } finally {
    OidcClient.prototype.callback = originalCallback;
    if (frontend) await frontend.close();
    if (instance) await instance.close();
    if (authority) await authority.end(); if (central) await central.end(); if (tenant) await tenant.end(); await admin.end();
  }
}
if (require.main === module) main().catch(error => {
  console.error(error.internalCode || error.code || (/^[A-Z0-9_]+$/.test(error.message || '') ? error.message : error.name));
  console.error((error.stack || '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 4).join('\n'));
  process.exitCode = 1;
});
module.exports = { main };
