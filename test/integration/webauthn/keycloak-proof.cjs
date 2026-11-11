'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { chromium } = require('../../../frontend/test-harness/node_modules/playwright');

async function main() {
  const base = process.env.WEBAUTHN_PROOF_ORIGIN;
  assert.equal(new URL(base).hostname, 'localhost');
  for (let i = 0; ; i++) {
    try { if ((await fetch(base + '/realms/master/.well-known/openid-configuration')).ok) break; } catch {}
    if (i === 90) throw Error('Keycloak unavailable');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const login = await fetch(base + '/realms/master/protocol/openid-connect/token', { method: 'POST', body: new URLSearchParams({ client_id: 'admin-cli', grant_type: 'password', username: 'proof-admin', password: process.env.KC_BOOTSTRAP_ADMIN_PASSWORD }) });
  assert.equal(login.status, 200);
  const adminToken = (await login.json()).access_token;
  async function admin(path, method = 'GET', body) {
    const response = await fetch(base + '/admin/realms' + path, { method, headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw Error(`Keycloak admin ${method} ${path}: ${response.status} ${(await response.text()).slice(0, 300)}`);
    const text = await response.text(); return text ? JSON.parse(text) : null;
  }
  const realm = 'webauthn-proof', root = '/' + realm + '/';
  await admin('', 'POST', { realm, enabled: true, sslRequired: 'none', webAuthnPolicyRpEntityName: 'C4G proof', webAuthnPolicyRpId: 'localhost', webAuthnPolicyUserVerificationRequirement: 'required', attributes: { 'acr.loa.map': JSON.stringify({ 'c4g-webauthn': 2 }) } });
  const kc = (path, method, body) => admin(root + path, method, body);
  await kc('authentication/flows', 'POST', { alias: 'proof-browser', providerId: 'basic-flow', topLevel: true, builtIn: false });
  for (const [provider, reference] of [['auth-username-password-form', 'pwd'], ['webauthn-authenticator', 'webauthn']]) {
    const path = 'authentication/flows/proof-browser/executions';
    await kc(path + '/execution', 'POST', { provider });
    const item = (await kc(path)).find(value => value.providerId === provider);
    assert(item, provider);
    await kc(path, 'PUT', { ...item, requirement: 'REQUIRED' });
    await kc('authentication/executions/' + item.id + '/config', 'POST', { alias: provider + '-proof', config: { 'default.reference.value': reference, 'default.reference.maxAge': '300' } });
  }
  const flow = (await kc('authentication/flows')).find(item => item.alias === 'proof-browser');
  const callbackServer = http.createServer((request, response) => response.end('Proof callback'));
  await new Promise((resolve, reject) => callbackServer.listen(0, '127.0.0.1', resolve).on('error', reject));
  const redirect = `http://127.0.0.1:${callbackServer.address().port}/callback`;
  await kc('clients', 'POST', { clientId: 'proof', enabled: true, publicClient: true, standardFlowEnabled: true, redirectUris: [redirect], authenticationFlowBindingOverrides: { browser: flow.id }, protocolMappers: [{ name: 'amr', protocol: 'openid-connect', protocolMapper: 'oidc-amr-mapper', config: { 'id.token.claim': 'true' } }] });
  const password = crypto.randomBytes(24).toString('hex');
  await kc('users', 'POST', { username: 'proof-user', firstName: 'Proof', lastName: 'User', email: 'proof@example.invalid', emailVerified: true, enabled: true, requiredActions: ['webauthn-register'], credentials: [{ type: 'password', value: password, temporary: false }] });
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    page.on('dialog', dialog => dialog.accept('Autenticador de ensaio'));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const params = new URLSearchParams({ client_id: 'proof', response_type: 'code', scope: 'openid', redirect_uri: redirect, state: 'proof-state', nonce: 'proof-nonce', code_challenge: challenge, code_challenge_method: 'S256', acr_values: 'c4g-webauthn' });
    await page.goto(base + '/realms/' + realm + '/protocol/openid-connect/auth?' + params);
    await page.locator('#username').fill('proof-user'); await page.locator('#password').fill(password); await page.locator('#kc-login').click();
    await page.locator('#registerWebAuthn').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('#registerWebAuthn').click();
    await page.waitForURL(url => url.toString().startsWith(redirect), { timeout: 20000 }).catch(() => {});
    const result = new URL(page.url());
    if (result.origin !== new URL(redirect).origin) console.error('Registration page:', (await page.locator('body').innerText()).slice(0, 1200));
    assert.equal(result.origin, new URL(redirect).origin, 'callback did not arrive');
    assert.equal(result.searchParams.get('state'), 'proof-state');
    const tokenResponse = await fetch(base + '/realms/' + realm + '/protocol/openid-connect/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'proof', redirect_uri: redirect, code: result.searchParams.get('code'), code_verifier: verifier }) });
    assert.equal(tokenResponse.status, 200);
    const idToken = (await tokenResponse.json()).id_token, [header, payload, signature] = idToken.split('.');
    const h = JSON.parse(Buffer.from(header, 'base64url')), claims = JSON.parse(Buffer.from(payload, 'base64url'));
    const keys = await (await fetch(base + '/realms/' + realm + '/protocol/openid-connect/certs')).json();
    const key = keys.keys.find(item => item.kid === h.kid);
    assert.equal(h.alg, 'RS256'); assert(crypto.verify('RSA-SHA256', Buffer.from(header + '.' + payload), crypto.createPublicKey({ key, format: 'jwk' }), Buffer.from(signature, 'base64url')));
    assert.equal(claims.iss, base + '/realms/' + realm); assert.equal(claims.aud, 'proof'); assert.equal(claims.nonce, 'proof-nonce');
    console.log(JSON.stringify({ signatureVerified: true, acr: claims.acr, amr: claims.amr, authTimePresent: Number.isFinite(claims.auth_time) }));
    assert(Array.isArray(claims.amr) && claims.amr.includes('webauthn'), 'Enrollment token is not evidence of WebAuthn authentication');
    assert.equal(claims.acr, 'c4g-webauthn', 'Expected the dedicated WebAuthn assurance level');
  } finally { await browser.close(); callbackServer.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
