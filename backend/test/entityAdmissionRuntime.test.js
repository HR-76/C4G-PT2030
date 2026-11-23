'use strict';
// Entity admission composed outside the local installer (context/features/staging-entity-admission.md, phase 1).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { configuredEntityAdmission, WORKER_ENTRY } = require('../src/entityAdmission/admissionRuntime');
const { configuredMemberOnboarding } = require('../src/platformOnboarding/memberRuntime');
const { start } = require('../src/server');

const ISSUER = 'https://login.example.test/realms/c4g-staging';
const ORIGIN = 'https://app.example.test';
const SECRET = 'ab'.repeat(32);
const SUBJECT = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const WORKER_DIRECTORY = path.resolve(os.tmpdir(), 'c4g-admission-worker');
const authConfig = { policyVersion: 'c4g-user-mfa-v1', privilegedLoginCategory: 'privileged', assurancePolicy: { privileged: { level: 1 } } };

function memberDirectory(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-admission-members-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.writeFileSync(path.join(folder, 'http.json'), JSON.stringify({ issuer: ISSUER, origin: ORIGIN, manualClientId: 'c4g-member-activation',
    existingClientId: 'c4g-member-existing', bridgeSecret: SECRET, dataResidencyCode: 'EU' }));
  return folder;
}
const environment = folder => ({ ENTITY_ADMISSION_RUNTIME: 'central', ENTITY_ADMISSION_DIRECTORY: WORKER_DIRECTORY, MEMBER_ONBOARDING_RUNTIME: 'central',
  MEMBER_ONBOARDING_DIRECTORY: folder, OIDC_ISSUER: ISSUER, PUBLIC_APP_URL: ORIGIN, MEMBER_ACTIVATION_BRIDGE_PORT: '0', MEMBER_ACTIVATION_BRIDGE_HOST: '127.0.0.1' });
const pool = { async query() { return { rows: [] }; } };

function request(server, { method = 'GET', route, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: route, method, headers }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.once('error', reject); req.end(body);
  });
}

function fakes({ workerFails = false } = {}) {
  const calls = [], state = { closed: 0, worker: null, service: null, completion: null, listing: null, oidc: null };
  return { calls, state,
    createWorker(file, entry) { state.worker = [file, entry]; return { async call(method, value) { calls.push([method, value]); if (workerFails) throw Error('WORKER_UNAVAILABLE'); return { method }; }, async close() { state.closed += 1; } }; },
    createService(options) { state.service = options; return { marker: 'admission' }; },
    createCompletion(options) { state.completion = options; return { marker: 'completion' }; },
    createListing(options) { state.listing = options; return { marker: 'listing' }; },
    createInvitationEmail(options) { state.email = options; return async input => { state.prepared = input; if (state.prepareFails) throw Error('private'); return { message: { subject: 's', html: 'h', text: 't' } }; }; },
    async createOidc(options) { state.oidc = options; return { async bridge(ticket, subject) { return { subject: subject || SUBJECT, by: 'admission' }; }, async verify(value) { return { verified: value }; } }; } };
}
const members = () => ({ fallback: null, projection: null, setBridgeFallback(check) { this.fallback = check; }, setProjectionFallback(project) { this.projection = project; } });

test('admission stays off unless selected and refuses what it cannot run on', t => {
  const folder = memberDirectory(t), f = fakes();
  assert.equal(configuredEntityAdmission({ env: {}, express }), null);
  assert.equal(configuredEntityAdmission({ env: { ENTITY_ADMISSION_RUNTIME: 'disabled' }, express }), null);
  assert.throws(() => configuredEntityAdmission({ env: { ENTITY_ADMISSION_RUNTIME: 'local' }, express }), { code: 'ENTITY_ADMISSION_RUNTIME_INVALID' });
  assert.throws(() => configuredEntityAdmission({ env: environment(folder), express, centralPool: pool, ...f }), { code: 'ENTITY_ADMISSION_REQUIRES_MEMBER_RUNTIME' });
  assert.throws(() => configuredEntityAdmission({ env: environment(folder), express, members: { setBridgeFallback() {} }, centralPool: pool, ...f }), { code: 'ENTITY_ADMISSION_REQUIRES_MEMBER_RUNTIME' });
  assert.throws(() => configuredEntityAdmission({ env: environment(folder), express, members: members(), ...f }), { code: 'ENTITY_ADMISSION_CENTRAL_POOL_REQUIRED' });
  for (const directory of [undefined, '', 'relative/admissions']) {
    assert.throws(() => configuredEntityAdmission({ env: { ...environment(folder), ENTITY_ADMISSION_DIRECTORY: directory }, express, members: members(), centralPool: pool, ...f }), { code: 'ENTITY_ADMISSION_DIRECTORY_INVALID' });
  }
  assert.throws(() => configuredEntityAdmission({ env: { ...environment(folder), OIDC_ISSUER: 'https://other.example.test/realms/x' }, express, members: members(), centralPool: pool, ...f }), { code: 'MEMBER_CONFIGURATION_INVALID' });
  assert.equal(f.state.worker, null, 'no worker is created for a refused configuration');
});

