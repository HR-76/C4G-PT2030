'use strict';
// Staging installer: member invitations (context/features/staging-member-invitations.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { members } = require('../scripts/staging/install');
const { memberHttpConfiguration, memberWorkerConfiguration, carriedSettings, ACTIVATION_BRIDGE_ENDPOINT } = require('../scripts/staging/environment');
const { createKeycloakAdapter } = require('../src/platformOnboarding/keycloakAdapter');

const ISSUER = 'https://login.example.test/realms/c4g-staging';
const ORIGIN = 'https://app.example.test';
const state = () => ({ phase: 'READY', installationId: 'installation-1', organizationId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  credentials: { tenantId: 'tenant-1', host: 'c4g-postgres', port: 5432, database: 'c4g_tenant_staging', login: 'c4g_staging_api', password: 'synthetic', ssl: true },
  snapshot: { tenantId: 'tenant-1' } });
const secrets = () => { let n = 0; return () => (++n).toString(16).padStart(2, '0').repeat(32); };
const clients = { clientId: 'c4g-member-worker', clientSecret: 'synthetic-client-secret', manualClientId: 'c4g-member-activation', existingClientId: 'c4g-member-existing' };

function workspace(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-staging-members-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const stateFile = path.join(folder, 'install.json'), out = path.join(folder, 'members');
  fs.writeFileSync(stateFile, JSON.stringify(state())); fs.mkdirSync(out);
  return { out, env: { C4G_STAGING_STATE: stateFile, OIDC_ISSUER: ISSUER, PUBLIC_APP_URL: ORIGIN } };
}

test('http configuration names the realm, the bridge alias and keeps a secret already written', () => {
  const first = memberHttpConfiguration(state(), { issuer: ISSUER, origin: ORIGIN, generateSecret: secrets() });
  assert.equal(first.realm, 'c4g-staging');
  assert.deepEqual(first.http, { installationId: 'installation-1', issuer: ISSUER, origin: ORIGIN, manualClientId: 'c4g-member-activation',
    existingClientId: 'c4g-member-existing', bridgeSecret: '01'.repeat(32), dataResidencyCode: 'EU' });
  assert.equal(first.properties, `realm=c4g-staging\nclient=c4g-member-activation\nendpoint=${ACTIVATION_BRIDGE_ENDPOINT}\nsecret=${'01'.repeat(32)}\n`);
  assert.equal(ACTIVATION_BRIDGE_ENDPOINT, 'http://c4g-activation-bridge:5285/bridge/check');
  const again = memberHttpConfiguration(state(), { issuer: ISSUER, origin: ORIGIN, prior: first.http, generateSecret() { throw Error('must not regenerate'); } });
  assert.equal(again.http.bridgeSecret, first.http.bridgeSecret);
});

test('http configuration refuses another installation, a changed target and unusable addresses', () => {
  const generateSecret = secrets(), prior = memberHttpConfiguration(state(), { issuer: ISSUER, origin: ORIGIN, generateSecret }).http;
  assert.throws(() => memberHttpConfiguration(state(), { issuer: ISSUER, origin: ORIGIN, prior: { ...prior, installationId: 'other' }, generateSecret }), { code: 'STAGING_MEMBER_CONFIGURATION_CONFLICT' });
  assert.throws(() => memberHttpConfiguration(state(), { issuer: ISSUER, origin: 'https://other.example.test', prior, generateSecret }), { code: 'STAGING_MEMBER_CONFIGURATION_CONFLICT' });
  for (const [issuer, origin] of [['http://login.example.test/realms/c4g-staging', ORIGIN], [ISSUER + '/', ORIGIN], ['https://login.example.test/', ORIGIN], [ISSUER, 'http://app.example.test'], [ISSUER, ORIGIN + '/path'], ['not a url', ORIGIN]]) {
    assert.throws(() => memberHttpConfiguration(state(), { issuer, origin, generateSecret }), { code: 'STAGING_MEMBER_TARGET_INVALID' }, issuer + ' ' + origin);
  }
  assert.throws(() => memberHttpConfiguration({ ...state(), phase: 'INSTALLING' }, { issuer: ISSUER, origin: ORIGIN, generateSecret }), { code: 'STAGING_INSTALLATION_NOT_READY' });
  assert.throws(() => memberHttpConfiguration(state(), { issuer: ISSUER, origin: ORIGIN, prior: { ...prior, bridgeSecret: 'weak' }, generateSecret }), { code: 'STAGING_MEMBER_SECRET_INVALID' });
});

test('worker configuration carries the tenant binding and the EU residency, and keeps the ownership key', () => {
  const first = memberWorkerConfiguration(state(), { issuer: ISSUER, adminOrigin: 'http://keycloak:8080', clients, generateSecret: secrets() });
  assert.deepEqual(first, { issuer: ISSUER, adminOrigin: 'http://keycloak:8080', clientId: 'c4g-member-worker', clientSecret: 'synthetic-client-secret',
    ownershipKey: '01'.repeat(32), allowedResidency: [{ regionCode: 'EU', policyVersion: 'staging-v1' }],
    bindings: [{ organizationId: state().organizationId, credentials: state().credentials, snapshot: state().snapshot }] });
  const again = memberWorkerConfiguration(state(), { issuer: ISSUER, adminOrigin: 'http://keycloak:8080', clients: { ...clients, clientSecret: 'rotated' }, prior: first, generateSecret() { throw Error('must not regenerate'); } });
  assert.deepEqual([again.ownershipKey, again.clientSecret], [first.ownershipKey, 'rotated']);
  for (const adminOrigin of ['keycloak:8080', 'http://keycloak:8080/', 'ftp://keycloak', 'http://user:pass@keycloak:8080']) {
    assert.throws(() => memberWorkerConfiguration(state(), { issuer: ISSUER, adminOrigin, clients, generateSecret: secrets() }), { code: 'STAGING_KEYCLOAK_INTERNAL_URL_INVALID' }, adminOrigin);
  }
  assert.throws(() => memberWorkerConfiguration(state(), { issuer: ISSUER, adminOrigin: 'http://keycloak:8080', clients: { ...clients, clientSecret: '' }, generateSecret: secrets() }), { code: 'STAGING_MEMBER_CLIENTS_INVALID' });
});

