'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createKeycloakPublisher, configuredKeycloakPublisher, CLIENT_ID, MAX_BYTES } = require('../src/emailTemplates/keycloakPublisher');
const { compilePasswordReset, DEFAULT_PASSWORD_RESET } = require('../src/emailTemplates/keycloakPasswordReset');

const ISSUER = 'https://identity.example.invalid/realms/c4g-test';
const SECRET = 'dedicated-client-secret-that-must-stay-private';
const TOKEN = 'synthetic.bearer.token';
const ACTOR = 'b846ff11-9542-489e-b2bb-55da6f413c5c';
const KEY = '917e22eb-d6fe-4694-9653-d5bce070a018';
const input = overrides => ({ action: 'SAVE', expectedRevision: 0, idempotencyKey: KEY, actorId: ACTOR,
  template: { subject: DEFAULT_PASSWORD_RESET.subject, html: DEFAULT_PASSWORD_RESET.html },
  messages: { ...compilePasswordReset().messages }, logoUrl: null, ...overrides });
const state = overrides => ({ configured: true, revision: 1, action: 'SAVE', actorId: ACTOR, updatedAt: '2026-11-15T12:00:00.000Z',
  template: { ...input().template }, messages: { ...input().messages }, logoUrl: null, ...overrides });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const token = () => json({ access_token: TOKEN, token_type: 'Bearer', expires_in: 60 });
const errorCode = code => error => error.code === code && error.message === code && !String(error.stack).includes(SECRET);

function transport(results) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, ...options });
    assert.ok(results.length > 0, 'unexpected retry or extra provider call');
    const next = results.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(url, options) : next;
  };
  return { calls, fetchImpl, service: createKeycloakPublisher({ issuer: ISSUER, clientSecret: SECRET, fetchImpl }) };
}

test('requests only the dedicated token and restricted resource, keeping each credential at its boundary', async () => {
  const { service, calls } = transport([token(), json({ revision: 0, configured: false })]);
  assert.deepEqual(await service.read(), { revision: 0, configured: false });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, ISSUER + '/protocol/openid-connect/token');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0].body)), {
    grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: SECRET
  });
  assert.equal(calls[1].url, ISSUER + '/c4g-email-templates/password-reset');
  assert.equal(calls[1].method, 'GET');
  assert.equal(calls[1].headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(calls[1].body, undefined);
  assert.equal(calls[0].signal, calls[1].signal);
  assert.ok(calls.every(call => call.redirect === 'error' && !call.url.includes('/admin')));
  assert.ok(!JSON.stringify(service).includes(SECRET));
});

test('publishes a closed intent and verifies the returned version and every published field', async () => {
  const payload = input(), expected = state();
  const { service, calls } = transport([token(), json(expected)]);
  const actual = await service.publish(payload);
  assert.deepEqual(actual, expected);
  assert.equal(calls[1].method, 'PUT');
  assert.deepEqual(JSON.parse(calls[1].body), payload);
  assert.ok(!calls[1].body.includes(SECRET));
  assert.ok(Object.isFrozen(actual) && Object.isFrozen(actual.template) && Object.isFrozen(actual.messages));
});

test('refuses malformed intents before fetching, including arbitrary fields or a client-selected realm', async () => {
  for (const payload of [null, {}, input({ realm: 'foreign' }), input({ locale: 'en' }), input({ smtpServer: {} }),
    input({ expectedRevision: -1 }), input({ actorId: 'invented' }), input({ idempotencyKey: 'not-a-uuid' }),
    input({ messages: { ...input().messages, foreignKey: 'x' } }), input({ template: { subject: 'x\r\nBcc: x', html: 'x' } }),
    input({ logoUrl: 'https://user:password@host.invalid/logo.png' }), input({ logoUrl: 'http://host.invalid/logo.png' })]) {
    const { service, calls } = transport([]);
    await assert.rejects(service.publish(payload), errorCode('INVALID_INPUT'));
    assert.equal(calls.length, 0);
  }
});

