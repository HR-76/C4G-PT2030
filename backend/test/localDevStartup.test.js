'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { main, startupDiagnostic } = require('../scripts/startDev');

function harness(overrides = {}) {
  const processApi = new EventEmitter();
  processApi.env = { NODE_ENV: 'development' };
  const events = [], messages = [];
  const state = { phase: 'READY', identity: { issuer: 'synthetic-local-issuer' } };
  const instance = { close: async () => events.push('close') };
  return {
    events, messages, state, instance, processApi,
    dependencies: {
      processApi,
      readState: () => { events.push('state'); return state; },
      prepareServices: async received => { assert.equal(received, state); events.push('prepare'); },
      startRuntime: async options => { assert.deepEqual(options, { state }); events.push('start'); return instance; },
      logger: { log: message => messages.push(message) },
      ...overrides
    }
  };
}

test('backend dev prepares external services before starting the same prepared local installation', async () => {
  const fixture = harness();
  assert.equal(await main(fixture.dependencies), fixture.instance);
  assert.deepEqual(fixture.events, ['state', 'prepare', 'start']);
  assert.match(fixture.messages[0], /http:\/\/localhost:5000/);
  fixture.processApi.emit('SIGINT');
  fixture.processApi.emit('SIGTERM');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fixture.events, ['state', 'prepare', 'start', 'close']);
  assert.equal(fixture.processApi.exitCode, 0);
});

test('backend dev waits for identity preparation before opening the API', async () => {
  let finishPreparation;
  const fixture = harness({ prepareServices: () => new Promise(resolve => { finishPreparation = resolve; }) });
  const pending = main(fixture.dependencies);
  assert.deepEqual(fixture.events, ['state']);
  finishPreparation();
  await pending;
  assert.deepEqual(fixture.events, ['state', 'start']);
});

test('failed prerequisite preparation prevents backend startup and success output', async () => {
  const failure = Object.assign(new Error('private diagnostic'), { code: 'LOCAL_DEV_IDENTITY_START_FAILED' });
  const fixture = harness({ prepareServices: async () => { throw failure; } });
  await assert.rejects(main(fixture.dependencies), error => error === failure);
  assert.deepEqual(fixture.events, ['state']);
  assert.deepEqual(fixture.messages, []);
  assert.equal(fixture.processApi.listenerCount('SIGINT'), 0);
});

test('unprepared state prevents all service startup', async () => {
  const fixture = harness({ readState: () => { throw Object.assign(new Error('missing'), { code: 'LOCAL_DEV_SETUP_REQUIRED' }); } });
  await assert.rejects(main(fixture.dependencies), error => error.code === 'LOCAL_DEV_SETUP_REQUIRED');
  assert.deepEqual(fixture.events, []);
});

test('backend dev rejects other environments before reading state or starting services', async () => {
  const fixture = harness();
  fixture.processApi.env.NODE_ENV = 'production';
  await assert.rejects(main(fixture.dependencies), /LOCAL_PLATFORM_DEVELOPMENT_ONLY/);
  assert.deepEqual(fixture.events, []);
});

test('controlled dev prints the shared startup diagnostic when the API cannot start', () => {
  const result = spawnSync(process.execPath, [require.resolve('../scripts/startCatalogControlled')], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production' }
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), startupDiagnostic(new Error('LOCAL_PLATFORM_DEVELOPMENT_ONLY')));
});

test('startup diagnostics give known remediation without exposing raw messages or causes', () => {
  for (const [code, expected] of [
    ['LOCAL_DEV_IDENTITY_START_FAILED', /Docker Desktop/],
    ['LOCAL_DEV_IDENTITY_TIMEOUT', /Keycloak/],
    ['LOCAL_DEV_IDENTITY_CA_INVALID', /NODE_EXTRA_CA_CERTS/],
    ['LOCAL_DEV_IDENTITY_PROFILE_UNKNOWN', /encaminhamento/],
    ['LOCAL_DEV_IDENTITY_DATABASE_TIMEOUT', /c4g-native-email-pg/],
    ['LOCAL_DEV_SERVICE_UNAVAILABLE', /PostgreSQL/],
    ['LOCAL_DEV_SETUP_REQUIRED', /setup:local/],
    ['CATALOG_STARTUP_CONFIGURATION_INVALID', /catalog-controlled/],
    ['STORED_CATALOG_EXISTING_CONTENT_REQUIRES_REVIEW', /publicad/],
    ['28P01', /PGPASSWORD/],
    ['EADDRINUSE', /porta/]
  ]) {
    const diagnostic = startupDiagnostic({ code, message: 'PRIVATE_MESSAGE', cause: { message: 'PRIVATE_CAUSE' } });
    assert.match(diagnostic, new RegExp(`^${code}:`));
    assert.match(diagnostic, expected);
    assert.doesNotMatch(diagnostic, /PRIVATE_/);
  }
});

test('startup diagnostics allow only known codes, including internal and message-only errors', () => {
  assert.match(startupDiagnostic({ internalCode: 'LOCAL_PLATFORM_SETUP_REQUIRED', message: 'PRIVATE' }), /^LOCAL_PLATFORM_SETUP_REQUIRED:/);
  assert.match(startupDiagnostic(new Error('LOCAL_PLATFORM_DEVELOPMENT_ONLY')), /^LOCAL_PLATFORM_DEVELOPMENT_ONLY:/);
  for (const error of [
    new Error('PRIVATE_TOKEN'),
    { internalCode: 'PRIVATE_INTERNAL_CODE', code: 'PRIVATE_CODE', message: 'PRIVATE_MESSAGE' },
    { code: 'constructor', message: 'PRIVATE_MESSAGE' },
    null
  ]) {
    const diagnostic = startupDiagnostic(error);
    assert.match(diagnostic, /^LOCAL_API_START_FAILED:/);
    assert.doesNotMatch(diagnostic, /PRIVATE_|constructor/);
  }
});