test('privileged steps stay in the worker and the HTTP process only calls its closed methods', async t => {
  const folder = memberDirectory(t), f = fakes(), member = members();
  const admission = configuredEntityAdmission({ env: environment(folder), express, members: member, centralPool: pool, ...f });
  t.after(() => admission.close());
  assert.deepEqual(f.state.worker, [path.join(WORKER_DIRECTORY, 'worker.json'), WORKER_ENTRY]);
  await assert.rejects(admission.start(), { code: 'ENTITY_ADMISSION_NOT_COMPOSED' });

  const coordinator = { marker: 'coordinator' };
  const composed = admission.createAdmission({ authorityCoordinator: coordinator, authConfig });
  assert.deepEqual([composed.marker, typeof composed.issue, Object.isFrozen(composed)], ['admission', 'function', true]);
  const completion = f.state.completion, service = f.state.service;
  assert.deepEqual([completion.coordinator, completion.issuer, completion.policyVersion, completion.assuranceRequirements, completion.mfaPolicyCode, completion.dataResidencyCode],
    [coordinator, ISSUER, 'c4g-user-mfa-v1', { level: 1 }, 'USER_OPTIONAL', 'EU']);
  for (const step of [completion.tenant.ensure, completion.projection.ensure, completion.publishCredentials]) await assert.rejects(step({}), { code: 'WORKER_ONLY' });
  assert.deepEqual([service.coordinator, service.issuer, service.completion, service.listing], [coordinator, ISSUER, { marker: 'completion' }, { marker: 'listing' }]);
  assert.equal(f.state.listing.pool, pool);
  assert.throws(() => service.verification.verify({}), { code: 'ACTIVATION_INVALID' });
  await service.identity.ensure({ a: 1 }); await admission.credentialResolver({ tenantId: 't' });
  assert.deepEqual(f.calls, [['identity', { a: 1 }], ['resolve', { tenantId: 't' }]]);
});

test('admission pages answer after start, the bridge fallback is registered and close releases the worker', async t => {
  const folder = memberDirectory(t), f = fakes(), member = members();
  const admission = configuredEntityAdmission({ env: environment(folder), express, members: member, centralPool: pool, ...f });
  admission.createAdmission({ authorityCoordinator: {}, authConfig });
  const started = await admission.start();
  assert.equal(await admission.start(), started);
  assert.deepEqual(f.calls[0], ['health', {}]);
  assert.deepEqual([f.state.oidc.issuer, f.state.oidc.origin, f.state.oidc.callbackPath, f.state.oidc.service], [ISSUER, ORIGIN, '/api/admission-activation/callback', { marker: 'admission' }]);
  await f.state.oidc.passwordReady(SUBJECT);
  assert.deepEqual(f.calls.at(-1), ['passwordReady', { subject: SUBJECT }]);
  assert.deepEqual(await f.state.service.verification.verify({ e: 5 }), { verified: { e: 5 } });
  assert.deepEqual(await member.fallback('ticket', SUBJECT), { subject: SUBJECT, by: 'admission' });
  await member.projection({ organizationId: 'o' });
  assert.deepEqual(f.calls.at(-1), ['memberProjection', { organizationId: 'o' }]);
  for (const [url, expected] of [['/api/admission-activation', true], ['/api/admission-activation/begin', true], ['/api/admission-activation?x=1', true],
    ['/api/admission-activations', false], ['/api/activation', false], ['/api/admissions/mine', false]]) assert.equal(started.handles(url), expected, url);

  const pages = http.createServer(started.handler);
  await new Promise(resolve => pages.listen(0, '127.0.0.1', resolve));
  try {
    const page = await request(pages, { route: '/api/admission-activation' });
    assert.equal(page.status, 200);
    assert.match(page.headers['set-cookie'][0], /^c4g_admission=[a-f0-9]{64}; .*HttpOnly; Secure/);
    assert.equal(page.headers['x-powered-by'], undefined);
  } finally { await new Promise(resolve => pages.close(resolve)); }

  await admission.close(); await admission.close();
  assert.equal(f.state.closed, 1);
});

