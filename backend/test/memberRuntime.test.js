'use strict';
// Member invitations composed outside the local installer (context/features/staging-member-invitations.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { fork } = require('node:child_process');
const express = require('express');
const { configuredMemberOnboarding } = require('../src/platformOnboarding/memberRuntime');
const { start } = require('../src/server');

const ISSUER = 'https://login.example.test/realms/c4g-staging';
const ORIGIN = 'https://app.example.test';
const SECRET = 'ab'.repeat(32);
const SUBJECT = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function directory(t, overrides = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-members-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.writeFileSync(path.join(folder, 'http.json'), JSON.stringify({ issuer: ISSUER, origin: ORIGIN, manualClientId: 'c4g-member-activation',
    existingClientId: 'c4g-member-existing', bridgeSecret: SECRET, dataResidencyCode: 'EU', ...overrides }));
  return folder;
}
const environment = folder => ({ MEMBER_ONBOARDING_RUNTIME: 'central', MEMBER_ONBOARDING_DIRECTORY: folder, OIDC_ISSUER: ISSUER,
  PUBLIC_APP_URL: ORIGIN, MEMBER_ACTIVATION_BRIDGE_PORT: '0', MEMBER_ACTIVATION_BRIDGE_HOST: '127.0.0.1' });

function request(server, { method = 'GET', route, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: route, method, headers }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.once('error', reject); req.end(body);
  });
}

function fakes() {
  const calls = [], state = { workerClosed: 0, workerFile: null, serviceOptions: null, oidcOptions: null };
  return { calls, state,
    createWorker(file) { state.workerFile = file; return { async call(method, value) { calls.push([method, value]); return { method }; }, async close() { state.workerClosed += 1; } }; },
    createService(options) { state.serviceOptions = options; return { marker: 'service' }; },
    async createOidc(options) { state.oidcOptions = options; return { async bridge(ticket, subject) { return { subject: subject || SUBJECT }; }, async verify(value) { return { verified: value }; } }; } };
}

test('the runtime stays off unless it is selected, and refuses an unknown selection', () => {
  assert.equal(configuredMemberOnboarding({ env: {}, express }), null);
  assert.equal(configuredMemberOnboarding({ env: { MEMBER_ONBOARDING_RUNTIME: 'disabled' }, express }), null);
  assert.throws(() => configuredMemberOnboarding({ env: { MEMBER_ONBOARDING_RUNTIME: 'local' }, express }), { code: 'MEMBER_ONBOARDING_RUNTIME_INVALID' });
});

test('deletion uses the recognized privileged category, including the optional MFA policy', async t => {
  const policies = require('../src/security/authConfig').RECOGNIZED_ASSURANCE_POLICIES;
  const queries = require('../src/platformDirectory/deletionSql');
  const admin = require('../src/platformOnboarding/sql').admin;
  const actor = '10000000-0000-4000-8000-000000000001';
  const target = '10000000-0000-4000-8000-000000000002';
  const coordinator = { withAuthority: work => work(), pool: { async query(sql) {
    if (sql === admin) return { rows: [{ id: actor }] };
    if (sql === queries.target) return { rows: [{ id: target, session_revocation_version: 1 }] };
    if (sql === queries.operation) return { rows: [] };
    throw Error('UNEXPECTED_QUERY');
  } } };
  for (const version of ['c4g-user-mfa-v1', 'c4g-assurance-v1']) {
    const members = configuredMemberOnboarding({ env: { ...environment(directory(t)), USER_DELETION_RUNTIME: 'central' }, express, ...fakes() });
    t.after(() => members.close());
    const policy = policies[version];
    const service = members.createUserDeletion({ authorityCoordinator: coordinator,
      authConfig: { policyVersion: version, privilegedLoginCategory: policy.privilegedCategory, assurancePolicy: policy.policy } });
    const request = { user: { id: actor }, sessionID: 'sid', authContext: { sessionId: 'sid',
      evidence: { policyVersion: version, authTime: Date.now() / 1000, acr: 'c4g-loa1', amr: ['pwd'] } } };
    if (version === 'c4g-user-mfa-v1') assert.equal((await service.status(target, request)).phase, 'NOT_STARTED');
    else await assert.rejects(service.status(target, request), { code: 'MFA_REQUIRED' });
  }
});

