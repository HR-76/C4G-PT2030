'use strict';
// A browser that already holds another account's session (context/features/activation-other-account-session.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createOidcActivationAdapter } = require('../src/platformOnboarding/oidcActivationAdapter');
const { createActivationHttp } = require('../src/platformOnboarding/activationHttp');

const ISSUER = 'https://login.example.test/realms/c4g-staging';
const ORIGIN = 'https://app.example.test';
const CALLBACK = ORIGIN + '/api/admission-activation/callback';
const INVITED = 'invited-subject', OTHER = 'admin-subject';
const BINDING = 'browser-binding', EXCHANGE = 'exchange-ticket';

// An OIDC library that records what it is asked and answers the code grant with the subject under test.
function library({ signedIn = null, grantFails = false, issuer = ISSUER } = {}) {
  const calls = []; let n = 0;
  return { calls,
    async discovery(url, clientId) { return { clientId }; }, enableNonRepudiationChecks() {},
    randomPKCECodeVerifier: () => 'verifier-' + (++n), randomState: () => 'state-' + (++n) + '-abcdef', randomNonce: () => 'nonce-' + (++n),
    async calculatePKCECodeChallenge(verifier) { return 'challenge-of-' + verifier; },
    buildAuthorizationUrl(config, parameters) { calls.push(['authorize', config.clientId, parameters]); return new URL(ISSUER + '/auth?' + new URLSearchParams(parameters)); },
    buildEndSessionUrl(config, parameters) { calls.push(['end-session', config.clientId, parameters]); return new URL(ISSUER + '/logout?' + new URLSearchParams(parameters)); },
    async authorizationCodeGrant(config, url, checks) { calls.push(['grant', config.clientId, checks.expectedState]); if (grantFails) throw Error('private');
      return { id_token: 'id-token-of-' + signedIn, claims: () => ({ iss: issuer, sub: signedIn }) }; } };
}
function adapter(options = {}, mode = 'CREATED') {
  const lib = library(options), checks = [];
  const service = { async checkActivation(exchange, binding, subject) { checks.push([exchange, binding, subject]); if (exchange !== EXCHANGE || binding !== BINDING) throw Object.assign(Error('ACTIVATION_INVALID'), { code: 'ACTIVATION_INVALID' }); return { issuer: ISSUER, subject: INVITED, mode }; } };
  return createOidcActivationAdapter({ issuer: ISSUER, origin: ORIGIN, manualClientId: 'manual', existingClientId: 'existing', service,
    passwordReady: async () => mode === 'EXISTING', callbackPath: '/api/admission-activation/callback', library: lib }).then(oidc => ({ oidc, lib, checks }));
}
const stateOf = url => new URL(url).searchParams.get('state');
const invalid = { code: 'ACTIVATION_INVALID' };

test('activation first asks the identity provider silently, with the existing-accounts client and no invitation ticket', async () => {
  const { oidc, lib } = await adapter();
  const url = new URL(await oidc.begin(EXCHANGE, BINDING));
  assert.deepEqual([lib.calls[0][0], lib.calls[0][1]], ['authorize', 'existing']);
  assert.deepEqual([url.searchParams.get('prompt'), url.searchParams.get('scope'), url.searchParams.get('redirect_uri'), url.searchParams.get('c4g_ticket'), url.searchParams.get('code_challenge_method')],
    ['none', 'openid', CALLBACK, null, 'S256']);
  await assert.rejects(oidc.begin('other-exchange', BINDING), invalid);
});

