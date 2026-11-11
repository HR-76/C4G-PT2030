'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { runtimeEnvironment } = require('../scripts/localPlatform/runtime');
const pkg = require('../src/security/opportunityV2MigrationPackage');
const { runtimeEnabled, executor11145Enabled } = require('../src/opportunities/v2/activationHttp');
const config = () => ({ host: 'localhost', port: 5432, user: 'synthetic_user', password: 'synthetic-only-password',
  centralDatabase: 'c4g_central_dev', tenantDatabase: 'c4g_tenant_dev' });
function state() {
  const c = config();
  return { phase: 'READY', installationId: 'synthetic-local-11145', tenantId: 'synthetic-tenant', organizationId: 'synthetic-organization',
    target: { host: c.host, port: c.port, centralDatabase: c.centralDatabase, tenantDatabase: c.tenantDatabase },
    identity: { issuer: 'https://localhost:8443/realms/c4g-test', clientId: 'synthetic' },
    funding: { source: 'live-local', approval: 'central-official-sources-100', coverage: 'durable-v1' },
    catalogReaderConfigPath: 'synthetic-reader-without-filesystem-access',
    credentials: { tenantId: 'synthetic-tenant', host: c.host, port: c.port, database: c.tenantDatabase, login: 'c4g_local_api' },
    snapshot: { tenantId: 'synthetic-tenant', organizationId: 'synthetic-organization', schema: {
      compatibilityState: 'COMPATIBLE', currentVersion: pkg.tenantAddition.version, schemaFingerprint: pkg.tenantAddition.schemaFingerprint,
      revision: 2, verifiedCapabilities: { [pkg.TENANT_CAPABILITY]: true } } },
    opportunityActivation: { packageId: pkg.PACKAGE_ID, runtime: 'authenticated-v2', executor: 'bounded-v2' } };
}
function reader(t) {
  const original = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (filename, ...rest) => filename === 'synthetic-reader-without-filesystem-access'
    ? JSON.stringify({ installationId: 'synthetic-local-11145', host: 'localhost', port: 5432, database: 'c4g_central_dev',
      login: 'c4g_catalog_synthetic', password: 'synthetic-only-catalog-reader-password' }) : original(filename, ...rest));
}
test('native runtime defaults explicitly disable activation and the bounded executor without altering funding settings', t => {
  reader(t); const s = state(); delete s.opportunityActivation; s.snapshot.schema.currentVersion = pkg.TENANT_BASELINE;
  const before = structuredClone(s), env = runtimeEnvironment(config(), s);
  assert.equal(env.OPPORTUNITY_ACTIVATION_RUNTIME, 'disabled'); assert.equal(env.OPPORTUNITY_11145_EXECUTOR, 'disabled');
  assert.equal(runtimeEnabled(env), false); assert.equal(executor11145Enabled(env), false);
  assert.equal(env.FUNDING_TENDERS_COVERAGE, 'durable-v1'); assert.equal(env.FUNDING_TENDERS_ENRICHMENT, undefined);
  assert.deepEqual(s, before);
});
test('native API and worker receive the explicit bounded selection only with the registered tenant schema', t => {
  reader(t); const s = state(), before = structuredClone(s), env = runtimeEnvironment(config(), s);
  assert.equal(env.OPPORTUNITY_ACTIVATION_RUNTIME, 'authenticated-v2'); assert.equal(env.OPPORTUNITY_11145_EXECUTOR, 'bounded-v2');
  assert.equal(runtimeEnabled(env), true); assert.equal(executor11145Enabled(env), true);
  assert.equal(env.FUNDING_TENDERS_SOURCE, 'live-local'); assert.equal(env.FUNDING_TENDERS_ENRICHMENT, undefined);
  assert.equal(env.FUNDING_TENDERS_CANONICAL_V2, undefined); assert.deepEqual(s, before);
});
test('selection is a closed enum-bound object and refuses getters, unknown packages and partially configured modes', t => {
  reader(t);
  for (const value of [null, false, 'bounded-v2', [], {}, { ...state().opportunityActivation, packageId: 'other' },
    { ...state().opportunityActivation, runtime: 'disabled' }, { ...state().opportunityActivation, executor: 'all' },
    { ...state().opportunityActivation, extra: true }, { runtime: 'authenticated-v2', executor: 'bounded-v2' }]) {
    const s = state(); s.opportunityActivation = value;
    assert.throws(() => runtimeEnvironment(config(), s), /LOCAL_OPPORTUNITY_ACTIVATION_CONFIGURATION_INVALID/);
  }
  let touched = false; const s = state();
  Object.defineProperty(s, 'opportunityActivation', { enumerable: true, get() { touched = true; return state().opportunityActivation; } });
  assert.throws(() => runtimeEnvironment(config(), s), /LOCAL_OPPORTUNITY_ACTIVATION_CONFIGURATION_INVALID/); assert.equal(touched, false);
  const nested = state(); Object.defineProperty(nested.opportunityActivation, 'executor', { enumerable: true, get() { touched = true; return 'bounded-v2'; } });
  assert.throws(() => runtimeEnvironment(config(), nested), /LOCAL_OPPORTUNITY_ACTIVATION_CONFIGURATION_INVALID/); assert.equal(touched, false);
});
test('activation refuses stale or unverified tenant metadata and cannot infer capability from a version string', t => {
  reader(t);
  for (const mutate of [s => { delete s.snapshot.schema; }, s => { s.snapshot.schema.currentVersion = pkg.TENANT_BASELINE; },
    s => { s.snapshot.schema.schemaFingerprint = 'a'.repeat(64); }, s => { s.snapshot.schema.compatibilityState = 'PENDING'; },
    s => { s.snapshot.schema.revision = 0; }, s => { delete s.snapshot.schema.verifiedCapabilities; },
    s => { s.snapshot.schema.verifiedCapabilities[pkg.TENANT_CAPABILITY] = 'true'; }]) {
    const s = state(); mutate(s); assert.throws(() => runtimeEnvironment(config(), s), /LOCAL_OPPORTUNITY_ACTIVATION_SCHEMA_REQUIRED/);
  }
});
test('bounded activation refuses a different local target or origin even when its internal binding is self-consistent', t => {
  reader(t);
  for (const change of [{ host: '127.0.0.1' }, { port: 5544 }, { centralDatabase: 'other_central' }, { tenantDatabase: 'other_tenant' }]) {
    const c = { ...config(), ...change }, s = state();
    s.target = { host: c.host, port: c.port, centralDatabase: c.centralDatabase, tenantDatabase: c.tenantDatabase };
    Object.assign(s.credentials, { host: c.host, port: c.port, database: c.tenantDatabase });
    // The dedicated activation target check remains effective without funding.
    delete s.funding;
    assert.throws(() => runtimeEnvironment(c, s), /LOCAL_OPPORTUNITY_ACTIVATION_TARGET_INVALID/);
  }
  const s = state(); delete s.funding; s.identity.origin = 'http://localhost:3001';
  assert.throws(() => runtimeEnvironment(config(), s), /LOCAL_OPPORTUNITY_ACTIVATION_TARGET_INVALID/);
});
