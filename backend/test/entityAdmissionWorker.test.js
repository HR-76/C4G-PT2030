'use strict';
// Privileged admission worker of the staging runtime (context/features/staging-entity-admission.md, phase 2).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { readSettings, buildWorker } = require('../src/entityAdmission/provisioningWorker');
const { WORKER_ENTRY } = require('../src/entityAdmission/admissionRuntime');

const ISSUER = 'https://login.example.test/realms/c4g-staging';
const ORGANIZATION = '10000000-0000-4000-8000-000000000001';
const valid = () => ({ issuer: ISSUER, clientId: 'c4g-admission-worker', clientSecret: 'synthetic', adminOrigin: 'http://keycloak:8080',
  ownershipKey: 'ab'.repeat(32), journalKey: 'cd'.repeat(32), postgres: { host: '127.0.0.1', port: 1, user: 'postgres', password: 'synthetic', ssl: false },
  centralDatabase: 'c4g_central_staging', authority: { user: 'c4g_authority_runtime', password: 'synthetic' }, permitSecret: 'synthetic-permit-secret-of-32-bytes!',
  policyVersion: 'c4g-user-mfa-v1', dataResidencyCode: 'EU', regionCode: 'EU', residencyPolicyVersion: 'staging-v1',
  tenantRoles: { api: ['c4g_opportunity_tenant_runtime'], worker: ['c4g_import_worker_runtime'] } });