test('without a session the activation request follows at once, exactly as before', async () => {
  for (const [mode, expected] of [['CREATED', ['manual', EXCHANGE, undefined]], ['EXISTING', ['existing', undefined, 'login']]]) {
    const { oidc, lib } = await adapter({}, mode);
    const state = stateOf(await oidc.begin(EXCHANGE, BINDING));
    const step = await oidc.resume(`${CALLBACK}?error=login_required&state=${state}`, BINDING);
    assert.equal(step.next, 'redirect');
    const request = lib.calls.at(-1);
    assert.deepEqual([request[1], request[2].c4g_ticket, request[2].prompt], expected, mode);
    assert.equal(lib.calls.some(call => call[0] === 'grant'), false, 'no code is exchanged when there is no session');
    assert.equal(await oidc.resume(`${CALLBACK}?code=c&state=${stateOf(step.url)}`, BINDING), null, 'the activation response itself is left to the existing path');
    assert.deepEqual(oidc.callbackContext(`${CALLBACK}?code=c&state=${stateOf(step.url)}`, BINDING), { exchange: EXCHANGE, browserBinding: BINDING });
    await assert.rejects(oidc.resume(`${CALLBACK}?error=login_required&state=${state}`, BINDING), invalid, 'a probe answer is used once');
  }
});

test('a session of the invited account itself, or a probe that cannot be read, goes straight to activation', async () => {
  for (const options of [{ signedIn: INVITED }, { signedIn: OTHER, grantFails: true }, { signedIn: OTHER, issuer: 'https://other.example.test/realms/x' }]) {
    const { oidc } = await adapter(options);
    const state = stateOf(await oidc.begin(EXCHANGE, BINDING));
    assert.equal((await oidc.resume(`${CALLBACK}?code=c&state=${state}`, BINDING)).next, 'redirect', JSON.stringify(options));
  }
});

test('another account in session is never signed out without being asked, and then only once and only from this browser', async () => {
  const { oidc, lib } = await adapter({ signedIn: OTHER });
  const state = stateOf(await oidc.begin(EXCHANGE, BINDING));
  assert.deepEqual(await oidc.resume(`${CALLBACK}?code=c&state=${state}`, BINDING), { next: 'confirm', state });
  assert.equal(lib.calls.some(call => call[0] === 'end-session'), false);
  await assert.rejects(oidc.resume(`${CALLBACK}?state=${state}`, BINDING), invalid, 'a sign-out return that was not asked for is refused');
  await assert.rejects(oidc.signOutUrl(state, 'another-browser'), invalid);
  await assert.rejects(oidc.signOutUrl('unknown-state', BINDING), invalid);
  assert.throws(() => oidc.callbackContext(`${CALLBACK}?code=c&state=${state}`, BINDING), invalid, 'the probe can never stand in for the activation response');
  await assert.rejects(oidc.bridge(EXCHANGE, INVITED), invalid, 'nor answer the identity provider\'s ticket check');

  const signOut = new URL(await oidc.signOutUrl(state, BINDING));
  assert.deepEqual(lib.calls.at(-1), ['end-session', 'existing', { id_token_hint: 'id-token-of-' + OTHER, post_logout_redirect_uri: CALLBACK, state }]);
  assert.equal(signOut.searchParams.get('post_logout_redirect_uri'), CALLBACK);
  await assert.rejects(oidc.signOutUrl(state, BINDING), invalid, 'the identity is used once');
  await assert.rejects(oidc.resume(`${CALLBACK}?code=x&state=${state}`, BINDING), invalid);

  const step = await oidc.resume(`${CALLBACK}?state=${state}`, BINDING);
  assert.equal(step.next, 'redirect');
  assert.deepEqual([lib.calls.at(-1)[1], lib.calls.at(-1)[2].c4g_ticket], ['manual', EXCHANGE]);
  await assert.rejects(oidc.resume(`${CALLBACK}?state=${state}`, BINDING), invalid);
  assert.deepEqual((await oidc.bridge(EXCHANGE, INVITED)).subject, INVITED);
});

test('a return from another browser is refused at every step', async () => {
  const { oidc } = await adapter({ signedIn: OTHER });
  const state = stateOf(await oidc.begin(EXCHANGE, BINDING));
  await assert.rejects(oidc.resume(`${CALLBACK}?code=c&state=${state}`, 'another-browser'), invalid);
  await assert.rejects(oidc.resume(`${CALLBACK}?code=c&state=unknown`, BINDING), invalid);
});

