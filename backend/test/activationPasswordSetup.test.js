'use strict';
// An account that an earlier, abandoned invitation created has no password to sign in with
// (context/features/activation-other-account-session.md, "Conta existente sem palavra-passe").
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOidcActivationAdapter } = require('../src/platformOnboarding/oidcActivationAdapter');
const { createKeycloakAdapter } = require('../src/platformOnboarding/keycloakAdapter');

const ISSUER = 'https://login.example.test/realms/c4g-staging';
const ORIGIN = 'https://app.example.test';
const INVITED = 'invited-subject';

function library() {
  const calls = []; let n = 0;
  return { calls, async discovery(url, clientId) { return { clientId }; }, enableNonRepudiationChecks() {},
    randomPKCECodeVerifier: () => 'verifier-' + (++n), randomState: () => 'state-' + (++n), randomNonce: () => 'nonce-' + (++n),
    async calculatePKCECodeChallenge(verifier) { return 'challenge-of-' + verifier; },
    buildAuthorizationUrl(config, parameters) { calls.push([config.clientId, parameters]); return new URL(ISSUER + '/auth?' + new URLSearchParams(parameters)); } };
}

test('the activation request goes straight to the identity provider, with no step before it', async () => {
  const lib = library();
  const oidc = await createOidcActivationAdapter({ issuer: ISSUER, origin: ORIGIN, manualClientId: 'manual', existingClientId: 'existing', library: lib,
    service: { async checkActivation() { return { issuer: ISSUER, subject: INVITED, mode: 'CREATED' }; } }, passwordReady: async () => false, callbackPath: '/api/admission-activation/callback' });
  const url = new URL(await oidc.begin('exchange', 'binding'));
  assert.equal(lib.calls.length, 1);
  assert.deepEqual([lib.calls[0][0], url.searchParams.get('c4g_ticket'), url.searchParams.get('prompt'), url.searchParams.get('redirect_uri')], ['manual', 'exchange', null, ORIGIN + '/api/admission-activation/callback']);
  assert.deepEqual([typeof oidc.resume, typeof oidc.signOutUrl], ['undefined', 'undefined'], 'another account in the browser is left to the identity provider, as before');
});

test('an existing account without a password sets it through the invitation, and one with a password still signs in', async () => {
  const run = async ({ mode, hasPassword, pending }) => {
    const lib = library(), asked = [];
    const oidc = await createOidcActivationAdapter({ issuer: ISSUER, origin: ORIGIN, manualClientId: 'manual', existingClientId: 'existing', library: lib,
      service: { async checkActivation() { return { issuer: ISSUER, subject: INVITED, mode }; } }, passwordReady: async () => hasPassword, callbackPath: '/api/activation/callback',
      ...(pending === undefined ? {} : { passwordSetupPending: async subject => { asked.push(subject); return pending; } }) });
    await oidc.begin('exchange', 'binding');
    const request = lib.calls.at(-1);
    return [request[0], request[1].c4g_ticket ? 'ticket' : request[1].prompt, asked.length];
  };
  assert.deepEqual(await run({ mode: 'EXISTING', hasPassword: false, pending: true }), ['manual', 'ticket', 1]);
  assert.deepEqual(await run({ mode: 'EXISTING', hasPassword: false, pending: false }), ['existing', 'login', 1], 'an account not created by an invitation is never given a password this way');
  assert.deepEqual(await run({ mode: 'EXISTING', hasPassword: false, pending: 'yes' }), ['existing', 'login', 1], 'only an explicit true counts');
  assert.deepEqual(await run({ mode: 'EXISTING', hasPassword: true, pending: true }), ['existing', 'login', 0], 'a password in place is never replaced');
  assert.deepEqual(await run({ mode: 'EXISTING', hasPassword: false }), ['existing', 'login', 0], 'without the check the behaviour is the previous one');
  assert.deepEqual(await run({ mode: 'CREATED', hasPassword: false, pending: false }), ['manual', 'ticket', 0]);
  assert.deepEqual(await run({ mode: 'CREATED', hasPassword: true, pending: true }), ['existing', 'login', 0]);
});

test('setup is pending only for an enabled account that onboarding created and that has no password credential', async () => {
  const SUBJECT = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const pending = async (user, credentials) => {
    const fetchImpl = async url => { const body = String(url).endsWith('/credentials') ? credentials : user; return { ok: true, status: 200, headers: { get: () => null }, async json() { return body; } }; };
    return createKeycloakAdapter({ issuer: ISSUER, accessToken: async () => 'token', ownershipKey: 'k'.repeat(32), fetchImpl }).passwordSetupPending(SUBJECT);
  };
  const owned = { id: SUBJECT, enabled: true, attributes: { c4g_onboarding_owner: ['marker'] } };
  assert.equal(await pending(owned, []), true);
  assert.equal(await pending(owned, [{ type: 'otp' }]), true);
  assert.equal(await pending(owned, [{ type: 'password' }]), false);
  assert.equal(await pending({ ...owned, enabled: false }, []), false);
  assert.equal(await pending({ id: SUBJECT, enabled: true }, []), false, 'an account from elsewhere is left alone');
  assert.equal(await pending({ id: SUBJECT, enabled: true, attributes: { c4g_onboarding_owner: [''] } }, []), false);
});
