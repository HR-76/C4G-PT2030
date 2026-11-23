'use strict';
// Staging installer: entity admission (context/features/staging-entity-admission.md, phase 3).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { admission, assertOnboardedTenantsCovered, ONBOARDED_TENANTS_SQL, main } = require('../scripts/staging/install');
const { admissionWorkerConfiguration } = require('../scripts/staging/environment');
const { readSettings } = require('../src/entityAdmission/provisioningWorker');
const { allowedRedirects } = require('../src/platformOnboarding/configureMemberIdentity');

const ISSUER = 'https://login.example.test/realms/c4g-staging';
const ORIGIN = 'https://app.example.test';
const INSTALLATION = 'installation-1';
const REDIRECTS = [ORIGIN + '/api/activation/callback', ORIGIN + '/api/admission-activation/callback'];
const state = () => ({ phase: 'READY', installationId: INSTALLATION, organizationId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  authorityPassword: 'synthetic-authority', permitSecret: 'synthetic-permit-secret-of-32-bytes!' });
const member = () => ({ issuer: ISSUER, adminOrigin: 'http://keycloak:8080', clientId: 'c4g-member-worker', clientSecret: 'synthetic-client-secret', ownershipKey: 'aa'.repeat(32) });
const secrets = () => { let n = 0; return () => (++n).toString(16).padStart(2, '0').repeat(32); };
const target = { postgres: { host: 'c4g-postgres', port: 5432, password: 'synthetic-admin' }, centralDatabase: 'c4g_central_staging' };

test('the worker file is one the worker accepts, and repeating keeps both keys', t => {
  const first = admissionWorkerConfiguration(state(), { issuer: ISSUER, member: member(), ...target, generateSecret: secrets() });
  assert.deepEqual(first, { issuer: ISSUER, adminOrigin: 'http://keycloak:8080', clientId: 'c4g-member-worker', clientSecret: 'synthetic-client-secret',
    ownershipKey: '01'.repeat(32), journalKey: '02'.repeat(32), postgres: { host: 'c4g-postgres', port: 5432, user: 'postgres', password: 'synthetic-admin', ssl: true },
    centralDatabase: 'c4g_central_staging', authority: { user: 'c4g_authority_runtime', password: 'synthetic-authority' }, permitSecret: 'synthetic-permit-secret-of-32-bytes!',
    policyVersion: 'c4g-user-mfa-v1', dataResidencyCode: 'EU', regionCode: 'EU', residencyPolicyVersion: 'staging-v1' });
  assert.notEqual(first.ownershipKey, member().ownershipKey, 'admission has its own ownership key');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-staging-admission-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'worker.json'); fs.writeFileSync(file, JSON.stringify(first));
  assert.deepEqual(readSettings(file, { OIDC_ISSUER: ISSUER }), first);
  const again = admissionWorkerConfiguration(state(), { issuer: ISSUER, member: member(), ...target, prior: first, generateSecret() { throw Error('must not regenerate'); } });
  assert.deepEqual([again.ownershipKey, again.journalKey], [first.ownershipKey, first.journalKey]);
});

test('the worker file is refused without a ready installation, the member worker or a usable target', () => {
  const build = (changes = {}, s = state()) => admissionWorkerConfiguration(s, { issuer: ISSUER, member: member(), ...target, generateSecret: secrets(), ...changes });
  for (const broken of [{ ...state(), phase: 'INSTALLING' }, { ...state(), authorityPassword: undefined }, { ...state(), permitSecret: '' }, null]) assert.throws(() => build({}, broken), { code: 'STAGING_INSTALLATION_NOT_READY' });
  for (const other of [null, { ...member(), issuer: 'https://other.example.test/realms/x' }, { ...member(), clientSecret: '' }, { ...member(), adminOrigin: undefined }]) assert.throws(() => build({ member: other }), { code: 'STAGING_MEMBERS_REQUIRED' });
  for (const bad of [{ postgres: null }, { postgres: { ...target.postgres, port: '5432' } }, { postgres: { ...target.postgres, password: '' } }, { centralDatabase: '' }]) assert.throws(() => build(bad), { code: 'STAGING_ADMISSION_TARGET_INVALID' });
  assert.throws(() => build({ prior: { ownershipKey: 'short', journalKey: '02'.repeat(32) } }), { code: 'STAGING_ADMISSION_SECRET_INVALID' });
  assert.throws(() => build({ generateSecret: () => '03'.repeat(32) }), { code: 'STAGING_ADMISSION_SECRET_INVALID' }, 'the two keys are never the same');
});