function folder(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-admission-worker-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function write(t, settings) {
  const file = path.join(folder(t), 'worker.json');
  fs.writeFileSync(file, typeof settings === 'string' ? settings : JSON.stringify(settings));
  return file;
}

test('the worker file is closed: unknown, missing or malformed values are refused', t => {
  const env = { OIDC_ISSUER: ISSUER };
  assert.deepEqual(readSettings(write(t, valid()), env), valid());
  const { adminOrigin, ...withoutOrigin } = valid();
  assert.equal(adminOrigin, 'http://keycloak:8080'); assert.equal(readSettings(write(t, withoutOrigin), env).adminOrigin, undefined);
  const refused = (change, code) => { const settings = valid(); change(settings); assert.throws(() => readSettings(write(t, settings), env), { code }, code + ' ' + JSON.stringify(settings).slice(0, 80)); };
  assert.throws(() => readSettings(write(t, '{not json'), env), { code: 'ADMISSION_CONFIGURATION_INVALID' });
  assert.throws(() => readSettings(path.join(os.tmpdir(), 'c4g-missing-worker.json'), env), { code: 'ADMISSION_CONFIGURATION_INVALID' });
  refused(s => { s.extra = true; }, 'ADMISSION_CONFIGURATION_INVALID');
  refused(s => { s.ownershipKey = 'short'; }, 'OWNERSHIP_KEY_INVALID');
  refused(s => { s.journalKey = 'CD'.repeat(32); }, 'PROVISIONING_JOURNAL_INVALID');
  for (const change of [s => { s.clientSecret = ''; }, s => { s.adminOrigin = 'http://keycloak:8080/admin'; }, s => { s.certificate = 'relative.pem'; },
    s => { s.postgres.port = 0; }, s => { s.postgres.ssl = 'yes'; }, s => { s.postgres.database = 'x'; }, s => { delete s.postgres.password; },
    s => { s.centralDatabase = 'Central; DROP'; }, s => { s.authority = { user: 'a' }; }, s => { s.permitSecret = 'shorter-than-32-bytes'; },
    s => { s.policyVersion = 'unknown-policy'; }, s => { s.regionCode = ''; }, s => { delete s.residencyPolicyVersion; }]) refused(change, 'ADMISSION_CONFIGURATION_INVALID');
});

test('the roles of the shared aggregators are named by the file and never defaulted', t => {
  const env = { OIDC_ISSUER: ISSUER };
  for (const tenantRoles of [undefined, {}, { api: ['c4g_opportunity_tenant_runtime'] }, { api: [], worker: ['c4g_import_worker_runtime'] }, { api: ['c4g_opportunity_tenant_runtime'], worker: ['Bad Role'] },
    { api: ['c4g_x', 'c4g_x'], worker: ['c4g_y'] }, { api: 'c4g_x', worker: ['c4g_y'] }, { api: ['c4g_x'], worker: ['c4g_y'], other: [] }]) {
    const settings = valid(); if (tenantRoles === undefined) delete settings.tenantRoles; else settings.tenantRoles = tenantRoles;
    assert.throws(() => readSettings(write(t, settings), env), { code: 'ADMISSION_TENANT_ROLES_REQUIRED' }, JSON.stringify(tenantRoles));
  }
});

test('the worker only serves the identity provider the API signs in with, over HTTPS', t => {
  const file = write(t, valid());
  for (const env of [{}, { OIDC_ISSUER: 'https://other.example.test/realms/c4g-staging' }]) assert.throws(() => readSettings(file, env), { code: 'ADMISSION_IDENTITY_REQUIRED' });
  const plain = ISSUER.replace('https:', 'http:');
  assert.throws(() => readSettings(write(t, { ...valid(), issuer: plain }), { OIDC_ISSUER: plain }), { code: 'ADMISSION_IDENTITY_REQUIRED' });
});

function fakes() {
  const state = { pools: [], ended: 0, journals: [], provisioner: null, registry: null, identity: null, completion: null, runs: 0, calls: [], projection: null, fail: false };
  const record = name => async value => { state.calls.push([name, value]); return { from: name }; };
  const dependencies = {
    createPool(options) { state.pools.push(options); return { async end() { state.ended += 1; } }; },
    createCoordinator(options) { state.coordinator = options; return { marker: 'coordinator' }; },
    createDirectory(pool) { state.directoryPool = pool; return { async resolveSnapshotByOrganization(organizationId, workload) { return { organizationId, tenantId: organizationId, workload, databaseRef: 'c4g_onb_x' }; } }; },
    createJournal(options) { state.journals.push(options); return { marker: path.basename(options.directory) }; },
    createProvisioner(options) { state.provisioner = options; return { ensure: record('ensure'), project: record('project'), apiCredentials: record('api'), workerCredentials: record('worker') }; },
    createRegistry(options) { state.registry = options; return { async publish(binding, api, worker) { state.calls.push(['publish', binding, api, worker]); return { published: true }; },
      async resolve(request) { state.calls.push(['resolve', request]); return { login: 'c4g_onb_api_x' }; } }; },
    createIdentity(options) { state.identity = options; return { ensure: record('identity'), passwordReady: record('passwordReady'), passwordSetupPending: record('passwordSetupPending') }; },
    createCompletion(options) { state.completion = options; return { marker: 'completion' }; },
    createCompletionWorker(service) { state.completionService = service; return { async runOnce() { state.runs += 1; if (state.fail) throw Error('private'); return []; } }; },
    createMemberProjection(options) { state.projection = options; return { ensure: record('memberProjection') }; },
    createEmail(options) { state.email = options; return { async send(value) { state.calls.push(['email', value]); return state.emailResult; } }; },
    async probe(input) { state.calls.push(['probe', input.material, input.workload]); }
  };
  return { state, dependencies };
}

test('the invitation email is sent from the worker with the inherited provider settings and answers only a status', async t => {
  const { state, dependencies } = fakes();
  const worker = buildWorker({ settings: valid(), directory: folder(t), dependencies,
    env: { RESEND_API_KEY: 'synthetic-provider-key', ACTIVATION_EMAIL_FROM: 'C4G <convites@example.test>', ACTIVATION_PUBLIC_URL: 'https://app.example.test' } });
  t.after(() => worker.close());
  assert.deepEqual(state.email, { key: 'ab'.repeat(32), apiKey: 'synthetic-provider-key', from: 'C4G <convites@example.test>', origin: 'https://app.example.test', purpose: 'ADMISSION' });
  const value = { invitationId: ORGANIZATION, to: 'ana@example.invalid', secret: 'ef'.repeat(32), expiresAt: '2027-01-01T00:00:00Z', message: { subject: 's' } };
  state.emailResult = { status: 'ACCEPTED', id: 'provider-id', debug: 'not forwarded' };
  assert.deepEqual(await worker.methods.invitationEmail(value), { status: 'ACCEPTED' });
  assert.deepEqual(state.calls.at(-1), ['email', value]);
  state.emailResult = undefined;
  assert.deepEqual(await worker.methods.invitationEmail(value), { status: 'UNCONFIRMED' });
});

test('administration stays inside the worker and only seven closed methods cross the boundary', async t => {
  const { state, dependencies } = fakes(), directory = folder(t);
  let clock = 1000000;
  const worker = buildWorker({ settings: valid(), directory, dependencies, now: () => clock });
  assert.deepEqual(Object.keys(worker.methods).sort(), ['health', 'identity', 'invitationEmail', 'memberProjection', 'passwordReady', 'passwordSetupPending', 'resolve']);

  assert.deepEqual(state.pools.map(pool => [pool.database, pool.user, pool.ssl]), [['c4g_central_staging', 'postgres', false], ['postgres', 'postgres', false], ['c4g_central_staging', 'c4g_authority_runtime', false]]);
  assert.deepEqual([state.coordinator.permitSecret, state.journals.map(journal => path.relative(directory, journal.directory)), state.journals.every(journal => journal.key === 'cd'.repeat(32))],
    ['synthetic-permit-secret-of-32-bytes!', ['provisioning', 'credentials'], true]);
  assert.deepEqual([state.provisioner.regionCode, state.provisioner.residencyPolicyVersion, state.provisioner.connection.database, state.provisioner.connection.host], ['EU', 'staging-v1', 'postgres', '127.0.0.1']);
  assert.deepEqual([state.provisioner.apiRoles, state.provisioner.workerRoles], [['c4g_opportunity_tenant_runtime'], ['c4g_import_worker_runtime']], 'the environment\'s roles, not the isolated default');
  assert.deepEqual([state.identity.issuer, state.identity.purpose, state.identity.usernameMode, state.identity.adminOrigin], [ISSUER, 'ADMISSION', 'email', 'http://keycloak:8080']);
  assert.deepEqual([state.completion.coordinator, state.completion.issuer, state.completion.policyVersion, state.completion.mfaPolicyCode, state.completion.dataResidencyCode],
    [{ marker: 'coordinator' }, ISSUER, 'c4g-user-mfa-v1', 'USER_OPTIONAL', 'EU']);
  assert.equal(typeof state.completion.assuranceRequirements, 'object');

  const binding = { operationId: ORGANIZATION, organizationId: ORGANIZATION, globalUserId: ORGANIZATION, membershipId: ORGANIZATION, input: { secret: 'not forwarded' } };
  await state.completion.tenant.ensure(binding); await state.completion.projection.ensure(binding);
  assert.deepEqual(await state.completion.publishCredentials(binding), { published: true });
  const published = state.calls.at(-1);
  assert.deepEqual([published[0], Object.keys(published[1]).sort(), published[2], published[3]], ['publish', ['globalUserId', 'membershipId', 'operationId', 'organizationId'], { from: 'api' }, { from: 'worker' }]);
  await state.registry.probe({ host: 'h' }, { databaseRef: 'c4g_onb_x' }, 'API');
  assert.deepEqual(state.calls.at(-1), ['probe', { host: 'h' }, 'API']);

  await worker.methods.identity({ a: 1 }); await worker.methods.passwordReady({ subject: 's' });
  assert.deepEqual(state.calls.slice(-2), [['identity', { a: 1 }], ['passwordReady', 's']]);
  assert.deepEqual(await worker.methods.resolve({ tenantId: ORGANIZATION, workload: 'API' }), { login: 'c4g_onb_api_x' });
  await worker.methods.memberProjection({ organizationId: ORGANIZATION, name: 'Pessoa' });
  assert.deepEqual([state.projection.bindings[0].organizationId, state.projection.bindings[0].credentials], [ORGANIZATION, { login: 'c4g_onb_api_x' }]);
  assert.deepEqual(state.projection.allowedResidency, [{ regionCode: 'EU', policyVersion: 'staging-v1' }], 'the staging region, not the local default');
  assert.deepEqual(state.calls.at(-1), ['memberProjection', { organizationId: ORGANIZATION, name: 'Pessoa' }]);

  assert.deepEqual(await worker.methods.health(), { ready: false, lastFailure: null }, 'not ready before the first completed pass');
  await worker.tick();
  assert.deepEqual(await worker.methods.health(), { ready: true, lastFailure: null });
  clock += 16000;
  assert.equal((await worker.methods.health()).ready, false, 'a stalled loop stops being ready');
  state.fail = true; await worker.tick();
  assert.equal((await worker.methods.health()).ready, false, 'a failed pass does not count');
  await worker.close();
  assert.equal(state.ended, 3);
  assert.equal(worker.tick(), null, 'no pass starts after close');
});

test('a failed step is recorded as a code, spaced before the next attempt and cleared by a confirmed pass', async t => {
  const { state, dependencies } = fakes();
  let clock = 5000000, outcome = [{ id: 'a', confirmed: false }];
  dependencies.createProvisioner = options => { state.provisioner = options; return {
    async ensure() { throw Error('LOCAL_IDENTITY_UNEXPECTED_MEMBERSHIP'); }, async project() { throw Object.assign(Error('relation "private_table" does not exist'), { code: '42P01' }); },
    async apiCredentials() { throw Object.assign(Error('x'), { code: 'CREDENTIAL_BINDING_INVALID' }); }, async workerCredentials() { return {}; } }; };
  dependencies.createCompletionWorker = () => ({ async runOnce() { state.runs += 1; return outcome; } });
  const worker = buildWorker({ settings: valid(), directory: folder(t), dependencies, now: () => clock });
  t.after(() => worker.close());
  await assert.rejects(state.completion.tenant.ensure({}), /LOCAL_IDENTITY_UNEXPECTED_MEMBERSHIP/);
  assert.deepEqual((await worker.methods.health()).lastFailure, { step: 'TENANT', code: 'LOCAL_IDENTITY_UNEXPECTED_MEMBERSHIP', at: new Date(clock).toISOString() });
  assert.equal(worker.tick(), null, 'no attempt right after a failure');
  assert.equal(state.runs, 0);
  assert.equal((await worker.methods.health()).ready, true, 'waiting out a failure is a live loop');
  await assert.rejects(state.completion.projection.ensure({}));
  assert.deepEqual([(await worker.methods.health()).lastFailure.step, (await worker.methods.health()).lastFailure.code], ['PROJECTION', '42P01']);
  assert(!JSON.stringify(await worker.methods.health()).includes('private_table'), 'messages never leave the worker');
  await assert.rejects(state.completion.publishCredentials({}));
  assert.equal((await worker.methods.health()).lastFailure.code, 'CREDENTIAL_BINDING_INVALID');
  clock += 59000; assert.equal(worker.tick(), null);
  clock += 2000; await worker.tick();
  assert.equal(state.runs, 1);
  assert.notEqual((await worker.methods.health()).lastFailure, null, 'an unconfirmed pass keeps the failure');
  outcome = [{ id: 'a', confirmed: true }]; await worker.tick();
  assert.equal((await worker.methods.health()).lastFailure, null);
});

test('the technical token is requested from the issuer, reused until it nears expiry and never fetched over a redirect', async t => {
  const { state, dependencies } = fakes(), requests = [];
  let clock = 0, ok = true;
  const worker = buildWorker({ settings: valid(), directory: folder(t), dependencies, now: () => clock,
    async fetchImpl(url, options) { requests.push([url, options.method, options.redirect, options.body.get('client_id'), options.body.get('grant_type')]);
      return { ok, async json() { return { access_token: 'token-' + requests.length, expires_in: 60 }; } }; } });
  t.after(() => worker.close());
  assert.equal(await state.identity.accessToken(), 'token-1');
  assert.deepEqual(requests[0], [ISSUER + '/protocol/openid-connect/token', 'POST', 'error', 'c4g-admission-worker', 'client_credentials']);
  clock = 39000; assert.equal(await state.identity.accessToken(), 'token-1');
  clock = 41000; assert.equal(await state.identity.accessToken(), 'token-2');
  ok = false; clock = 200000;
  await assert.rejects(state.identity.accessToken(), { code: 'KEYCLOAK_UNAVAILABLE' });
});

function runProcess(t, settings, env, exchange) {
  const file = write(t, settings);
  return new Promise(resolve => {
    const child = fork(WORKER_ENTRY, [file], { env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const answers = [];
    child.on('message', message => {
      if (message.ready) { if (!exchange?.length) { resolve({ ready: true, answers }); child.disconnect(); return; } for (const [id, method] of exchange.entries()) child.send({ id, method, value: {} }); return; }
      answers[message.id] = message.error || Object.keys(message.result).join(',');
      if (answers.filter(Boolean).length === exchange.length) { resolve({ ready: true, answers }); child.disconnect(); }
    });
    child.once('exit', code => resolve({ ready: false, code, answers }));
  });
}

test('as a process, the worker starts only with a valid file and denies methods outside the closed list', async t => {
  const clean = { OIDC_ISSUER: undefined };
  assert.equal((await runProcess(t, valid(), clean)).ready, false);
  assert.equal((await runProcess(t, { ...valid(), extra: 1 }, { OIDC_ISSUER: ISSUER })).ready, false);
  // No database listens on port 1: the worker still answers, reports itself not ready and never leaks the failure.
  const running = await runProcess(t, valid(), { OIDC_ISSUER: ISSUER }, ['health', 'provision', 'resolve']);
  assert.equal(running.ready, true);
  assert.deepEqual(running.answers.slice(0, 2), ['ready,lastFailure', 'WORKER_METHOD_DENIED']);
  assert.match(running.answers[2], /^[A-Z0-9_]+$/);
});

test('the provisioner refuses role sets that are missing or malformed', () => {
  const { createPostgresProvisioner } = require('../src/platformOnboarding/postgresProvisioner');
  for (const roles of [{ apiRoles: [] }, { workerRoles: ['Bad Role'] }, { apiRoles: 'c4g_x' }, { workerRoles: [42] }]) {
    assert.throws(() => createPostgresProvisioner({ adminPool: {}, centralPool: {}, connection: {}, journal: {}, ownershipKey: 'ab'.repeat(32), ...roles }), { code: 'PROVISIONING_ROLES_INVALID' }, JSON.stringify(roles));
  }
});

// Automatic schema upgrade of a database created by admission (context/features/staging-entity-admission.md).
const { createTenantUpgrade } = require('../src/entityAdmission/provisioningWorker');
const GENERATION = '22222222-2222-4222-8222-222222222222';
const DATABASE = 'c4g_onb_' + 'a'.repeat(32);

test('the upgrade setting is optional, closed and names a known profile', t => {
  const env = { OIDC_ISSUER: ISSUER };
  const accepted = readSettings(write(t, { ...valid(), tenantUpgrade: { profile: 'staging-registered-v1', installationId: 'installation-1' } }), env);
  assert.deepEqual(accepted.tenantUpgrade, { profile: 'staging-registered-v1', installationId: 'installation-1' });
  assert.equal(readSettings(write(t, valid()), env).tenantUpgrade, undefined);
  for (const tenantUpgrade of [null, 'staging-registered-v1', {}, { profile: 'staging-registered-v1' }, { profile: 'unknown', installationId: 'i' },
    { profile: 'staging-registered-v1', installationId: '' }, { profile: 'staging-registered-v1', installationId: 'i', extra: 1 }, { profile: 'constructor', installationId: 'i' }]) {
    assert.throws(() => readSettings(write(t, { ...valid(), tenantUpgrade }), env), { code: 'ADMISSION_TENANT_UPGRADE_INVALID' }, JSON.stringify(tenantUpgrade));
  }
});

test('without the setting a new database is only provisioned; with it, it is reconciled, provisioned and then upgraded', async t => {
  const plain = fakes();
  const worker = buildWorker({ settings: valid(), directory: folder(t), dependencies: plain.dependencies });
  t.after(() => worker.close());
  await plain.state.completion.tenant.ensure({ organizationId: ORGANIZATION });
  assert.deepEqual(plain.state.calls.map(call => call[0]), ['ensure']);

  const upgraded = fakes(), order = [];
  upgraded.dependencies.createTenantUpgrade = options => { upgraded.state.upgrade = options; return {
    async resync(id) { order.push(['resync', id]); }, async apply(id) { order.push(['apply', id]); if (upgraded.state.applyFails) throw Object.assign(Error('x'), { code: 'TENANT_MIGRATION_OWNER_MISMATCH' }); } }; };
  upgraded.dependencies.createProvisioner = () => ({ async ensure(value) { order.push(['ensure', value.organizationId]); return { from: 'ensure' }; }, async project() {}, async apiCredentials() {}, async workerCredentials() {} });
  const second = buildWorker({ settings: { ...valid(), tenantUpgrade: { profile: 'staging-registered-v1', installationId: 'installation-1' } }, directory: folder(t), dependencies: upgraded.dependencies });
  t.after(() => second.close());
  assert.deepEqual([upgraded.state.upgrade.profile, upgraded.state.upgrade.installationId, upgraded.state.upgrade.administration.user, typeof upgraded.state.upgrade.createPool], ['staging-registered-v1', 'installation-1', 'postgres', 'function']);
  assert.deepEqual(await upgraded.state.completion.tenant.ensure({ organizationId: ORGANIZATION }), { from: 'ensure' });
  assert.deepEqual(order, [['resync', ORGANIZATION], ['ensure', ORGANIZATION], ['apply', ORGANIZATION]]);
  upgraded.state.applyFails = true;
  await assert.rejects(upgraded.state.completion.tenant.ensure({ organizationId: ORGANIZATION }), { code: 'TENANT_MIGRATION_OWNER_MISMATCH' });
  assert.deepEqual((await second.methods.health()).lastFailure.code, 'TENANT_MIGRATION_OWNER_MISMATCH', 'a refused step is visible as the admission failure');
});

function upgradeHarness({ rows, head = '033_organizational_opportunity_interests', synced = 'PUBLISHED' } = {}) {
  const events = [], pools = [];
  const central = { async query(sql, values) { events.push(['central', values]); assert.match(sql, /tenant_database_generation g LEFT JOIN public\.tenant_schema_state/); return { rows }; } };
  const createPool = options => { const pool = { options, ended: false, async query(sql) { events.push(['head', sql]); return { rows: head ? [{ version: head }] : [] }; }, async end() { this.ended = true; } }; pools.push(pool); return pool; };
  const steps = { TENANT_HEAD_SQL: 'HEAD', onboardedObservationScope: (installation, tenant) => `${installation}-${tenant}`,
    pendingTenantSteps: from => { events.push(['pending', from]); return ['step-a', 'step-b']; },
    async applyTenantSteps(input) { events.push(['apply', input.steps, input.tenant === pools.at(-1), input.central === central, input.identity, input.installationId, input.observationScope]); return ['a:PUBLISHED', 'b:PUBLISHED']; } };
  const upgrade = createTenantUpgrade({ profile: 'staging-registered-v1', installationId: 'installation-1', central, createPool,
    administration: { host: 'h', port: 5432, user: 'postgres', password: 'synthetic', ssl: false }, dependencies: { steps,
      async preflightTenant(pool, identity, manifest, options) { events.push(['preflight', pool === pools.at(-1), identity, manifest, options.timeoutMs]); return { tenantId: identity.tenantId, currentVersion: head }; },
      async syncCentralObservation(input) { events.push(['sync', input.tenantId, input.apply, input.idempotencyScope, input.installationId]); return { status: synced }; } } });
  return { upgrade, events, pools };
}
const published = state => [{ database_ref: DATABASE, tenant_id: ORGANIZATION, database_generation_id: GENERATION, compatibility_state: state }];
const TARGET = { tenantId: ORGANIZATION, databaseGenerationId: GENERATION };

test('apply runs the steps the database still lacks, on that database, under the tenant scope, and closes its pool', async () => {
  const h = upgradeHarness({ rows: published('COMPATIBLE') });
  assert.deepEqual(await h.upgrade.apply(ORGANIZATION), ['a:PUBLISHED', 'b:PUBLISHED']);
  assert.deepEqual(h.events, [['central', [ORGANIZATION]], ['head', 'HEAD'], ['pending', '033_organizational_opportunity_interests'],
    ['apply', ['step-a', 'step-b'], true, true, TARGET, 'installation-1', `installation-1-${ORGANIZATION}`]]);
  assert.deepEqual([h.pools[0].options.database, h.pools[0].options.user, h.pools[0].options.options, h.pools[0].ended], [DATABASE, 'postgres', '-c timezone=UTC', true]);
});

test('apply refuses anything that is not exactly one admission database with a schema ledger', async () => {
  for (const rows of [[], [...published('COMPATIBLE'), ...published('COMPATIBLE')], [{ ...published('COMPATIBLE')[0], database_ref: 'c4g_tenant_staging' }], [{ ...published('COMPATIBLE')[0], database_ref: 'c4g_onb_x; drop' }]]) {
    const h = upgradeHarness({ rows });
    await assert.rejects(h.upgrade.apply(ORGANIZATION), { code: 'TENANT_UPGRADE_TARGET_MISSING' }, JSON.stringify(rows));
    assert.equal(h.pools.length, 0, 'no connection is opened to a database that is not the target');
  }
  const empty = upgradeHarness({ rows: published('COMPATIBLE'), head: null });
  await assert.rejects(empty.upgrade.apply(ORGANIZATION), { code: 'TENANT_UPGRADE_HEAD_MISSING' });
  assert.equal(empty.pools[0].ended, true);
});

test('resync tells Central where a published database really is and does nothing before the first publication', async () => {
  const h = upgradeHarness({ rows: published('COMPATIBLE'), head: '034_application_snapshot_v2' });
  assert.deepEqual(await h.upgrade.resync(ORGANIZATION), { resynced: true });
  assert.deepEqual(h.events.slice(1), [['preflight', true, TARGET, undefined, 15000], ['sync', ORGANIZATION, true, `installation-1-${ORGANIZATION}`, 'installation-1']]);
  assert.equal(h.pools[0].ended, true);
  assert.deepEqual(await upgradeHarness({ rows: published('COMPATIBLE'), synced: 'IN_SYNC' }).upgrade.resync(ORGANIZATION), { resynced: false });
  for (const rows of [[], published('UNKNOWN'), published(null)]) {
    const before = upgradeHarness({ rows });
    assert.deepEqual(await before.upgrade.resync(ORGANIZATION), { resynced: false });
    assert.equal(before.pools.length, 0);
  }
});

test('the staging profile is the installer\'s own list of steps', () => {
  const steps = require('../scripts/staging/tenantSteps'), installer = require('../scripts/staging/install');
  assert.equal(installer.TENANT_STEPS, steps.TENANT_STEPS);
  assert.equal(installer.applyTenantSteps, steps.applyTenantSteps);
  assert.deepEqual(steps.TENANT_STEPS.map(([to]) => to.slice(0, 3)), ['034', '035', '036', '037', '038', '039', '040', '041']);
});
