const assert = require("node:assert/strict");
const test = require("node:test");
const { generateKeyPair } = require("node:crypto");
const { promisify } = require("node:util");
const { OidcClient } = require("../../src/security/oidcClient");
const { createOidcAuthController } = require("../../src/controllers/oidcAuthController");

const generateKeyPairAsync = promisify(generateKeyPair);
const issuer = "https://issuer.example.test";
const clientId = "c4g-crypto-test";

async function keyPair() {
  return generateKeyPairAsync("rsa", { modulusLength: 2048 });
}

async function adapterFor({ claimOverrides = {}, signingKey, jwksKey, tamperSignature = false }) {
  const openid = await import("openid-client");
  const jose = await import("jose");
  const now = Math.floor(Date.now() / 1000);
  const publicJwk = await jose.exportJWK(jwksKey.publicKey);
  Object.assign(publicJwk, { kid: "f2-local-key", alg: "RS256", use: "sig" });
  let idToken = await new jose.SignJWT({
    sub: "subject", nonce: "expected-nonce", auth_time: now, acr: "c4g-loa2", amr: ["otp"], ...claimOverrides
  })
    .setProtectedHeader({ alg: "RS256", kid: "f2-local-key", typ: "JWT" })
    .setIssuer(claimOverrides.iss || issuer)
    .setAudience(claimOverrides.aud || clientId)
    .setIssuedAt(claimOverrides.iat || now)
    .setExpirationTime(claimOverrides.exp || now + 300)
    .sign(signingKey.privateKey);
  if (tamperSignature) {
    const parts = idToken.split(".");
    parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
    idToken = parts.join(".");
  }
  const configuration = new openid.Configuration({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    id_token_signing_alg_values_supported: ["RS256"]
  }, clientId, { token_endpoint_auth_method: "none", redirect_uris: ["https://app.example.test/api/auth/oidc/callback"] });
  configuration[openid.customFetch] = async url => {
    if (String(url) === `${issuer}/token`) return new Response(JSON.stringify({
      access_token: "local-access-token", token_type: "Bearer", expires_in: 300, id_token: idToken
    }), { status: 200, headers: { "content-type": "application/json" } });
    if (String(url) === `${issuer}/jwks`) return new Response(JSON.stringify({ keys: [publicJwk] }), {
      status: 200, headers: { "content-type": "application/json" }
    });
    return new Response("not found", { status: 404 });
  };
  return new OidcClient({
    issuer: new URL(issuer), clientId, redirectUri: new URL("https://app.example.test/api/auth/oidc/callback")
  }, { library: openid, configuration });
}

function request(state = "expected-state") {
  const sessionState = {
    oidcTransaction: {
      codeVerifier: "synthetic-verifier-with-sufficient-length-1234567890",
      state,
      nonce: "expected-nonce",
      createdAt: Date.now(),
      returnPath: "/"
    },
    destroy(callback) { callback(); }
  };
  return {
    session: sessionState,
    sessionID: "old-sid",
    query: { state: "expected-state" },
    originalUrl: "/api/auth/oidc/callback?code=local-code&state=expected-state"
  };
}

function response() {
  return {
    statusCode: 200, body: null,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    redirect(value, location) { this.statusCode = value; this.location = location; return this; }
  };
}

async function rejectedCase(adapter, state) {
  let identityResolved = false;
  const req = request(state);
  const res = response();
  const controller = createOidcAuthController({
    config: {
      oidcTransactionMs: 600000, publicOrigin: new URL("https://app.example.test"), sessionAbsoluteMs: 3600000,
      policyVersion: "f2-v1", privilegedRoleNames: [], assurancePolicy: {}, sessionCookieName: "__Host-c4g_session",
      secureCookie: true, postLogoutRedirectUri: new URL("https://app.example.test/login")
    },
    oidcClient: adapter,
    identityRepository: { resolve: async () => { identityResolved = true; return null; } },
    sessionRegistry: { consumeOidcTransaction: async () => true }
  });
  await controller.callback(req, res, error => { throw error; });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "OIDC_CALLBACK_REJECTED");
  assert.equal(req.session.auth, undefined);
  assert.equal(identityResolved, false);
}

test("real openid-client rejects cryptographic nonce, issuer, audience and signature failures", async t => {
  const trusted = await keyPair();
  const untrusted = await keyPair();
  const cases = [
    ["nonce", { claimOverrides: { nonce: "wrong-nonce" }, signingKey: trusted, jwksKey: trusted }],
    ["issuer", { claimOverrides: { iss: "https://wrong-issuer.example.test" }, signingKey: trusted, jwksKey: trusted }],
    ["audience", { claimOverrides: { aud: "wrong-client" }, signingKey: trusted, jwksKey: trusted }],
    ["signature", { claimOverrides: {}, signingKey: untrusted, jwksKey: trusted, tamperSignature: true }]
  ];
  for (const [name, options] of cases) {
    await t.test(name, async () => rejectedCase(await adapterFor(options)));
  }
});

test("real openid-client rejects state before creating application state", async () => {
  const trusted = await keyPair();
  await rejectedCase(await adapterFor({ claimOverrides: {}, signingKey: trusted, jwksKey: trusted }), "different-state");
});