test('configuration that does not match the API identity or origin prevents start-up', t => {
  const f = fakes(), options = { express, ...f };
  const good = directory(t);
  assert.throws(() => configuredMemberOnboarding({ ...options, env: { ...environment(good), MEMBER_ONBOARDING_DIRECTORY: 'members' } }), { code: 'MEMBER_ONBOARDING_DIRECTORY_INVALID' });
  assert.throws(() => configuredMemberOnboarding({ ...options, env: { ...environment(good), OIDC_ISSUER: 'https://other.example.test/realms/x' } }), { code: 'MEMBER_CONFIGURATION_INVALID' });
  assert.throws(() => configuredMemberOnboarding({ ...options, env: { ...environment(good), PUBLIC_APP_URL: 'https://other.example.test' } }), { code: 'MEMBER_CONFIGURATION_INVALID' });
  assert.throws(() => configuredMemberOnboarding({ ...options, env: { ...environment(good), MEMBER_ACTIVATION_BRIDGE_PORT: '70000' } }), { code: 'MEMBER_ACTIVATION_BRIDGE_PORT_INVALID' });
  for (const bridgeSecret of ['short', SECRET.toUpperCase(), SECRET + 'ab']) {
    assert.throws(() => configuredMemberOnboarding({ ...options, env: environment(directory(t, { bridgeSecret })) }), { code: 'ACTIVATION_BRIDGE_SECRET_INVALID' });
  }
  assert.throws(() => configuredMemberOnboarding({ ...options, env: environment(directory(t, { dataResidencyCode: '' })) }), { code: 'MEMBER_CONFIGURATION_INVALID' });
  assert.throws(() => configuredMemberOnboarding({ ...options, env: environment(path.join(good, 'missing')) }), { code: 'MEMBER_CONFIGURATION_INVALID' });
  assert.equal(f.state.workerFile, null);
});

test('start is refused before the production composition asked for the service', async t => {
  const f = fakes(), folder = directory(t);
  const members = configuredMemberOnboarding({ env: environment(folder), express, ...f });
  t.after(() => members.close());
  assert.equal(f.state.workerFile, path.join(folder, 'worker.json'));
  await assert.rejects(members.start(), { code: 'MEMBER_ONBOARDING_NOT_COMPOSED' });
});

test('activation pages and bridge answer after start and close releases the worker and the listener', async t => {
  const f = fakes(), folder = directory(t);
  const members = configuredMemberOnboarding({ env: environment(folder), express, ...f });
  const coordinator = { marker: 'coordinator' };
  const service = members.createMemberOnboarding({ authorityCoordinator: coordinator,
    authConfig: { policyVersion: 'c4g-user-mfa-v1', privilegedLoginCategory: 'privileged', assurancePolicy: { privileged: { level: 1 } } } });
  assert.deepEqual(service, { marker: 'service' });
  const composed = f.state.serviceOptions;
  assert.equal(composed.coordinator, coordinator);
  assert.deepEqual([composed.issuer, composed.policyVersion, composed.assuranceRequirements, composed.mfaPolicyCode, composed.dataResidencyCode],
    [ISSUER, 'c4g-user-mfa-v1', { level: 1 }, 'USER_OPTIONAL', 'EU']);
  assert.throws(() => composed.verification.verify({}), { code: 'ACTIVATION_INVALID' });
  await composed.identity.ensure({ a: 1 }); await composed.projection.ensure({ b: 2 });
  await composed.email.secret({ c: 3 }); await composed.email.send({ d: 4 });
  assert.deepEqual(f.calls, [['identity', { a: 1 }], ['projection', { b: 2 }], ['activationSecret', { c: 3 }], ['activationEmail', { d: 4 }]]);

  const started = await members.start();
  assert.equal(await members.start(), started);
  assert.deepEqual(await composed.verification.verify({ e: 5 }), { verified: { e: 5 } });
  assert.deepEqual([f.state.oidcOptions.issuer, f.state.oidcOptions.origin, f.state.oidcOptions.callbackPath, f.state.oidcOptions.service],
    [ISSUER, ORIGIN, '/api/activation/callback', service]);
  await f.state.oidcOptions.passwordReady(SUBJECT);
  assert.deepEqual(f.calls.at(-1), ['passwordReady', { subject: SUBJECT }]);
  await f.state.oidcOptions.passwordSetupPending(SUBJECT);
  assert.deepEqual(f.calls.at(-1), ['passwordSetupPending', { subject: SUBJECT }]);
  for (const [url, expected] of [['/api/activation', true], ['/api/activation/begin', true], ['/api/activation?x=1', true], ['/api/activations', false], ['/api/auth/session', false]]) {
    assert.equal(started.handles(url), expected, url);
  }

  const pages = http.createServer(started.handler);
  await new Promise(resolve => pages.listen(0, '127.0.0.1', resolve));
  try {
    const page = await request(pages, { route: '/api/activation' });
    assert.equal(page.status, 200);
    assert.match(page.headers['set-cookie'][0], /^c4g_activation=[a-f0-9]{64}; .*HttpOnly; Secure/);
    assert.match(page.headers['content-security-policy'], /form-action 'self' https:\/\/login\.example\.test;/);
    assert.equal(page.headers['x-powered-by'], undefined);
  } finally { await new Promise(resolve => pages.close(resolve)); }

  const json = { 'Content-Type': 'application/json' }, body = JSON.stringify({ ticket: 'cd'.repeat(32), subject: SUBJECT });
  assert.equal((await request(started.bridgeServer, { method: 'POST', route: '/bridge/check', headers: json, body })).status, 403);
  assert.equal((await request(started.bridgeServer, { method: 'POST', route: '/bridge/check', headers: { ...json, 'X-C4G-Activation': 'ef'.repeat(32) }, body })).status, 403);
  const accepted = await request(started.bridgeServer, { method: 'POST', route: '/bridge/check', headers: { ...json, 'X-C4G-Activation': SECRET }, body });
  assert.deepEqual([accepted.status, accepted.text], [200, SUBJECT]);
  assert.equal((await request(started.bridgeServer, { route: '/api/activation' })).status, 404);

  await members.close(); await members.close();
  assert.equal(f.state.workerClosed, 1);
  assert.equal(started.bridgeServer.listening, false);
});

