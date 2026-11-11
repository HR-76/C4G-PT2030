const test = require('node:test');
const assert = require('node:assert/strict');
const { sealAccountToken, openAccountToken, readEmailPreference } = require('../src/security/emailAccount');
const { OidcClient } = require('../src/security/oidcClient');
const { createOidcAuthController } = require('../src/controllers/oidcAuthController');
const config = { issuer: new URL('https://idp.invalid/realms/test'), sessionSecret: 's'.repeat(48), emailVerification: true };
const identity = { issuer: config.issuer.href, subject: 'synthetic' };
const auth = () => ({ identity, accountToken: sealAccountToken(config, identity, 'synthetic-access-token', Date.now() + 300000) });
test('account consultation lasts thirty minutes, bounded by provider expiry', async () => {
  for (const [expires, expected] of [[1800, 1800], [3600, 1800], [120, 120], [0, 0], [undefined, 0]]) {
    const client = new OidcClient(config, { configuration: {}, library: {
      authorizationCodeGrant: async () => ({ access_token: 'synthetic', expires_in: expires, claims: () => ({ sub: identity.subject, iss: identity.issuer }) })
    } });
    const start = Date.now();
    const result = await client.callback('https://app.invalid/callback', {});
    assert(result.accountTokenExpiresAt >= start + expected * 1000);
    assert(result.accountTokenExpiresAt <= Date.now() + expected * 1000);
    if (expected === 1800) {
      const sealed = sealAccountToken(config, identity, result.accountAccessToken, result.accountTokenExpiresAt);
      assert.equal(openAccountToken(config, identity, sealed, start + 1799000), 'synthetic');
      assert.throws(() => openAccountToken(config, identity, sealed, result.accountTokenExpiresAt), { code: 'ACCOUNT_REAUTH_REQUIRED' });
    }
  }
});
test('token is encrypted, identity-bound, authenticated and expires without refreshing', () => {
  const value = auth(); assert(!JSON.stringify(value).includes('synthetic-access-token'));
  assert.equal(openAccountToken(config, identity, value.accountToken, Date.now()), 'synthetic-access-token');
  for (const [who, sealed, now] of [[{ ...identity, subject: 'other' }, value.accountToken, Date.now()],
    [identity, value.accountToken.slice(0, -8), Date.now()], [identity, value.accountToken, Date.now() + 300001]]) {
    assert.throws(() => openAccountToken(config, who, sealed, now), { code: 'ACCOUNT_REAUTH_REQUIRED' });
  }
});
test('only self Account credential state is projected; absent or ambiguous provider fails closed', async () => {
  for (const enabled of [false, true]) {
    const result = await readEmailPreference(config, auth(), { fetchImpl: async (url, options) => {
      assert.equal(url.href, config.issuer.href + '/account/credentials?type=email-authenticator');
      assert.equal(options.redirect, 'manual'); assert.equal(options.headers.Accept, 'application/json');
      return Response.json([{ type: 'email-authenticator', userCredentialMetadatas: enabled ? [{ credential: { id: 'private-id' } }] : [] }]);
    } });
    assert.deepEqual(result, { available: true, enabled });
  }
  for (const response of [Response.json([]), Response.json([{ type: 'email-authenticator', userCredentialMetadatas: [{}, {}] }]),
    new Response('redirect', { status: 302 }), new Response('unavailable', { status: 503 }), Response.json({ value: 'x'.repeat(70000) })]) {
    await assert.rejects(readEmailPreference(config, auth(), { fetchImpl: async () => response }), { code: 'ACCOUNT_PROVIDER_UNAVAILABLE' });
  }
  await assert.rejects(readEmailPreference(config, auth(), { fetchImpl: async () => new Response('', { status: 401 }) }), { code: 'ACCOUNT_REAUTH_REQUIRED' });
});
test('IdP action uses closed allowlist, real OIDC state/nonce/PKCE and no fabricated assurance', async () => {
  let parameters;
  const client = new OidcClient({ ...config, redirectUri: new URL('https://app.invalid/callback') }, {
    configuration: {}, library: { randomPKCECodeVerifier: () => 'verifier', calculatePKCECodeChallenge: async () => 'challenge',
      randomState: () => 'state', randomNonce: () => 'nonce', buildAuthorizationUrl: (c, p) => { parameters = p; return new URL('https://idp.invalid/authorize'); } }
  });
  await client.begin({ accountAction: 'enable', returnPath: '/conta/seguranca' });
  assert.equal(parameters.kc_action, 'c4g-email-enable'); assert.equal(parameters.code_challenge_method, 'S256');
  assert.equal(parameters.state, 'state'); assert.equal(parameters.nonce, 'nonce'); assert.equal(parameters.acr_values, undefined);
  await assert.rejects(client.begin({ accountAction: 'admin' }));
});
function response() { return { statusCode: 200, set() { return this; }, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; }, redirect(n, v) { this.statusCode = n; this.location = v; } }; }
test('action is bound to initiating identity and fixed return, refusing browser-selected context', async () => {
  let begun;
  const controller = createOidcAuthController({ config, oidcClient: { begin: async input => { begun = input; return { redirectUrl: 'https://idp.invalid/authorize', transaction: { state: 'state', createdAt: Date.now() } }; } },
    sessionRegistry: { registerOidcTransaction: async () => {} } });
  const req = { query: { returnTo: 'https://evil.invalid' }, body: { action: 'enable' }, session: { auth: { identity } }, sessionID: 's' };
  const res = response(); await controller.emailVerification(req, res, e => { throw e; });
  assert.equal(begun.returnPath, '/conta/seguranca'); assert.deepEqual(req.session.oidcTransaction.expectedIdentity, identity);
  req.body.organization = 'other'; const denied = response(); await controller.emailVerification(req, denied, () => {}); assert.equal(denied.statusCode, 400);
});
test('cancelled callback consumes state but creates no authorized session', async () => {
  let consumed = false;
  const controller = createOidcAuthController({ config: { ...config, oidcTransactionMs: 600000 },
    sessionRegistry: { consumeOidcTransaction: async () => { consumed = true; return true; } },
    oidcClient: { callback: () => { throw Error('must not exchange'); } } });
  const req = { session: { oidcTransaction: { state: 's', createdAt: Date.now() } }, sessionID: 'sid', query: { state: 's', error: 'access_denied' } };
  const res = response(); await controller.callback(req, res, e => { throw e; });
  assert(consumed); assert.equal(req.session.auth, undefined); assert.equal(res.location, '/login?authentication=cancelled');
});
test('cancelling the email action preserves the existing session and returns to account security', async () => {
  const controller = createOidcAuthController({ config: { ...config, oidcTransactionMs: 600000 },
    sessionRegistry: { consumeOidcTransaction: async () => true },
    oidcClient: { callback: () => { throw Error('must not exchange'); } } });
  const auth = { identity };
  const req = { session: { auth, oidcTransaction: { state: 's', createdAt: Date.now(), accountAction: 'disable' } },
    sessionID: 'sid', query: { state: 's', error: 'access_denied' } };
  const res = response();
  await controller.callback(req, res, e => { throw e; });
  assert.equal(req.session.auth, auth);
  assert.equal(req.session.oidcTransaction, undefined);
  assert.equal(res.location, '/conta/seguranca?verification=cancelled');
});
test('account callback cannot switch to another identity', async () => {
  const controller = createOidcAuthController({ config: { ...config, oidcTransactionMs: 600000, publicOrigin: new URL('https://app.invalid') },
    sessionRegistry: { consumeOidcTransaction: async () => true }, oidcClient: { callback: async () => ({ claims: { iss: identity.issuer, sub: 'other' } }) } });
  const req = { session: { oidcTransaction: { state: 's', createdAt: Date.now(), accountAction: 'enable', expectedIdentity: identity } },
    sessionID: 'sid', originalUrl: '/callback', query: { state: 's' } };
  const res = response(); await controller.callback(req, res, e => { throw e; });
  assert.equal(res.statusCode, 403); assert.equal(req.session.auth, undefined);
});

test('expired account consultation preserves general settings without inventing email state', async () => {
  const controller = createOidcAuthController({ config });
  for (const accountToken of [undefined, 'invalid', sealAccountToken(config, identity, 'expired', Date.now() - 1000)]) {
    const res = response();
    const headers = {};
    res.set = (name, value) => { headers[name] = value; return res; };
    await controller.accountSecurity({ session: { auth: { identity, accountToken } } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(headers['Cache-Control'], 'no-store');
    assert.equal(res.body.managementPath, '/api/auth/account');
    assert.deepEqual(res.body.emailVerification, { available: false, reauthenticationRequired: true });
  }
});
