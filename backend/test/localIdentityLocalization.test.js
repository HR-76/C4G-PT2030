'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyLocalization, localizationSettings } = require('../scripts/localPlatform/identityLocalization');
const state = { installationId: 'local-installation', identity: {
  realm: 'c4g-native-test', issuer: 'https://localhost:8443/realms/c4g-native-test', origin: 'http://localhost:3000'
} };

function fixture(overrides = {}) {
  let value = { internationalizationEnabled: false, supportedLocales: ['en', 'pt-BR'], defaultLocale: 'en',
    loginTheme: 'c4g', resetPasswordAllowed: false, registrationAllowed: false,
    attributes: { 'c4g.local.installation': state.installationId, keep: 'yes' },
    smtpServer: { password: 'must-not-escape' }, ...overrides };
  const calls = [];
  return { calls, admin: async (route, method, body) => {
    calls.push({ route, method, body });
    if (method === 'PUT') value = { ...value, ...body };
    return structuredClone(value);
  } };
}

test('selects native European Portuguese using only reversible locale settings', async () => {
  const f = fixture(), backups = [];
  assert.deepEqual(localizationSettings, { internationalizationEnabled: true, supportedLocales: ['pt'], defaultLocale: 'pt' });
  const result = await applyLocalization({ ...f, state, backup: value => backups.push(value) });
  assert.deepEqual(result, { changed: true, ...localizationSettings });
  assert.deepEqual(f.calls.filter(call => call.method === 'PUT'), [
    { route: state.identity.realm, method: 'PUT', body: localizationSettings }
  ]);
  assert.deepEqual(backups, [{ realm: state.identity.realm, installationId: state.installationId,
    internationalizationEnabled: false, supportedLocales: ['en', 'pt-BR'], defaultLocale: 'en' }]);
  assert.equal((await applyLocalization({ ...f, state })).changed, false);
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
});

test('refuses remote, unowned or unrelated themes before modifying the realm', async () => {
  for (const [candidate, overrides] of [
    [{ ...state, installationId: 'other' }, {}],
    [{ ...state, identity: { ...state.identity, origin: 'https://customer.invalid' } }, {}],
    [{ ...state, identity: { ...state.identity, issuer: 'https://remote.invalid' } }, {}],
    [state, { loginTheme: 'unrelated' }]
  ]) {
    const f = fixture(overrides);
    await assert.rejects(() => applyLocalization({ ...f, state: candidate }));
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, 0);
  }
});

test('detects unrelated configuration changes and refused localization updates', async () => {
  for (const mutate of [value => { value.attributes.keep = 'changed'; }, value => { value.defaultLocale = 'en'; }]) {
    const f = fixture();
    let reads = 0;
    await assert.rejects(() => applyLocalization({ state, admin: async (...args) => {
      const value = await f.admin(...args);
      if (!args[1] && ++reads === 2) mutate(value);
      return value;
    } }), /LOCAL_IDENTITY_LOCALIZATION_VERIFICATION_FAILED/);
  }
});

test('does not mutate when the backup cannot be saved', async () => {
  const f = fixture();
  await assert.rejects(() => applyLocalization({ ...f, state, backup: () => { throw Error('BACKUP_FAILED'); } }), /BACKUP_FAILED/);
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 0);
});