function workspace(t, { withMember = true } = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-staging-admission-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const stateFile = path.join(folder, 'install.json'), out = path.join(folder, 'admissions'), members = path.join(folder, 'members');
  fs.writeFileSync(stateFile, JSON.stringify(state())); fs.mkdirSync(out); fs.mkdirSync(members);
  if (withMember) fs.writeFileSync(path.join(members, 'worker.json'), JSON.stringify(member()));
  return { out, members, env: { C4G_STAGING_STATE: stateFile, OIDC_ISSUER: ISSUER, PUBLIC_APP_URL: ORIGIN, POSTGRES_PASSWORD: 'synthetic-admin',
    C4G_KEYCLOAK_ADMIN_USER: 'admin', C4G_KEYCLOAK_ADMIN_PASSWORD: 'synthetic' } };
}

// A Keycloak that holds the two activation clients and records every request.
function keycloak({ marker = INSTALLATION, ignorePut = false } = {}) {
  const calls = [], clients = new Map([['c4g-member-activation', { id: 'id-manual' }], ['c4g-member-existing', { id: 'id-existing' }]].map(([clientId, base]) =>
    [base.id, { ...base, clientId, publicClient: true, redirectUris: [REDIRECTS[0]], attributes: { 'c4g.member.installation': marker } }]));
  const json = body => ({ ok: true, async json() { return body; }, async text() { return body === null ? '' : JSON.stringify(body); } });
  return { calls, clients, async fetchImpl(url, options = {}) {
    const route = new URL(url).pathname + new URL(url).search; calls.push([options.method || 'GET', route]);
    if (route === '/realms/master/protocol/openid-connect/token') return json({ access_token: 'token' });
    const admin = route.replace('/admin/realms/c4g-staging/', '');
    if (admin.startsWith('clients?clientId=')) return json([...clients.values()].filter(c => c.clientId === decodeURIComponent(admin.split('=')[1])).map(c => ({ id: c.id, attributes: c.attributes })));
    const id = admin.replace('clients/', '');
    if (options.method === 'PUT') { if (!ignorePut) clients.set(id, JSON.parse(options.body)); return json(null); }
    return json(clients.get(id));
  } };
}

test('the command lets both activation clients return to the admission pages and writes the worker file once', async t => {
  const w = workspace(t), kc = keycloak();
  const result = await admission(w.env, { out: w.out, members: w.members }, { fetchImpl: kc.fetchImpl });
  assert.deepEqual(result, { configured: true, realm: 'c4g-staging', clients: ['c4g-member-activation', 'c4g-member-existing'], files: ['worker.json'] });
  for (const client of kc.clients.values()) { assert.deepEqual(client.redirectUris, REDIRECTS); assert.equal(client.publicClient, true, 'the rest of the client is preserved'); }
  const file = path.join(w.out, 'worker.json'), written = readSettings(file, { OIDC_ISSUER: ISSUER });
  assert.deepEqual([written.postgres.host, written.postgres.port, written.postgres.ssl, written.centralDatabase, written.clientId], ['c4g-postgres', 5432, true, 'c4g_central_staging', 'c4g-member-worker']);
  assert(!JSON.stringify(result).includes('synthetic'), 'nothing secret is printed');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  const puts = kc.calls.filter(([method]) => method === 'PUT').length;
  await admission(w.env, { out: w.out, members: w.members }, { fetchImpl: kc.fetchImpl });
  assert.equal(kc.calls.filter(([method]) => method === 'PUT').length, puts, 'a repeat changes nothing in Keycloak');
  const repeated = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual([repeated.ownershipKey, repeated.journalKey], [written.ownershipKey, written.journalKey]);
});

