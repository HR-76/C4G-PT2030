'use strict';
// Staging installer: entity admission (context/features/staging-entity-admission.md, phase 3).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { admission, applyTenantSteps, pendingTenantSteps, ONBOARDED_TENANTS_SQL, TENANT_STEPS, main } = require('../scripts/staging/install');
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
    policyVersion: 'c4g-user-mfa-v1', dataResidencyCode: 'EU', regionCode: 'EU', residencyPolicyVersion: 'staging-v1',
    // The same roles the staging installation grants to the shared aggregators (scripts/localPlatform/schema.js).
    tenantRoles: { api: ['c4g_opportunity_tenant_runtime'], worker: ['c4g_import_worker_runtime'] } });
  assert.match(fs.readFileSync(path.join(__dirname, '../scripts/localPlatform/schema.js'), 'utf8'), /apiRoles: \['c4g_opportunity_tenant_runtime'\], workerRoles: \['c4g_import_worker_runtime'\]/);
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

test('upgrade lists the admission databases with the identity Central recorded and what each still needs', async t => {
  assert.match(ONBOARDED_TENANTS_SQL, /^SELECT database_ref, tenant_id, database_generation_id FROM public\.tenant_database_generation WHERE retired_at IS NULL AND database_ref ~ '\^c4g_onb_' ORDER BY database_ref$/);
  assert.deepEqual(pendingTenantSteps('033_organizational_opportunity_interests').map(([to]) => to), TENANT_STEPS.map(([to]) => to));
  assert.deepEqual(pendingTenantSteps('039_document_deletion').map(([to]) => to), ['040_application_chat_retention', '041_account_identity_erasure']);
  assert.deepEqual(pendingTenantSteps(TENANT_STEPS.at(-1)[0]), []);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-staging-upgrade-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const env = { POSTGRES_PASSWORD: 'synthetic', C4G_STAGING_STATE: path.join(folder, 'missing.json') };
  await assert.rejects(() => main(['upgrade', '--apply', '--skip-onboarded'], env), { code: 'STAGING_INSTALLATION_NOT_READY' }, 'the flag is accepted');
  await assert.rejects(() => main(['admission', '--bogus'], env), { code: 'STAGING_ARGUMENT_INVALID' });
});

// One tenant database and a Central that records what it is told; every dependency of a step is a recorder.
function migrationHarness({ failAt = null, wrongVersionAt = null } = {}) {
  const events = [], tenant = { name: 'tenant-pool' }, central = { name: 'central-pool' };
  let version = '033';
  const dependencies = {
    runners: { marker: 'runners' },
    nativePool: pool => ({ native: pool }),
    async withInstallerAuthority(pool, options, work) {
      events.push(['elevate', pool === central, options.targets[0] === central]);
      let demoted = false;
      try { return await work({ async demote() { demoted = true; events.push(['demote']); } }); } finally { if (!demoted) events.push(['demote-on-failure']); }
    },
    async preflightTenant(pool, identity, manifest, options) { events.push(['preflight', pool === tenant, identity.tenantId, manifest, options.timeoutMs]); return { tenantId: identity.tenantId, currentVersion: wrongVersionAt === version ? 'other' : version, schemaFingerprint: 'fp-' + version, capabilities: [] }; },
    async syncCentralObservation(input) { events.push(['sync', input.central === central, input.tenantId, input.observation.currentVersion, input.apply, input.installationId]); return { status: 'PUBLISHED' }; }
  };
  const step = to => [to, (runners, options) => ({ async migrate(input) {
    events.push(['migrate', to, runners === dependencies.runners, options.pool.native === tenant, input.tenantId, input.databaseGenerationId, input.idempotencyKey]);
    if (failAt === to) throw Object.assign(new Error('TENANT_MIGRATION_OWNER_MISMATCH'), { code: 'TENANT_MIGRATION_OWNER_MISMATCH' });
    version = to;
  } })];
  return { events, tenant, central, dependencies, step };
}
const IDENTITY = { tenantId: 'e168701f-6e1f-4938-93fd-a1ff934a91c3', databaseGenerationId: '11111111-1111-4111-8111-111111111111' };

test('each registered step is applied to the given database, verified and told to Central before the next one', async () => {
  const h = migrationHarness(), seen = [];
  const applied = await applyTenantSteps({ steps: [h.step('034'), h.step('035')], central: h.central, tenant: h.tenant, identity: IDENTITY, installationId: 'installation-1',
    onStep: observation => { seen.push(observation.currentVersion); }, dependencies: h.dependencies });
  assert.deepEqual(applied, ['034:PUBLISHED', '035:PUBLISHED']);
  assert.deepEqual(seen, ['034', '035']);
  assert.deepEqual(h.events, [
    ['elevate', true, true], ['migrate', '034', true, true, IDENTITY.tenantId, IDENTITY.databaseGenerationId, `installation-1-${IDENTITY.tenantId}-034`], ['demote'],
    ['preflight', true, IDENTITY.tenantId, undefined, 15000], ['sync', true, IDENTITY.tenantId, '034', true, 'installation-1'],
    ['elevate', true, true], ['migrate', '035', true, true, IDENTITY.tenantId, IDENTITY.databaseGenerationId, `installation-1-${IDENTITY.tenantId}-035`], ['demote'],
    ['preflight', true, IDENTITY.tenantId, undefined, 15000], ['sync', true, IDENTITY.tenantId, '035', true, 'installation-1']]);
  assert.deepEqual(await applyTenantSteps({ steps: [], central: h.central, tenant: h.tenant, identity: IDENTITY, installationId: 'installation-1', dependencies: h.dependencies }), []);
});

test('a refused step stops that database at once, with the elevated window closed and Central untouched for it', async () => {
  const h = migrationHarness({ failAt: '035' });
  await assert.rejects(applyTenantSteps({ steps: [h.step('034'), h.step('035'), h.step('036')], central: h.central, tenant: h.tenant, identity: IDENTITY, installationId: 'i', dependencies: h.dependencies }),
    { code: 'TENANT_MIGRATION_OWNER_MISMATCH' });
  assert.deepEqual(h.events.map(event => event[0] + (event[1] && typeof event[1] === 'string' ? ':' + event[1] : '')),
    ['elevate', 'migrate:034', 'demote', 'preflight', 'sync', 'elevate', 'migrate:035', 'demote-on-failure']);
  const wrong = migrationHarness({ wrongVersionAt: '034' });
  await assert.rejects(applyTenantSteps({ steps: [wrong.step('034'), wrong.step('035')], central: wrong.central, tenant: wrong.tenant, identity: IDENTITY, installationId: 'i', dependencies: wrong.dependencies }),
    { code: 'STAGING_UPGRADE_TENANT_VERSION_UNEXPECTED' });
  assert.equal(wrong.events.some(event => event[0] === 'sync'), false, 'a database on an unexpected version is never recorded in Central');
  assert.equal(wrong.events.filter(event => event[0] === 'migrate').length, 1);
});