test('a selected runtime refuses to start while its worker does not answer', async t => {
  const folder = memberDirectory(t), f = fakes({ workerFails: true }), member = members();
  const admission = configuredEntityAdmission({ env: environment(folder), express, members: member, centralPool: pool, ...f });
  t.after(() => admission.close());
  admission.createAdmission({ authorityCoordinator: {}, authConfig });
  await assert.rejects(admission.start(), { code: 'ENTITY_ADMISSION_WORKER_UNAVAILABLE' });
  assert.deepEqual([member.fallback, member.projection], [null, null]);
  assert.equal(f.state.oidc, null);
});

test('the member bridge checks a member invitation first and then the admission invitation', async t => {
  const folder = memberDirectory(t), calls = [];
  const runtime = configuredMemberOnboarding({ env: environment(folder), express,
    createWorker: () => ({ async call() { return {}; }, async close() {} }), createService: () => ({}),
    createOidc: async () => ({ async bridge(ticket, subject) { calls.push(['member', ticket]); if (ticket !== 'cd'.repeat(32)) throw Object.assign(Error('ACTIVATION_INVALID'), { code: 'ACTIVATION_INVALID' }); return { subject }; }, async verify() {} }) });
  t.after(() => runtime.close());
  runtime.createMemberOnboarding({ authorityCoordinator: {}, authConfig });
  assert.throws(() => runtime.setBridgeFallback('not a function'), { code: 'ACTIVATION_BRIDGE_FALLBACK_INVALID' });
  const started = await runtime.start();
  const check = ticket => request(started.bridgeServer, { method: 'POST', route: '/bridge/check',
    headers: { 'Content-Type': 'application/json', 'X-C4G-Activation': SECRET }, body: JSON.stringify({ ticket, subject: SUBJECT }) });
  const admissionTicket = 'ef'.repeat(32);
  assert.equal((await check('cd'.repeat(32))).status, 200);
  assert.notEqual((await check(admissionTicket)).status, 200, 'without a fallback an unknown ticket is refused');
  runtime.setBridgeFallback(async (ticket, subject) => { calls.push(['admission', ticket]); if (ticket !== admissionTicket) throw Error('ACTIVATION_INVALID'); return { subject }; });
  const accepted = await check(admissionTicket);
  assert.deepEqual([accepted.status, accepted.text], [200, SUBJECT]);
  assert.notEqual((await check('01'.repeat(32))).status, 200);
  assert.deepEqual(calls.slice(-4), [['member', admissionTicket], ['admission', admissionTicket], ['member', '01'.repeat(32)], ['admission', '01'.repeat(32)]]);
  await check('cd'.repeat(32));
  assert.deepEqual(calls.at(-1), ['member', 'cd'.repeat(32)], 'a member invitation never reaches the fallback');
});

test('the API composes admission after the member runtime, routes its pages and closes it on shutdown', async () => {
  const events = [], app = express();
  app.use((req, res) => res.status(200).end('api:' + req.url));
  const production = { app, port: 0, logger: { info() {}, error() {} }, observability: { lifecycle: { start() {}, async stop() {} } },
    async assertDatabaseReadiness() { events.push('ready'); }, async closeOpportunityRuntime() { events.push('runtime-closed'); }, logFrontendUrlHealth() {} };
  const central = { async query() {}, async connect() { return { release() {} }; }, async end() {} };
  const memberRuntime = { createMemberOnboarding() {}, createUserDeletion() {}, setBridgeFallback() {},
    async start() { events.push('members-started'); return { handles: url => url.startsWith('/api/activation'), handler: (req, res) => res.end('activation:' + req.url) }; },
    async close() { events.push('members-closed'); } };
  const createAdmission = () => ({}), credentialResolver = async () => ({});
  let composedWith, loaderInput;
  const api = await start({ host: '127.0.0.1', installSignals: false, telemetry: {}, env: { AUTH_MODE: 'oidc', API_SHUTDOWN_GRACE_MS: '30', API_SHUTDOWN_SETTLE_MS: '500' },
    dependencies: { centralPool: central, express }, composer({ dependencies }) { composedWith = dependencies; return production; },
    memberOnboardingLoader: () => memberRuntime,
    entityAdmissionLoader(input) { loaderInput = input;
      return { createAdmission, credentialResolver, async start() { events.push('admission-started');
        return { handles: url => url.startsWith('/api/admission-activation'), handler: (req, res) => res.end('admission:' + req.url) }; },
      async close() { events.push('admission-closed'); } }; } });
  try {
    assert.deepEqual([loaderInput.express, loaderInput.members, loaderInput.centralPool], [express, memberRuntime, central]);
    assert.equal(composedWith.createAdmission, createAdmission);
    assert.equal(composedWith.tenantCredentialResolver, credentialResolver);
    assert.deepEqual(events, ['ready', 'members-started', 'admission-started']);
    assert.equal((await request(api.server, { route: '/api/admission-activation/begin' })).text, 'admission:/api/admission-activation/begin');
    assert.equal((await request(api.server, { route: '/api/activation/begin' })).text, 'activation:/api/activation/begin');
    assert.equal((await request(api.server, { route: '/api/admissions/mine' })).text, 'api:/api/admissions/mine');
  } finally { await api.shutdown(); }
  assert.deepEqual(events.slice(3).sort(), ['admission-closed', 'members-closed', 'runtime-closed']);
});