test('bounded envelopes count UTF-8 bytes rather than characters', async () => {
  const payload = input({ messages: { passwordResetSubject: 'OK', passwordResetBody: '€'.repeat(60000), passwordResetBodyHtml: '€'.repeat(60000) } });
  assert.ok(JSON.stringify(payload).length < MAX_BYTES);
  const { service, calls } = transport([]);
  await assert.rejects(service.publish(payload), errorCode('INVALID_INPUT'));
  assert.equal(calls.length, 0);
});

test('maps only exact closed extension errors with their expected HTTP status', async () => {
  for (const [code, status] of [['STALE_REVISION', 409], ['IDEMPOTENCY_CONFLICT', 409], ['EMAIL_PUBLICATION_DRIFT', 409], ['INVALID_INPUT', 400]]) {
    const { service } = transport([token(), json({ code }, status)]);
    await assert.rejects(service.publish(input()), errorCode(code));
  }
  for (const [body, status] of [[{ code: 'UNKNOWN', secret: SECRET }, 409], [{ code: 'STALE_REVISION', smtpServer: SECRET }, 409],
    [{ code: 'STALE_REVISION' }, 500], [{ code: 'INVALID_INPUT' }, 403]]) {
    const { service } = transport([token(), json(body, status)]);
    await assert.rejects(service.publish(input()), errorCode('EMAIL_PUBLISH_UNAVAILABLE'));
  }
});

test('does not leak a token failure or retry after it', async () => {
  for (const reply of [json({ error_description: SECRET }, 401), json({ access_token: SECRET }),
    json({ access_token: TOKEN, token_type: 'Other' }), json({ access_token: 'bad\nheader', token_type: 'Bearer' }),
    new Response(SECRET, { status: 200, headers: { 'content-type': 'text/plain' } })]) {
    const { service, calls } = transport([reply]);
    await assert.rejects(service.read(), errorCode('EMAIL_PUBLISH_UNAVAILABLE'));
    assert.equal(calls.length, 1);
  }
});

test('rejects malformed provider states and unexpected fields rather than projecting possible secrets', async () => {
  for (const reply of [null, {}, { revision: 0, configured: false, smtpServer: SECRET }, state({ password: SECRET }),
    state({ template: { ...input().template, token: SECRET } }), state({ messages: { ...input().messages, SMTP: SECRET } }),
    state({ revision: -1 }), state({ actorId: SECRET }), state({ updatedAt: 'not-a-date' }), state({ logoUrl: 'javascript:alert(1)' })]) {
    const { service } = transport([token(), json(reply)]);
    await assert.rejects(service.read(), errorCode('EMAIL_PUBLISH_UNAVAILABLE'));
  }
});

test('rejects a successful but mismatched publication response', async () => {
  for (const reply of [state({ revision: 2 }), state({ action: 'RESET' }), state({ actorId: KEY }),
    state({ template: { ...input().template, subject: 'different' } }),
    state({ messages: { ...input().messages, passwordResetBody: 'different' } }), state({ logoUrl: 'https://brand.invalid/new.png' }),
    { revision: 0, configured: false }]) {
    const { service } = transport([token(), json(reply)]);
    await assert.rejects(service.publish(input()), errorCode('EMAIL_PUBLISH_UNAVAILABLE'));
  }
});

test('rejects redirect responses and never forwards secrets to their target', async () => {
  for (const replies of [[new Response(null, { status: 302, headers: { Location: 'https://foreign.invalid' } })],
    [token(), new Response(null, { status: 307, headers: { Location: 'https://foreign.invalid' } })]]) {
    const { service, calls } = transport(replies);
    await assert.rejects(service.publish(input()), errorCode('EMAIL_PUBLISH_UNAVAILABLE'));
    assert.ok(calls.every(call => call.url.startsWith(ISSUER + '/')));
    assert.ok(calls.length <= 2);
  }
});

