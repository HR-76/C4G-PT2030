'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { catalogReaderEnvironment } = require('../scripts/localPlatform/catalogReaderConfig');
const config = { host: 'localhost', port: 5432, centralDatabase: 'synthetic_central' };
const state = { installationId: 'synthetic-installation', catalogReaderConfigPath: 'external-private-file' };
const material = { installationId: state.installationId, host: config.host, port: config.port,
  database: config.centralDatabase, login: 'c4g_catalog_synthetic', password: 'synthetic-password-not-real-12345678' };
test('native composition selects only explicitly bound catalog credentials', () => {
  const result = catalogReaderEnvironment(config, state, () => JSON.stringify(material));
  const url = new URL(result.CATALOG_DATABASE_URL);
  assert.equal(url.username, material.login); assert.equal(url.pathname, '/' + config.centralDatabase);
});
test('missing or mismatched catalog material fails closed without administrative fallback', () => {
  for (const replacement of [{ installationId: 'other' }, { host: 'remote.invalid' }, { port: 5433 },
    { database: 'other' }, { login: 'postgres' }, { login: 'c4g_catalog_reader' }, { password: '' }]) {
    assert.throws(() => catalogReaderEnvironment(config, state, () => JSON.stringify({ ...material, ...replacement })),
      { message: 'LOCAL_CATALOG_CONFIGURATION_REQUIRED' });
  }
  assert.throws(() => catalogReaderEnvironment(config, {}, () => { throw Error('must not read'); }),
    { message: 'LOCAL_CATALOG_CONFIGURATION_REQUIRED' });
  assert.throws(() => catalogReaderEnvironment(config, state, () => { throw Error('private detail'); }),
    { message: 'LOCAL_CATALOG_CONFIGURATION_REQUIRED' });
});