test('without the variable the API starts exactly as before', async () => {
  const app = express(); app.use((req, res) => res.end('api'));
  const production = { app, port: 0, logger: { info() {}, error() {} }, observability: { lifecycle: { start() {}, async stop() {} } },
    async assertDatabaseReadiness() {}, async closeOpportunityRuntime() {}, logFrontendUrlHealth() {} };
  let composedWith;
  const api = await start({ host: '127.0.0.1', installSignals: false, telemetry: {}, env: { AUTH_MODE: 'oidc', API_SHUTDOWN_GRACE_MS: '30', API_SHUTDOWN_SETTLE_MS: '500' },
    dependencies: { centralPool: { async query() {}, async end() {} }, express }, composer({ dependencies }) { composedWith = dependencies; return production; } });
  try {
    assert.equal(composedWith.createAdmission, undefined);
    assert.equal(composedWith.tenantCredentialResolver, undefined);
    assert.equal((await request(api.server, { route: '/api/admission-activation' })).text, 'api');
  } finally { await api.shutdown(); }
});

test('a person invited into an entity the member worker does not know is projected by the fallback, and nothing else is', async t => {
  const folder = memberDirectory(t), calls = [];
  let failure = 'ONBOARDING_NOT_READY';
  const runtime = configuredMemberOnboarding({ env: environment(folder), express,
    createWorker: () => ({ async call(method, value) { calls.push(['member', method]); if (method === 'projection' && failure) throw Object.assign(Error(failure), { code: failure }); return { by: 'member', value }; }, async close() {} }),
    createService: options => options, createOidc: async () => ({ async bridge() {}, async verify() {} }) });
  t.after(() => runtime.close());
  const service = runtime.createMemberOnboarding({ authorityCoordinator: {}, authConfig });
  await assert.rejects(service.projection.ensure({ organizationId: 'new' }), { code: 'ONBOARDING_NOT_READY' }, 'without a fallback the refusal stands');
  assert.throws(() => runtime.setProjectionFallback(null), { code: 'MEMBER_PROJECTION_FALLBACK_INVALID' });
  runtime.setProjectionFallback(async value => { calls.push(['admission', value.organizationId]); return { by: 'admission' }; });
  assert.deepEqual(await service.projection.ensure({ organizationId: 'new' }), { by: 'admission' });
  assert.deepEqual(calls.slice(-2), [['member', 'projection'], ['admission', 'new']]);
  failure = 'PERSON_RECONCILIATION_REQUIRED';
  await assert.rejects(service.projection.ensure({ organizationId: 'installed' }), { code: 'PERSON_RECONCILIATION_REQUIRED' });
  assert.deepEqual(calls.at(-1), ['member', 'projection'], 'another failure never reaches the admission worker');
  failure = null;
  assert.deepEqual((await service.projection.ensure({ organizationId: 'installed' })).by, 'member');
});

test('a failing step of the worker is reported once per change, as codes only', async t => {
  const folder = memberDirectory(t), lines = [];
  let health = { ready: true, lastFailure: null };
  const f = fakes();
  f.createWorker = () => ({ async call(method) { return method === 'health' ? health : {}; }, async close() {} });
  t.mock.timers.enable({ apis: ['setInterval'] });
  const admission = configuredEntityAdmission({ env: environment(folder), express, members: members(), centralPool: pool, ...f, report: line => lines.push(line) });
  t.after(() => admission.close());
  admission.createAdmission({ authorityCoordinator: {}, authConfig });
  await admission.start();
  const pass = async () => { t.mock.timers.tick(5000); await new Promise(resolve => setImmediate(resolve)); };
  await pass(); assert.deepEqual(lines, []);
  health = { ready: true, lastFailure: { step: 'TENANT', code: 'LOCAL_IDENTITY_UNEXPECTED_MEMBERSHIP', at: 'x' } };
  await pass(); await pass();
  assert.deepEqual(lines, ['C4G_ADMISSION_STEP_FAILED TENANT:LOCAL_IDENTITY_UNEXPECTED_MEMBERSHIP']);
  health = { ready: true, lastFailure: null };
  await pass();
  assert.deepEqual(lines.at(-1), 'C4G_ADMISSION_STEP_RECOVERED');
});