function serve(app) {
  const server = http.createServer(app);
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}
function request(server, { method = 'GET', route, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: route, method, headers }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text })); });
    req.once('error', reject); req.end(body);
  });
}

test('the page asks before ending the other session and the button needs this page\'s cookie, token and origin', async t => {
  const calls = [];
  const oidc = { async resume(callback, binding) { calls.push(['resume', new URL(callback).search, binding.length]); return { next: 'confirm', state: 'state-9-abcdef' }; },
    async signOutUrl(state, binding) { calls.push(['signOut', state, binding.length]); return ISSUER + '/logout?state=' + state; }, callbackContext() { throw Error('must not be reached'); } };
  const app = express();
  app.use('/api/admission-activation', createActivationHttp({ express, service: {}, oidc, origin: ORIGIN, identityOrigin: 'https://login.example.test', bridgeSecret: 'ab'.repeat(32), purpose: 'ADMISSION' }).router);
  const server = await serve(app); t.after(() => new Promise(resolve => server.close(resolve)));
  const first = await request(server, { route: '/api/admission-activation' });
  const cookie = first.headers['set-cookie'][0].split(';')[0];
  const page = await request(server, { route: '/api/admission-activation/callback?code=c&state=s', headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  assert.match(page.text, /<h1>Outra conta com sessão iniciada<\/h1>/);
  assert.match(page.text, /<form action="\/api\/admission-activation\/switch" method="post">/);
  assert.match(page.text, /<button>Terminar sessão e continuar<\/button>/);
  assert.match(page.headers['content-security-policy'], /form-action 'self' https:\/\/login\.example\.test;/);
  const csrf = /name="csrf" type="hidden" value="([a-f0-9]{64})"/.exec(page.text)[1];
  const form = `csrf=${csrf}&state=state-9-abcdef`, good = { Cookie: cookie, Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/x-www-form-urlencoded' };
  const post = headers => request(server, { method: 'POST', route: '/api/admission-activation/switch', headers, body: form });
  assert.equal((await post({ ...good, Cookie: '' })).status, 403);
  assert.equal((await post({ ...good, Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post({ ...good, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request(server, { method: 'POST', route: '/api/admission-activation/switch', headers: good, body: 'csrf=' + 'ab'.repeat(32) + '&state=state-9-abcdef' })).status, 403);
  assert.equal(calls.some(call => call[0] === 'signOut'), false);
  const accepted = await post(good);
  assert.deepEqual([accepted.status, accepted.headers.location], [303, ISSUER + '/logout?state=state-9-abcdef']);
  assert.equal((await post(good)).status, 403, 'the token is used once');
});

test('pages follow the adapter\'s redirect and fall back to the old path for an adapter without the probe', async t => {
  const app = express();
  app.use('/api/activation', createActivationHttp({ express, service: {}, origin: ORIGIN, identityOrigin: 'https://login.example.test', bridgeSecret: 'ab'.repeat(32),
    oidc: { async resume() { return { next: 'redirect', url: ISSUER + '/auth?real=1' }; } } }).router);
  app.use('/legacy', createActivationHttp({ express, origin: ORIGIN, identityOrigin: 'https://login.example.test', bridgeSecret: 'ab'.repeat(32),
    service: { async activate() { return {}; } }, oidc: { callbackContext() { return { exchange: 'x' }; } } }).router);
  const server = await serve(app); t.after(() => new Promise(resolve => server.close(resolve)));
  const cookie = (await request(server, { route: '/api/activation' })).headers['set-cookie'][0].split(';')[0];
  const moved = await request(server, { route: '/api/activation/callback?error=login_required&state=s', headers: { Cookie: cookie } });
  assert.deepEqual([moved.status, moved.headers.location, moved.headers['cache-control']], [303, ISSUER + '/auth?real=1', 'no-store']);
});
