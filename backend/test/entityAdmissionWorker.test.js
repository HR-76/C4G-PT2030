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
  policyVersion: 'c4g-user-mfa-v1', dataResidencyCode: 'EU', regionCode: 'EU', residencyPolicyVersion: 'staging-v1' });

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
    createIdentity(options) { state.identity = options; return { ensure: record('identity'), passwordReady: record('passwordReady') }; },
    createCompletion(options) { state.completion = options; return { marker: 'completion' }; },
    createCompletionWorker(service) { state.completionService = service; return { async runOnce() { state.runs += 1; if (state.fail) throw Error('private'); return []; } }; },
    createMemberProjection(options) { state.projection = options; return { ensure: record('memberProjection') }; },
    async probe(input) { state.calls.push(['probe', input.material, input.workload]); }
  };
  return { state, dependencies };
}

test('administration stays inside the worker and only five closed methods cross the boundary', async t => {
  const { state, dependencies } = fakes(), directory = folder(t);
  let clock = 1000000;
  const worker = buildWorker({ settings: valid(), directory, dependencies, now: () => clock });
  assert.deepEqual(Object.keys(worker.methods).sort(), ['health', 'identity', 'memberProjection', 'passwordReady', 'resolve']);

  assert.deepEqual(state.pools.map(pool => [pool.database, pool.user, pool.ssl]), [['c4g_central_staging', 'postgres', false], ['postgres', 'postgres', false], ['c4g_central_staging', 'c4g_authority_runtime', false]]);
  assert.deepEqual([state.coordinator.permitSecret, state.journals.map(journal => path.relative(directory, journal.directory)), state.journals.every(journal => journal.key === 'cd'.repeat(32))],
    ['synthetic-permit-secret-of-32-bytes!', ['provisioning', 'credentials'], true]);
  assert.deepEqual([state.provisioner.regionCode, state.provisioner.residencyPolicyVersion, state.provisioner.connection.database, state.provisioner.connection.host], ['EU', 'staging-v1', 'postgres', '127.0.0.1']);
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

  assert.deepEqual(await worker.methods.health(), { ready: false }, 'not ready before the first completed pass');
  await worker.tick();
  assert.deepEqual(await worker.methods.health(), { ready: true });
  clock += 16000;
  assert.deepEqual(await worker.methods.health(), { ready: false }, 'a stalled loop stops being ready');
  state.fail = true; await worker.tick();
  assert.deepEqual(await worker.methods.health(), { ready: false }, 'a failed pass does not count');
  await worker.close();
  assert.equal(state.ended, 3);
  assert.equal(worker.tick(), null, 'no pass starts after close');
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
  assert.deepEqual(running.answers.slice(0, 2), ['ready', 'WORKER_METHOD_DENIED']);
  assert.match(running.answers[2], /^[A-Z0-9_]+$/);
});