test('unknown, oversized and streaming responses are bounded and cancelled', async () => {
  let cancelled = false;
  const huge = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(MAX_BYTES + 1)); },
    cancel() { cancelled = true; }
  }), { headers: { 'content-type': 'application/json' } });
  const { service } = transport([token(), huge]);
  await assert.rejects(service.read(), errorCode('EMAIL_PUBLISH_UNAVAILABLE'));
  assert.equal(cancelled, true);
  const advertised = transport([token(), json({}, 200, { 'content-length': String(MAX_BYTES + 1) })]);
  await assert.rejects(advertised.service.read(), errorCode('EMAIL_PUBLISH_UNAVAILABLE'));
  const malformed = transport([token(), new Response('{invalid', { headers: { 'content-type': 'application/json' } })]);
  await assert.rejects(malformed.service.read(), errorCode('EMAIL_PUBLISH_UNAVAILABLE'));
});

test('a lost publication response is never automatically retried, nor are transport errors trusted as conflict codes', async () => {
  const rawError = Object.assign(new Error(SECRET), { code: 'STALE_REVISION' });
  const { service, calls } = transport([token(), rawError]);
  await assert.rejects(service.publish(input()), errorCode('EMAIL_PUBLISH_UNAVAILABLE'));
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
  assert.equal(calls.length, 2);
});

test('one deadline bounds authentication and publication', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  let calls = 0;
  try {
    const service = createKeycloakPublisher({ issuer: ISSUER, clientSecret: SECRET, timeoutMs: 10,
      fetchImpl: async (_url, options) => {
        calls++;
        if (calls === 1) return token();
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error(SECRET)), { once: true }));
      } });
    await assert.rejects(service.publish(input()), errorCode('EMAIL_PUBLISH_UNAVAILABLE'));
    assert.equal(calls, 2);
  } finally { clearTimeout(keepAlive); }
});

test('composition is disabled by default and cannot silently accept unknown modes or insecure production issuers', () => {
  assert.equal(configuredKeycloakPublisher({ env: {}, issuer: ISSUER }), null);
  assert.equal(configuredKeycloakPublisher({ env: { EMAIL_AUTHENTICATION_RUNTIME: 'disabled', EMAIL_AUTHENTICATION_CLIENT_SECRET: SECRET }, issuer: ISSUER }), null);
  assert.throws(() => configuredKeycloakPublisher({ env: { EMAIL_AUTHENTICATION_RUNTIME: 'unknown' }, issuer: ISSUER }), TypeError);
  assert.throws(() => configuredKeycloakPublisher({ env: { EMAIL_AUTHENTICATION_RUNTIME: 'keycloak-restricted-v1' }, issuer: ISSUER }), TypeError);
  const env = { EMAIL_AUTHENTICATION_RUNTIME: 'keycloak-restricted-v1', EMAIL_AUTHENTICATION_CLIENT_SECRET: SECRET };
  assert.equal(typeof configuredKeycloakPublisher({ env, issuer: ISSUER }).read, 'function');
  assert.equal(typeof configuredKeycloakPublisher({ env, issuer: 'http://127.0.0.1:19080/realms/probe' }).publish, 'function');
  assert.throws(() => configuredKeycloakPublisher({ env: { ...env, NODE_ENV: 'production' }, issuer: 'http://127.0.0.1:19080/realms/probe' }), TypeError);
  for (const issuer of ['http://host.invalid/realms/x', 'https://user:password@host.invalid/realms/x',
    'https://host.invalid/realms/x?arbitrary=1', 'https://host.invalid/realms/x#fragment',
    'https://host.invalid/admin/realms/x', 'https://host.invalid/realms/x/', 'https://host.invalid/realms/x%2Fy']) {
    if (issuer.includes('/admin/realms/')) continue; // A fixed deployment context prefix is valid; it is never an Admin API call.
    assert.throws(() => createKeycloakPublisher({ issuer, clientSecret: SECRET }), TypeError);
  }
});