test('regenerating the private environment keeps the member selection but no secret', () => {
  assert.deepEqual(carriedSettings('MEMBER_ONBOARDING_RUNTIME=central\nMEMBER_ONBOARDING_DIRECTORY=/members\nRESEND_API_KEY=re_secret\nSESSION_SECRET=x\n'),
    { MEMBER_ONBOARDING_RUNTIME: 'central', MEMBER_ONBOARDING_DIRECTORY: '/members' });
});

test('members --prepare writes only the bridge files, privately, and is repeatable', async t => {
  const { out, env } = workspace(t);
  const fetchImpl = () => { throw Error('prepare must not contact Keycloak'); };
  const result = await members(env, { prepare: true, out }, { fetchImpl });
  assert.deepEqual(result, { prepared: true, realm: 'c4g-staging', files: ['http.json', 'c4g-activation.properties'] });
  assert.deepEqual(fs.readdirSync(out).sort(), ['c4g-activation.properties', 'http.json']);
  const http = JSON.parse(fs.readFileSync(path.join(out, 'http.json'), 'utf8'));
  assert.match(http.bridgeSecret, /^[a-f0-9]{64}$/);
  assert.match(fs.readFileSync(path.join(out, 'c4g-activation.properties'), 'utf8'), new RegExp(`secret=${http.bridgeSecret}\\n$`));
  assert.equal(JSON.stringify(result).includes(http.bridgeSecret), false);
  await members(env, { prepare: true, out }, { fetchImpl });
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'http.json'), 'utf8')).bridgeSecret, http.bridgeSecret);
});

test('members refuses to configure Keycloak without its preconditions and writes no worker file', async t => {
  const { out, env } = workspace(t);
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, async json() { return body; }, async text() { return JSON.stringify(body); } });
  await assert.rejects(members({ ...env, OIDC_ISSUER: undefined }, { out }), { code: 'STAGING_MEMBER_TARGET_REQUIRED' });
  await assert.rejects(members(env, { out: path.join(out, 'missing') }), { code: 'STAGING_MEMBER_FOLDER_MISSING' });
  await assert.rejects(members(env, { out }), { code: 'STAGING_KEYCLOAK_INTERNAL_URL_REQUIRED' });
  const args = { out, 'keycloak-internal': 'http://keycloak:8080' };
  // An internal request that announces another issuer means the hostname is not fixed: the worker's tokens would be refused.
  await assert.rejects(members(env, args, { fetchImpl: async () => json(200, { issuer: 'http://localhost:8080/realms/c4g-staging' }) }), { code: 'STAGING_KEYCLOAK_ISSUER_NOT_FIXED' });
  await assert.rejects(members(env, args, { fetchImpl: async () => { throw Error('ECONNREFUSED'); } }), { code: 'STAGING_KEYCLOAK_UNAVAILABLE' });
  const discovery = async url => (String(url).endsWith('/.well-known/openid-configuration') ? json(200, { issuer: ISSUER }) : json(401, {}));
  await assert.rejects(members(env, args, { fetchImpl: discovery }), { code: 'STAGING_KEYCLOAK_ADMIN_REQUIRED' });
  await assert.rejects(members({ ...env, C4G_KEYCLOAK_ADMIN_USER: 'admin', C4G_KEYCLOAK_ADMIN_PASSWORD: 'synthetic' }, args, { fetchImpl: discovery }), { code: 'STAGING_KEYCLOAK_ADMIN_REFUSED' });
  assert.equal(fs.existsSync(path.join(out, 'worker.json')), false);
});

test('the Keycloak adapter calls the administration API on the private origin when one is configured', async () => {
  const urls = [], user = { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', enabled: true };
  const fetchImpl = async url => { urls.push(url); return { ok: true, status: 200, headers: { get: () => null }, async json() { return user; } }; };
  const options = { issuer: ISSUER, accessToken: async () => 'token', ownershipKey: 'ab'.repeat(32), fetchImpl };
  const input = { operationId: user.id, organizationId: user.id, globalUserId: user.id, membershipId: user.id, input: { expectedSubject: user.id } };
  await createKeycloakAdapter({ ...options, adminOrigin: 'http://keycloak:8080' }).ensure(input);
  await createKeycloakAdapter(options).ensure(input);
  assert.deepEqual(urls, [`http://keycloak:8080/admin/realms/c4g-staging/users/${user.id}`, `https://login.example.test/admin/realms/c4g-staging/users/${user.id}`]);
  for (const adminOrigin of ['keycloak:8080', 'http://keycloak:8080/admin', 'file:///etc', 'http://u:p@keycloak:8080']) {
    assert.throws(() => createKeycloakAdapter({ ...options, adminOrigin }), { code: 'KEYCLOAK_CONFIGURATION_INVALID' }, adminOrigin);
  }
});