test('the command refuses before touching Keycloak when its prerequisites are missing', async t => {
  const untouched = { async fetchImpl() { throw Error('MUST_NOT_CALL_KEYCLOAK'); } };
  const w = workspace(t, { withMember: false });
  await assert.rejects(admission(w.env, { out: w.out, members: w.members }, untouched), { code: 'STAGING_MEMBERS_REQUIRED' });
  const ready = workspace(t);
  await assert.rejects(admission(ready.env, { out: path.join(ready.out, 'missing'), members: ready.members }, untouched), { code: 'STAGING_ADMISSION_FOLDER_MISSING' });
  await assert.rejects(admission({ ...ready.env, PUBLIC_APP_URL: undefined }, { out: ready.out, members: ready.members }, untouched), { code: 'STAGING_MEMBER_TARGET_REQUIRED' });
  await assert.rejects(admission({ ...ready.env, POSTGRES_PASSWORD: undefined }, { out: ready.out, members: ready.members }, untouched), { code: 'STAGING_POSTGRES_PASSWORD_REQUIRED' });
  await assert.rejects(admission({ ...ready.env, C4G_KEYCLOAK_ADMIN_PASSWORD: undefined }, { out: ready.out, members: ready.members }, untouched), { code: 'STAGING_KEYCLOAK_ADMIN_REQUIRED' });
  assert.equal(fs.existsSync(path.join(ready.out, 'worker.json')), false);
});

test('the command changes only clients of this installation and writes nothing if Keycloak did not apply the change', async t => {
  const foreign = workspace(t), other = keycloak({ marker: 'another-installation' });
  await assert.rejects(admission(foreign.env, { out: foreign.out, members: foreign.members }, { fetchImpl: other.fetchImpl }), { code: 'STAGING_MEMBER_CLIENTS_INVALID' });
  assert.equal(other.calls.some(([method]) => method === 'PUT'), false);
  const ignored = workspace(t), deaf = keycloak({ ignorePut: true });
  await assert.rejects(admission(ignored.env, { out: ignored.out, members: ignored.members }, { fetchImpl: deaf.fetchImpl }), { code: 'STAGING_ADMISSION_REDIRECT_NOT_APPLIED' });
  for (const w of [foreign, ignored]) assert.equal(fs.existsSync(path.join(w.out, 'worker.json')), false);
});

test('repeating the member setup accepts the admission return address and still refuses any other', () => {
  assert.equal(allowedRedirects(REDIRECTS, ORIGIN), true);
  assert.equal(allowedRedirects([REDIRECTS[1], REDIRECTS[0]], ORIGIN), true);
  assert.equal(allowedRedirects([REDIRECTS[0]], ORIGIN), true);
  for (const uris of [[REDIRECTS[1]], [...REDIRECTS, ORIGIN + '/other'], [REDIRECTS[0], 'https://attacker.example/api/activation/callback'],
    [REDIRECTS[0], REDIRECTS[0]], [REDIRECTS[0], ORIGIN + '/api/admission-activation/callback?x=1'], [], undefined, REDIRECTS[0]]) {
    assert.equal(allowedRedirects(uris, ORIGIN), false, JSON.stringify(uris));
  }
});

test('upgrade never leaves entities created by admission behind without being told to', async t => {
  const refused = input => assert.throws(() => assertOnboardedTenantsCovered(input), { code: 'STAGING_UPGRADE_ONBOARDED_TENANTS_UNSUPPORTED' });
  refused({ apply: true, pendingTenant: ['041_x'], onboarded: ['c4g_onb_a'], skip: false });
  for (const allowed of [{ apply: false, pendingTenant: ['041_x'], onboarded: ['c4g_onb_a'], skip: false }, { apply: true, pendingTenant: [], onboarded: ['c4g_onb_a'], skip: false },
    { apply: true, pendingTenant: ['041_x'], onboarded: [], skip: false }, { apply: true, pendingTenant: ['041_x'], onboarded: ['c4g_onb_a'], skip: true }]) assert.doesNotThrow(() => assertOnboardedTenantsCovered(allowed));
  assert.match(ONBOARDED_TENANTS_SQL, /^SELECT database_ref FROM public\.tenant_database_generation WHERE retired_at IS NULL AND database_ref ~ '\^c4g_onb_'/);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-staging-upgrade-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const env = { POSTGRES_PASSWORD: 'synthetic', C4G_STAGING_STATE: path.join(folder, 'missing.json') };
  await assert.rejects(() => main(['upgrade', '--apply', '--skip-onboarded'], env), { code: 'STAGING_INSTALLATION_NOT_READY' }, 'the flag is accepted');
  await assert.rejects(() => main(['admission', '--bogus'], env), { code: 'STAGING_ARGUMENT_INVALID' });
});