// Issuing an invitation link also sends it by email (context/features/entity-invitation-email-and-branding.md).
function issuing(t, { sent, issued = { id: 'inv-1', status: 'OPEN', revision: 1, expiresAt: '2027-01-01T00:00:00Z', secret: 'ef'.repeat(32) }, prepareFails = false, getFails = false } = {}) {
  const folder = memberDirectory(t), f = fakes(), calls = [];
  f.state.prepareFails = prepareFails;
  f.createService = () => ({ marker: 'admission', async issue(id, value, request) { calls.push(['issue', id, value, request]); return issued; },
    async get(id, request) { calls.push(['get', id, request]); if (getFails) throw Error('NOT_AUTHORIZED'); return { id, email: 'ana@example.invalid', name: 'Ana' }; } });
  f.createWorker = () => ({ async call(method, value) { calls.push([method, value]); if (method === 'invitationEmail') { if (sent instanceof Error) throw sent; return sent; } return {}; }, async close() {} });
  const admission = configuredEntityAdmission({ env: environment(folder), express, members: members(), centralPool: pool, ...f });
  t.after(() => admission.close());
  return { f, calls, service: admission.createAdmission({ authorityCoordinator: {}, authConfig }) };
}
const REQUEST = { user: { id: 'admin' } };

test('an accepted invitation email keeps the link on the server and names the recipient', async t => {
  const { f, calls, service } = issuing(t, { sent: { status: 'ACCEPTED' } });
  const result = await service.issue('adm-1', { requestId: 'r' }, REQUEST);
  assert.deepEqual(result, { id: 'inv-1', status: 'OPEN', revision: 1, expiresAt: '2027-01-01T00:00:00Z', emailDelivery: { status: 'ACCEPTED', recipient: 'ana@example.invalid' } });
  assert(!JSON.stringify(result).includes('ef'.repeat(32)), 'the link is never returned once the email was accepted');
  assert.deepEqual([f.state.email.centralPool, f.state.email.publicBaseUrl, f.state.prepared], [pool, ORIGIN, { expiresAt: '2027-01-01T00:00:00Z' }]);
  assert.deepEqual(calls, [['issue', 'adm-1', { requestId: 'r' }, REQUEST], ['get', 'adm-1', REQUEST],
    ['invitationEmail', { invitationId: 'inv-1', to: 'ana@example.invalid', secret: 'ef'.repeat(32), expiresAt: '2027-01-01T00:00:00Z', message: { subject: 's', html: 'h', text: 't' } }]]);
});

test('when the email does not leave, the link is still returned with the reason', async t => {
  for (const [options, status] of [[{ sent: { status: 'NOT_CONFIGURED' } }, 'NOT_CONFIGURED'], [{ sent: { status: 'UNCONFIRMED' } }, 'UNCONFIRMED'], [{ sent: { status: 'EXPIRED' } }, 'UNCONFIRMED'],
    [{ sent: undefined }, 'UNCONFIRMED'], [{ sent: Error('WORKER_TIMEOUT') }, 'UNCONFIRMED'], [{ sent: { status: 'ACCEPTED' }, prepareFails: true }, 'UNCONFIRMED'], [{ sent: { status: 'ACCEPTED' }, getFails: true }, 'UNCONFIRMED']]) {
    const { service } = issuing(t, options);
    const result = await service.issue('adm-1', { requestId: 'r' }, REQUEST);
    assert.deepEqual([result.secret, result.emailDelivery], ['ef'.repeat(32), { status }], JSON.stringify(options));
  }
});

test('a replayed request has no link any more and sends nothing', async t => {
  const { calls, service } = issuing(t, { sent: { status: 'ACCEPTED' }, issued: { id: 'inv-1', status: 'OPEN', revision: 1, expiresAt: '2027-01-01T00:00:00Z', secretUnavailable: true } });
  assert.deepEqual(await service.issue('adm-1', { requestId: 'r' }, REQUEST), { id: 'inv-1', status: 'OPEN', revision: 1, expiresAt: '2027-01-01T00:00:00Z', secretUnavailable: true });
  assert.deepEqual(calls.map(call => call[0]), ['issue']);
});