test('the API routes activation requests to the member runtime and closes it on shutdown', async () => {
  const events = [], app = express();
  app.use((req, res) => res.status(200).end('api:' + req.url));
  const production = { app, port: 0, logger: { info() {}, error() {} }, observability: { lifecycle: { start() {}, async stop() {} } },
    async assertDatabaseReadiness() { events.push('ready'); }, async closeOpportunityRuntime() { events.push('runtime-closed'); }, logFrontendUrlHealth() {} };
  const pool = { async query() {}, async connect() { return { release() {} }; }, async end() {} };
  const createMemberOnboarding = () => ({});
  let composedWith;
  const api = await start({ host: '127.0.0.1', installSignals: false, telemetry: {}, env: { AUTH_MODE: 'oidc', API_SHUTDOWN_GRACE_MS: '30', API_SHUTDOWN_SETTLE_MS: '500' },
    dependencies: { centralPool: pool, express }, composer({ dependencies }) { composedWith = dependencies; return production; },
    memberOnboardingLoader({ express: provided }) {
      assert.equal(provided, express);
      return { createMemberOnboarding, async start() { events.push('members-started');
        return { handles: url => url.startsWith('/api/activation'), handler: (req, res) => res.end('activation:' + req.url) }; },
      async close() { events.push('members-closed'); } };
    } });
  try {
    assert.equal(composedWith.createMemberOnboarding, createMemberOnboarding);
    assert.deepEqual(events, ['ready', 'members-started']);
    assert.equal((await request(api.server, { route: '/api/activation/begin' })).text, 'activation:/api/activation/begin');
    assert.equal((await request(api.server, { route: '/api/auth/session' })).text, 'api:/api/auth/session');
  } finally { await api.shutdown(); }
  assert.deepEqual(events.slice(2), ['runtime-closed', 'members-closed']);
});

function runWorker(t, config, env) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-member-worker-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'worker.json');
  fs.writeFileSync(file, JSON.stringify(config));
  return new Promise(resolve => {
    const child = fork(path.join(__dirname, '../src/platformOnboarding/memberWorker.js'), [file], { env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    child.once('message', message => { resolve({ ready: message.ready === true }); child.disconnect(); });
    child.once('exit', code => resolve({ ready: false, code }));
  });
}

test('the identity worker serves a non-local issuer only when it is the one the API signs in with', async t => {
  const config = { issuer: ISSUER, clientId: 'c4g-member-worker', clientSecret: 'synthetic', ownershipKey: SECRET, bindings: [] };
  const clean = { OIDC_ISSUER: undefined, RESEND_API_KEY: undefined };
  assert.deepEqual(await runWorker(t, config, { ...clean, OIDC_ISSUER: ISSUER }), { ready: true });
  assert.equal((await runWorker(t, config, clean)).ready, false);
  assert.equal((await runWorker(t, config, { ...clean, OIDC_ISSUER: 'https://other.example.test/realms/c4g-staging' })).ready, false);
  assert.equal((await runWorker(t, { ...config, issuer: ISSUER.replace('https:', 'http:') }, { ...clean, OIDC_ISSUER: ISSUER.replace('https:', 'http:') })).ready, false);
});
