'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { assertTarget, connectionUrl } = require('../scripts/localPlatform/config');
const { runtimeEnvironment } = require('../scripts/localPlatform/runtime');
const config = { host: 'localhost', port: 5432, user: 'local_admin', password: 'synthetic;"#$value', centralDatabase: 'test_central', tenantDatabase: 'test_tenant' };
function ready() {
  return { phase: 'READY', tenantId: 'tenant-a', organizationId: 'org-a', installationId: 'synthetic-installation',
    catalogReaderConfigPath: path.resolve(__dirname, 'fixtures/localCatalogReader.json'), target: { ...config },
    identity: { issuer: 'https://localhost:8443/realms/c4g-test', clientId: 'synthetic' },
    snapshot: { tenantId: 'tenant-a', organizationId: 'org-a' },
    credentials: { tenantId: 'tenant-a', host: 'localhost', port: 5432, database: 'test_tenant', login: 'c4g_local_api' } };
}
test('local target refuses remote/shared/invalid database destinations', () => {
  assert.doesNotThrow(() => assertTarget(config));
  for (const change of [{ host: 'db.example.com' }, { tenantDatabase: 'test_central' }, { port: 0 }, { centralDatabase: 'bad;sql' }]) {
    assert.throws(() => assertTarget({ ...config, ...change }));
  }
  assert.equal(decodeURIComponent(new URL(connectionUrl(config, config.centralDatabase)).password), config.password);
});
test('native runtime refuses partial installation, substituted tenant and external identity', () => {
  const env = runtimeEnvironment(config, ready());
  assert.equal(env.AUTH_MODE, 'oidc');
  assert.equal(env.DB_HOST, undefined);
  for (const mutate of [state => { state.phase = 'SCHEMAS_READY'; }, state => { state.credentials.database = 'other'; },
    state => { state.credentials.host = 'outside.example.com'; }, state => { state.identity.origin = 'https://outside.example.com'; },
    state => { state.snapshot.organizationId = 'org-b'; }]) {
    const state = ready(); mutate(state); assert.throws(() => runtimeEnvironment(config, state));
  }
});
test('optional MFA runtime binds the recognized policy to its isolated native realm', () => {
  const state = ready();
  state.identity = { issuer: 'https://localhost:8443/realms/c4g-native-local', clientId: 'c4g-native-local', policyVersion: 'c4g-user-mfa-v1' };
  const env = runtimeEnvironment(config, state);
  assert.equal(env.PRIVILEGED_LOGIN_ASSURANCE_CATEGORY, 'recent-auth');
  assert.equal(JSON.parse(env.AUTH_ASSURANCE_POLICY_JSON)['recent-auth'].mfa, false);
  for (const issuer of ['https://localhost:8443/realms/c4g-test', 'https://localhost:8443/realms/c4g-native-other',
    'https://localhost:8443/realms/c4g-native-local?other=1']) {
    assert.throws(() => runtimeEnvironment(config, { ...state, identity: { ...state.identity, issuer } }));
  }
  assert.throws(() => runtimeEnvironment(config, { ...state, identity: { ...state.identity, policyVersion: 'unknown' } }));
});

test('native email integration is enabled only by explicit local installation configuration', () => {
  const state = ready();
  assert.equal(runtimeEnvironment(config, state).OIDC_EMAIL_VERIFICATION, undefined);
  state.identity.emailVerification = true;
  assert.equal(runtimeEnvironment(config, state).OIDC_EMAIL_VERIFICATION, 'keycloak-account-v1');
  state.identity.emailVerification = 'true';
  assert.equal(runtimeEnvironment(config, state).OIDC_EMAIL_VERIFICATION, undefined);
});

test('native launcher keeps unified catalogue disabled with existing and explicit configuration',()=>{
 const state=ready();assert.equal(runtimeEnvironment(config,state).CATALOG_READ_RUNTIME,'disabled');
 state.catalogRead={mode:'disabled',firstAccess:'organization-administrator'};
 assert.equal(runtimeEnvironment(config,state).CATALOG_READ_RUNTIME,'disabled');
 state.catalogRead.mode='controlled';assert.throws(()=>runtimeEnvironment(config,state),/CATALOG_READ_ACTIVATION_NOT_ADMITTED/);
});
