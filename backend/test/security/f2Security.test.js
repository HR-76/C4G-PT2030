const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const session = require("express-session");
const { loadAuthConfig } = require("../../src/security/authConfig");
const { createSessionSecurity } = require("../../src/security/sessionSecurity");
const { createOriginProtection } = require("../../src/security/originProtection");
const { buildAssuranceEvidence, evaluateAssurance } = require("../../src/security/assurance");
const { createOidcAuthController } = require("../../src/controllers/oidcAuthController");
const { OidcClient } = require("../../src/security/oidcClient");
const { safeReturnPath, validateAssurancePolicy } = require("../../src/security/authConfig");
const { createPgSessionRegistry, InMemorySessionRegistry } = require("../../src/security/sessionRegistry");
const { createCredentialGuard, configureAuthentication, authenticate } = require("../../src/middlewares/authMiddleware");
const { selectAuthRoutes } = require("../../src/productionComposition");
const { createOidcAuthRouter } = require("../../src/routes/oidcAuthRoutes");
const { createApp } = require("../../src/app");

function config(overrides = {}) {
  return {
    oidcTransactionMs: 600000,
    publicOrigin: new URL("https://app.example.test"),
    postLogoutRedirectUri: new URL("https://app.example.test/login"),
    sessionCookieName: "__Host-c4g_session",
    sessionAbsoluteMs: 3600000,
    policyVersion: "test-v1",
    privilegedRoleNames: ["C4G_ADMIN", "SUPPORT", "ORG_ADMIN"],
    privilegedLoginCategory: "recent-mfa",
    assurancePolicy: {
      "recent-auth": { mfa: false, maxAgeSeconds: 600, acceptedAcr: [], acceptedAmr: [], amrMode: "any" },
      "recent-mfa": { mfa: true, maxAgeSeconds: 300, acceptedAcr: ["urn:c4g:loa2"], acceptedAmr: ["otp"], amrMode: "any" }
    },
    ...overrides
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    redirectValue: null,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    redirect(status, value) { this.statusCode = status; this.redirectValue = value; return this; },
    clearCookie() { return this; }
  };
}

function callbackRequest(transaction) {
  const sessionState = {
    oidcTransaction: transaction,
    destroy(callback) { callback(); }
  };
  const req = { session: sessionState, sessionID: "session-old", query: { state: transaction.state }, originalUrl: "/api/auth/oidc/callback?code=synthetic&state=state" };
  sessionState.regenerate = callback => {
    sessionState.regenerated = true;
    req.sessionID = "session-new";
    callback();
  };
  return req;
}

function sessionRegistry(overrides = {}) {
  return {
    registerOidcTransaction: async () => {}, consumeOidcTransaction: async () => true,
    bindSession: async () => {}, rotateSession: async () => {}, revokeSession: async () => {}, expireSession: async () => {}, ...overrides
  };
}

test("SEC-AC-01 creates only server-side application state after a validated PKCE callback", async () => {
  const now = 2_000_000_000_000;
  const transaction = { codeVerifier: "verifier", state: "state", nonce: "nonce", createdAt: now, returnPath: "/dashboard" };
  const req = callbackRequest(transaction);
  const res = responseRecorder();
  const registry = new InMemorySessionRegistry();
  await registry.bindSession({ sid: "session-old", globalUserId: "user-1", revocationVersion: 1, expiresAt: now + 60_000 });
  await registry.registerOidcTransaction({ sid: "session-old", state: "state", expiresAt: now + 60_000 });
  const controller = createOidcAuthController({
    config: config(), now: () => now,
    oidcClient: { callback: async () => ({ claims: { sub: "subject", iss: "https://issuer", auth_time: now / 1000, amr: ["pwd"] } }) },
    identityRepository: { resolve: async () => ({ id: "user-1", name: "Synthetic", email: "synthetic@example.test", platformRoles: [], sessionRevocationVersion: 1 }) },
    sessionRegistry: registry
  });
  await controller.callback(req, res, error => { throw error; });
  assert.equal(res.statusCode, 302);
  assert.equal(res.redirectValue, "/dashboard");
  assert.equal(req.session.regenerated, true);
  assert.equal(req.sessionID, "session-new");
  assert.equal(await registry.validateSession({ sid: "session-old", globalUserId: "user-1", revocationVersion: 1, now }), false);
  assert.equal(await registry.validateSession({ sid: "session-new", globalUserId: "user-1", revocationVersion: 1, now }), true);
  assert.equal(req.session.auth.user.id, "user-1");
  assert.equal(JSON.stringify(req.session.auth).includes("synthetic"), true);
  for (const forbidden of ["access_token", "refresh_token", "id_token", "codeVerifier", "nonce", "state"]) {
    assert.equal(JSON.stringify(req.session.auth).includes(forbidden), false);
  }
});

test("SEC-AC-01 frontend persists only the approved editorial recovery envelope, never authentication", async () => {
  const frontendRoot = path.resolve(__dirname, "../../../frontend/src");
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (/\.(?:js|jsx)$/.test(entry.name)) files.push(target);
    }
  };
  visit(frontendRoot);
  const executableFiles = files.filter(file => !/\.(?:test|spec)\.(?:js|jsx)$/.test(file)
    && !file.split(path.sep).includes('__fixtures__') && !file.split(path.sep).includes('fixtures'));
  const source = executableFiles.map(file => fs.readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(source, /localStorage/);
  const envelopePath = path.join(frontendRoot, 'pages/Editorial/intentions.js');
  const intentionFiles = new Set([envelopePath,path.join(frontendRoot,'pages/Prequalification/intentions.js'),path.join(frontendRoot,'pages/Pq1/intentions.js'),path.join(frontendRoot,'pages/OpportunityCriteria/intentions.js'),
    path.join(frontendRoot,'pages/Applications/intentions.js'),path.join(frontendRoot,'pages/Applications/PrivateApplications.jsx'),path.join(frontendRoot,'pages/Applications/ApplicationBrowse.jsx'),
    path.join(frontendRoot,'pages/Applications/ApplicationWork.jsx'),path.join(frontendRoot,'pages/Applications/ApplicationPartners.jsx'),
    path.join(frontendRoot,'pages/Applications/ApplicationDocumentsReview.jsx'),path.join(frontendRoot,'pages/Organization/OrganizationProfile.jsx'),
    path.join(frontendRoot,'pages/Organization/intentions.js'),path.join(frontendRoot,'pages/Opportunities/manualIntentions.js'),path.join(frontendRoot,'pages/Interests/intentions.js'),
    path.join(frontendRoot,'pages/Platform/euLegacyReview.js'),
    path.join(frontendRoot,'pages/Platform/euLegacyAcceptanceReview.js'),
    // Logout outcome marker only: { status, at }, ten-minute lifetime.
    path.join(frontendRoot,'api/logoutResult.js')]);
  const logoutResult = fs.readFileSync(path.join(frontendRoot,'api/logoutResult.js'),'utf8');
  assert.doesNotMatch(logoutResult, /access_token|refresh_token|id_token|csrfToken|sessionId|user|organization/i);
  assert.match(logoutResult, /JSON\.stringify\(\{ status, at: Date\.now\(\) \}\)/);
  const applicationSource = files.filter(file => !intentionFiles.has(file) && !/\.test\.(js|jsx)$/.test(file)).map(file => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(applicationSource, /sessionStorage/);
  const acceptanceRecovery = fs.readFileSync(path.join(frontendRoot,'pages/Platform/euLegacyAcceptanceReview.js'),'utf8');
  assert.doesNotMatch(acceptanceRecovery, /access_token|refresh_token|id_token|csrfToken|sessionId/);
  const { saveIntention } = await import(require('node:url').pathToFileURL(envelopePath).href);
  const entries = new Map(), storage = { setItem: (key, value) => entries.set(key, value) };
  const id = '00000000-0000-4000-8000-000000000001';
  const envelope = { userId: id, organizationId: id, resourceId: id, operation: 'SUBMIT', idempotencyKey: id, expectedRevision: 1 };
  saveIntention(envelope, storage);
  assert.deepEqual(JSON.parse([...entries.values()][0]), envelope);
  for (const field of ['token', 'access_token', 'refresh_token', 'id_token', 'mfa', 'content', 'expectedDigest', 'concurrencyToken', 'role', 'grants']) {
    assert.throws(() => saveIntention({ ...envelope, [field]: 'restricted' }, storage));
  }
  const {saveManualIntention}=await import(require('node:url').pathToFileURL(path.join(frontendRoot,'pages/Opportunities/manualIntentions.js')).href);
  const manual={userId:id,requestId:id,fields:{title:'Synthetic',funderName:'Synthetic'},receipt:{opportunityId:id}};
  saveManualIntention(manual,storage);
  assert.deepEqual(JSON.parse(entries.get('c4g.central-manual.intention.v1:'+id)),manual);
  for(const field of ['token','access_token','refresh_token','id_token','mfa','role','grants','organizationId']){
    assert.throws(()=>saveManualIntention({...manual,[field]:'restricted'},storage));
    assert.throws(()=>saveManualIntention({...manual,fields:{...manual.fields,[field]:'restricted'}},storage));
    assert.throws(()=>saveManualIntention({...manual,receipt:{...manual.receipt,[field]:'restricted'}},storage));
  }
  const {saveReviewProgress}=await import(require('node:url').pathToFileURL(path.join(frontendRoot,'pages/Platform/euLegacyReview.js')).href);
  const digest='a'.repeat(64), actor='00000000-0000-4000-8000-000000000002';
  const review={pending:{[digest]:{requestId:'01900000-0000-7000-8000-000000000001',bindingDigest:digest}},receipts:{}};
  saveReviewProgress(id,actor,review,storage);
  assert.deepEqual(JSON.parse(entries.get(`c4g:eu-legacy-prearchive:${id}:${actor}`)),review);
  for(const field of ['token','access_token','refresh_token','id_token','mfa','role','grants']){
    assert.throws(()=>saveReviewProgress(id,actor,{...review,[field]:'restricted'},storage));
    assert.throws(()=>saveReviewProgress(id,actor,{...review,pending:{[digest]:{...review.pending[digest],[field]:'restricted'}}},storage));
  }
  assert.doesNotMatch(source, /Authorization\s*=.*Bearer|headers\.Authorization/);
  const authContext = fs.readFileSync(path.join(frontendRoot, "contexts/AuthContext.jsx"), "utf8");
  assert.match(authContext, /LOGOUT_INCOMPLETE/);
  assert.match(authContext, /error\.response\.data\.redirectUrl/);
});

test("SEC-AC-02 OIDC adapter delegates state, nonce, PKCE and recent-auth checks to openid-client", async () => {
  let observed;
  const library = {
    authorizationCodeGrant: async (configuration, url, checks) => {
      observed = { configuration, url, checks };
      return { claims: () => ({ sub: "subject" }) };
    }
  };
  const client = new OidcClient(config({ redirectUri: new URL("https://app.example.test/api/auth/oidc/callback") }), {
    library,
    configuration: { synthetic: true }
  });
  await client.callback("https://app.example.test/api/auth/oidc/callback?code=code&state=state", {
    codeVerifier: "verifier", state: "state", nonce: "nonce", stepUp: true, maxAge: 300
  });
  assert.equal(observed.url.href, "https://app.example.test/api/auth/oidc/callback?code=code&state=state");
  assert.deepEqual(observed.checks, {
    pkceCodeVerifier: "verifier", expectedState: "state", expectedNonce: "nonce", idTokenExpected: true, maxAge: 300
  });
});

for (const invalidCase of ["state", "nonce", "issuer", "audience", "signature", "redirect_uri", "code", "pkce", "token_time"]) {
  test(`SEC-AC-02 rejects invalid ${invalidCase} without creating a session`, async () => {
    const now = 2_000_000_000_000;
    const req = callbackRequest({ codeVerifier: "verifier", state: "state", nonce: "nonce", createdAt: now, returnPath: "/" });
    const res = responseRecorder();
    const controller = createOidcAuthController({
      config: config(), now: () => now,
      oidcClient: { callback: async () => { throw new Error(`invalid ${invalidCase}`); } },
    identityRepository: { resolve: async () => { throw new Error("must not resolve identity"); } },
    sessionRegistry: sessionRegistry()
    });
    await controller.callback(req, res, error => { throw error; });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "OIDC_CALLBACK_REJECTED");
    assert.equal(req.session.auth, undefined);
    assert.notEqual(req.session.regenerated, true);
  });
}

test("state mismatch is rejected before consuming the registered transaction", async () => {
  const now = 2_000_000_000_000;
  const req = callbackRequest({ codeVerifier: "verifier", state: "expected-state", nonce: "nonce", createdAt: now, returnPath: "/" });
  req.query.state = "tampered-state";
  let consumed = false;
  const res = responseRecorder();
  const controller = createOidcAuthController({
    config: config(), now: () => now,
    oidcClient: { callback: async () => { throw new Error("must not validate OIDC"); } },
    identityRepository: { resolve: async () => { throw new Error("must not resolve identity"); } },
    sessionRegistry: sessionRegistry({ consumeOidcTransaction: async () => { consumed = true; return true; } })
  });
  await controller.callback(req, res, error => { throw error; });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "OIDC_CALLBACK_REJECTED");
  assert.equal(consumed, false);
  assert.ok(req.session.oidcTransaction);
});

test("SEC-AC-03 uses a __Host secure HttpOnly SameSite cookie and session-bound CSRF", async t => {
  const security = createSessionSecurity({
    config: {
      oidcEnabled: true, mode: "oidc", sessionCookieName: "__Host-c4g_session", sessionSecret: "synthetic-secret-at-least-32-characters",
      secureCookie: true, sessionIdleMs: 60000, publicOrigin: new URL("https://app.example.test"),
      allowedDevelopmentOrigins: [], nodeEnv: "production"
    },
    pool: {}, sessionStore: new session.MemoryStore()
  });
  const app = express();
  app.set("trust proxy", 1);
  app.use(security.sessionMiddleware);
  app.use(express.json());
  app.use(security.originProtection);
  app.use(security.csrfProtection);
  app.get("/csrf", (req, res) => res.json({ token: security.generateCsrfToken(req) }));
  let mutationCount = 0;
  app.post("/mutate", (req, res) => { mutationCount += 1; res.json({ ok: true }); });
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ code: error.code }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const csrfResponse = await fetch(`${base}/csrf`, { headers: { "x-forwarded-proto": "https" } });
  const cookie = csrfResponse.headers.get("set-cookie");
  const token = (await csrfResponse.json()).token;
  assert.match(cookie, /^__Host-c4g_session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//i);
  assert.doesNotMatch(cookie, /Domain=/i);

  const invalidOrigin = await fetch(`${base}/mutate`, {
    method: "POST", headers: { cookie, origin: "https://evil.example", "x-csrf-token": token, "x-forwarded-proto": "https" }
  });
  assert.equal(invalidOrigin.status, 403);
  assert.equal(mutationCount, 0);
  const missingCsrf = await fetch(`${base}/mutate`, {
    method: "POST", headers: { cookie, origin: "https://app.example.test", "x-forwarded-proto": "https" }
  });
  assert.equal(missingCsrf.status, 403);
  assert.equal(mutationCount, 0);
  const invalidCsrf = await fetch(`${base}/mutate`, {
    method: "POST", headers: { cookie, origin: "https://app.example.test", "x-csrf-token": `${token}tampered`, "x-forwarded-proto": "https" }
  });
  assert.equal(invalidCsrf.status, 403);
  assert.equal(mutationCount, 0);
  const secondCsrfResponse = await fetch(`${base}/csrf`, { headers: { "x-forwarded-proto": "https" } });
  const secondCookie = secondCsrfResponse.headers.get("set-cookie");
  const secondToken = (await secondCsrfResponse.json()).token;
  assert.notEqual(secondToken, token);
  const crossSessionCsrf = await fetch(`${base}/mutate`, {
    method: "POST", headers: { cookie: secondCookie, origin: "https://app.example.test", "x-csrf-token": token, "x-forwarded-proto": "https" }
  });
  assert.equal(crossSessionCsrf.status, 403);
  assert.equal(mutationCount, 0);
  const valid = await fetch(`${base}/mutate`, {
    method: "POST", headers: { cookie, origin: "https://app.example.test", "x-csrf-token": token, "x-forwarded-proto": "https" }
  });
  assert.equal(valid.status, 200);
  assert.equal(mutationCount, 1);
});

test("SEC-AC-03 rejects unsafe requests without Origin or Referer and accepts exact Referer fallback", () => {
  const middleware = createOriginProtection({ allowedOrigins: ["https://app.example.test"] });
  const run = headers => {
    let next = false;
    const req = { method: "POST", get: name => headers[name.toLowerCase()] };
    const res = responseRecorder();
    middleware(req, res, () => { next = true; });
    return { next, res };
  };
  assert.equal(run({}).res.statusCode, 403);
  assert.equal(run({ referer: "https://app.example.test/form" }).next, true);
  assert.equal(run({ origin: "https://app.example.test.evil.invalid" }).res.statusCode, 403);
});

test("SEC-AC-04 requires recent unambiguous MFA evidence", () => {
  const nowSeconds = 2000;
  const requirement = { mfa: true, maxAgeSeconds: 300 };
  Object.assign(requirement, { acceptedAcr: ["urn:c4g:loa2"], acceptedAmr: ["otp"], amrMode: "any" });
  const valid = buildAssuranceEvidence({ auth_time: 1900, acr: "urn:c4g:loa2", amr: ["otp"] }, "v1");
  const evaluate = evidence => evaluateAssurance({ evidence, requirement, nowSeconds, expectedPolicyVersion: "v1" });
  assert.deepEqual(evaluate(valid), { allowed: true });
  assert.equal(evaluate(null).reason, "AUTH_EVIDENCE_MISSING");
  assert.equal(evaluate({ ...valid, policyVersion: "unknown" }).reason, "AUTH_POLICY_VERSION_MISMATCH");
  assert.equal(evaluate({ ...valid, authTime: 1000 }).reason, "AUTH_EVIDENCE_EXPIRED");
  assert.equal(evaluate({ ...valid, acr: null }).reason, "MFA_EVIDENCE_INSUFFICIENT");
  assert.equal(evaluate({ ...valid, amr: [] }).reason, "MFA_EVIDENCE_INSUFFICIENT");
});

test("SEC-AC-04 rejects privileged login without MFA and rotates session after valid step-up", async () => {
  const now = 2_000_000_000_000;
  const privilegedReq = callbackRequest({ codeVerifier: "v", state: "s", nonce: "n", createdAt: now, returnPath: "/" });
  const privilegedRes = responseRecorder();
  const privilegedController = createOidcAuthController({
    config: config(), now: () => now,
    oidcClient: { callback: async () => ({ claims: { sub: "s", iss: "https://issuer", auth_time: now / 1000, amr: ["pwd"] } }) },
    identityRepository: { resolve: async () => ({ id: "admin-1", platformRoles: ["C4G_ADMIN"], sessionRevocationVersion: 1 }) },
    sessionRegistry: sessionRegistry()
  });
  await privilegedController.callback(privilegedReq, privilegedRes, error => { throw error; });
  assert.equal(privilegedRes.statusCode, 403);
  assert.equal(privilegedRes.body.code, "MFA_EVIDENCE_INSUFFICIENT");
  assert.equal(privilegedReq.session.auth, undefined);

  const stepUpReq = callbackRequest({ codeVerifier: "v", state: "s", nonce: "n", createdAt: now, returnPath: "/settings", stepUp: true, category: "recent-mfa", maxAge: 300 });
  stepUpReq.session.auth = {
    user: { id: "user-1", platformRoles: [], sessionRevocationVersion: 1 },
    identity: { issuer: "https://issuer", subject: "s" }, absoluteExpiresAt: now + 100000
  };
  const stepUpRes = responseRecorder();
  const stepUpController = createOidcAuthController({
    config: config(), now: () => now,
    oidcClient: { callback: async () => ({ claims: { sub: "s", iss: "https://issuer", auth_time: now / 1000, acr: "urn:c4g:loa2", amr: ["otp"] } }) },
    identityRepository: { resolve: async () => null },
    sessionRegistry: sessionRegistry()
  });
  await stepUpController.callback(stepUpReq, stepUpRes, error => { throw error; });
  assert.equal(stepUpRes.statusCode, 302);
  assert.equal(stepUpReq.session.regenerated, true);
  assert.equal(stepUpReq.session.auth.user.id, "user-1");
});

test("logout revokes the local session even when Keycloak logout is unavailable", async () => {
  const req = callbackRequest({});
  req.session.auth = { user: { id: "user-1" } };
  let destroyed = false;
  req.session.destroy = callback => { destroyed = true; callback(); };
  const res = responseRecorder();
  let cleared = false;
  res.clearCookie = () => { cleared = true; return res; };
  const controller = createOidcAuthController({
    config: config(),
    oidcClient: { endSessionUrl: async () => { throw new Error("unavailable"); } },
    identityRepository: {},
    sessionRegistry: sessionRegistry()
  });
  await controller.logout(req, res, error => { throw error; });
  assert.equal(destroyed, true);
  assert.equal(cleared, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.redirectUrl, "https://app.example.test/login");
  assert.equal(res.body.identityLogoutUnavailable, true);
});

test("step-up rejects a different issuer or subject and does not elevate assurance", async () => {
  const now = 2_000_000_000_000;
  for (const claims of [
    { iss: "https://other-issuer", sub: "subject-1" },
    { iss: "https://issuer", sub: "other-subject" }
  ]) {
    const req = callbackRequest({ codeVerifier: "v", state: "s", nonce: "n", createdAt: now, returnPath: "/", stepUp: true, category: "recent-mfa", maxAge: 300 });
    const originalEvidence = { authTime: 1000, acr: null, amr: ["pwd"], policyVersion: "test-v1" };
    req.session.auth = {
      user: { id: "user-1", platformRoles: [], sessionRevocationVersion: 1 },
      identity: { issuer: "https://issuer", subject: "subject-1" },
      evidence: originalEvidence,
      absoluteExpiresAt: now + 100000
    };
    const res = responseRecorder();
    const controller = createOidcAuthController({
      config: config(), now: () => now,
      oidcClient: { callback: async () => ({ claims: { ...claims, auth_time: now / 1000, acr: "urn:c4g:loa2", amr: ["otp"] } }) },
      identityRepository: {}, sessionRegistry: sessionRegistry()
    });
    await controller.callback(req, res, error => { throw error; });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "STEP_UP_IDENTITY_MISMATCH");
    assert.equal(req.session.oidcTransaction, undefined);
    assert.equal(req.session.auth.evidence, originalEvidence);
    assert.notEqual(req.session.regenerated, true);
  }
});

test("consumed OIDC callback transaction cannot be replayed", async () => {
  const now = 2_000_000_000_000;
  const req = callbackRequest({ codeVerifier: "v", state: "s", nonce: "n", createdAt: now, returnPath: "/" });
  const controller = createOidcAuthController({
    config: config(), now: () => now,
    oidcClient: { callback: async () => ({ claims: { iss: "https://issuer", sub: "subject", auth_time: now / 1000 } }) },
    identityRepository: { resolve: async () => ({ id: "user-1", platformRoles: [], sessionRevocationVersion: 1 }) },
    sessionRegistry: sessionRegistry()
  });
  const first = responseRecorder();
  await controller.callback(req, first, error => { throw error; });
  assert.equal(first.statusCode, 302);
  const replay = responseRecorder();
  await controller.callback(req, replay, error => { throw error; });
  assert.equal(replay.statusCode, 400);
  assert.equal(replay.body.code, "OIDC_TRANSACTION_INVALID");
});

test("concurrent OIDC callback attempts can consume a transaction only once", async () => {
  const registry = new InMemorySessionRegistry();
  await registry.registerOidcTransaction({ sid: "preauth-session", state: "unique-state", expiresAt: 5000 });
  const results = await Promise.all([
    registry.consumeOidcTransaction({ sid: "preauth-session", state: "unique-state", now: 1000 }),
    registry.consumeOidcTransaction({ sid: "preauth-session", state: "unique-state", now: 1000 })
  ]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(await registry.consumeOidcTransaction({ sid: "other-session", state: "unique-state", now: 1000 }), false);
});

test("PostgreSQL OIDC transaction converts a finite epoch to the exact Date before querying", async () => {
  const calls = [];
  const registry = createPgSessionRegistry({
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      return { rows: [] };
    }
  });
  const expiresAt = 2_000_000_123_456;
  await registry.registerOidcTransaction({ sid: "preauth-session", state: "state", expiresAt });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].parameters[2] instanceof Date);
  assert.equal(calls[0].parameters[2].getTime(), expiresAt);
});

test("PostgreSQL OIDC transaction rejects an invalid epoch before querying", async () => {
  let queried = false;
  const registry = createPgSessionRegistry({
    query: async () => {
      queried = true;
      return { rows: [] };
    }
  });
  for (const expiresAt of [Number.NaN, Number.POSITIVE_INFINITY, 9e15]) {
    await assert.rejects(
      registry.registerOidcTransaction({ sid: "preauth-session", state: "state", expiresAt }),
      /expiresAt must/
    );
  }
  assert.equal(queried, false);
});

test("assurance policy validation rejects missing, malformed, unknown and unsafe values", () => {
  const invalidPolicies = [
    null,
    [],
    {},
    { "Bad Category": { mfa: true, maxAgeSeconds: 300, acceptedAmr: ["otp"] } },
    { "recent-mfa": { mfa: "true", maxAgeSeconds: 300, acceptedAmr: ["otp"] } },
    { "recent-mfa": { mfa: true, maxAgeSeconds: Number.NaN, acceptedAmr: ["otp"] } },
    { "recent-mfa": { mfa: true, maxAgeSeconds: 0, acceptedAmr: ["otp"] } },
    { "recent-mfa": { mfa: true, maxAgeSeconds: 86401, acceptedAmr: ["otp"] } },
    { "recent-mfa": { mfa: true, maxAgeSeconds: 300 } },
    { "recent-mfa": { mfa: true, maxAgeSeconds: 300, acceptedAcr: ["urn:c4g:loa2"] } },
    { "recent-mfa": { mfa: true, maxAgeSeconds: 300, acceptedAmr: ["otp"] } },
    { "recent-mfa": { mfa: true, maxAgeSeconds: 300, acceptedAmr: ["otp"], unknown: true } },
    { "recent-mfa": { mfa: true, maxAgeSeconds: 300, acceptedAmr: ["otp"], amrMode: "maybe" } }
  ];
  for (const policy of invalidPolicies) assert.throws(() => validateAssurancePolicy(policy));
});

test("MFA cumulatively requires exact configured ACR, OTP AMR, recency and policy version", () => {
  const requirement = { mfa: true, maxAgeSeconds: 300, acceptedAcr: ["urn:c4g:loa2"], acceptedAmr: ["otp"], amrMode: "all" };
  const nowSeconds = 2000;
  const evaluate = evidence => evaluateAssurance({ evidence, requirement, nowSeconds, expectedPolicyVersion: "v1" });
  const valid = { authTime: 1900, acr: "urn:c4g:loa2", amr: ["otp"], policyVersion: "v1" };
  assert.equal(evaluate(valid).allowed, true);
  assert.equal(evaluate({ ...valid, amr: ["pwd", "otp"] }).allowed, true);
  assert.equal(evaluate({ ...valid, acr: "urn:other:loa2" }).allowed, false);
  assert.equal(evaluate({ ...valid, acr: null }).allowed, false);
  assert.equal(evaluate({ ...valid, amr: [] }).allowed, false);
  assert.equal(evaluate({ ...valid, amr: ["pwd"] }).allowed, false);
  assert.equal(evaluate({ ...valid, policyVersion: "v0" }).reason, "AUTH_POLICY_VERSION_MISMATCH");
});

test("privileged initial login fails closed for absent, future or expired auth_time and accepts valid recency", async () => {
  const now = 2_000_000_000_000;
  const cases = [
    { authTime: undefined, expected: "AUTH_EVIDENCE_MISSING" },
    { authTime: now / 1000 + 1, expected: "AUTH_EVIDENCE_EXPIRED" },
    { authTime: now / 1000 - 301, expected: "AUTH_EVIDENCE_EXPIRED" },
    { authTime: now / 1000 - 100, expected: null }
  ];
  for (const item of cases) {
    const req = callbackRequest({ codeVerifier: "v", state: "s", nonce: "n", createdAt: now, returnPath: "/" });
    const res = responseRecorder();
    const controller = createOidcAuthController({
      config: config(), now: () => now,
      oidcClient: { callback: async () => ({ claims: { iss: "https://issuer", sub: "admin", auth_time: item.authTime, acr: "urn:c4g:loa2", amr: ["otp"] } }) },
      identityRepository: { resolve: async () => ({ id: "admin-1", platformRoles: ["C4G_ADMIN"], sessionRevocationVersion: 1 }) },
      sessionRegistry: sessionRegistry()
    });
    await controller.callback(req, res, error => { throw error; });
    if (item.expected) {
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.code, item.expected);
      assert.equal(req.session.auth, undefined);
    } else {
      assert.equal(res.statusCode, 302);
      assert.equal(req.session.auth.identity.subject, "admin");
    }
  }
});

test("OIDC is the only auth router and publishes the session HTTP catalog", async t => {
  const oidc = createOidcAuthRouter({
    express,
    controller: { login() {}, callback() {}, stepUp() {}, stepUpPolicy() {}, logout() {}, accountSecurity() {}, account() {}, emailVerification() {} },
    authenticate() {},
    generateCsrfToken() {}
  });
  const baseRoutes = {};
  for (const mode of ["oidc"]) {
    const selected = selectAuthRoutes(mode, baseRoutes, oidc);
    const app = createApp({ express, cors: require("cors"), config: { nodeEnv: "test" }, pool: {}, routes: selected });
    const mountedHandles = app.router.stack.map(layer => layer.handle);
    assert.equal(mountedHandles.includes(oidc), true);
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    const catalog = (await response.json()).endpoints.auth;
    assert.deepEqual(catalog,
      ["GET /api/auth/oidc/login", "GET /api/auth/oidc/callback", "GET /api/auth/step-up", "GET /api/auth/step-up-policy", "GET /api/auth/account-security", "POST /api/auth/account-security/email", "GET /api/auth/account", "GET /api/auth/csrf", "GET /api/auth/session", "GET /api/auth/organizations", "POST /api/auth/organization", "POST /api/auth/logout"]);
  }
  const logoutLayer = oidc.stack.find(layer => layer.route && layer.route.path === "/logout");
  assert.equal(logoutLayer.route.stack.length, 1, "logout must not depend on authenticate");
});

test("OIDC credential guard accepts server sessions and rejects bearer credentials", () => {
  const guard = createCredentialGuard({ mode: "oidc" });
  const run = ({ authorization, sessionAuth }) => {
    const req = { headers: { authorization }, session: sessionAuth ? { auth: sessionAuth } : {} };
    const res = responseRecorder();
    let next = false;
    guard(req, res, () => { next = true; });
    return { req, res, next };
  };
  assert.equal(run({ sessionAuth: { user: { id: "session-user" } } }).next, true);
  const bearer = run({ authorization: "Bearer invalid", sessionAuth: { user: { id: "session-user" } } });
  assert.equal(bearer.res.statusCode, 400);
  assert.equal(bearer.res.body.code, "BEARER_NOT_ALLOWED");
});

test("OIDC rejects Bearer plus valid cookie before a mutation can bypass CSRF", async t => {
  const security = createSessionSecurity({
    config: {
      oidcEnabled: true, mode: "oidc", sessionCookieName: "c4g_session_dev", sessionSecret: "synthetic-session-secret-at-least-32-characters",
      secureCookie: false, sessionIdleMs: 60000, publicOrigin: new URL("http://127.0.0.1"),
      allowedDevelopmentOrigins: [], nodeEnv: "development"
    },
    pool: {}, sessionStore: new session.MemoryStore()
  });
  const app = express();
  app.use(security.sessionMiddleware);
  app.use(createCredentialGuard({ mode: "oidc" }));
  app.use(security.originProtection);
  app.use(security.csrfProtection);
  app.get("/seed", (req, res) => {
    req.session.auth = { user: { id: "session-user" }, identity: { issuer: "i", subject: "s" }, absoluteExpiresAt: Date.now() + 60000, revocationVersion: 1 };
    res.json({ ok: true });
  });
  app.post("/mutate", (req, res) => res.json({ mutated: true }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const seed = await fetch(`${base}/seed`);
  const cookie = seed.headers.get("set-cookie");
  const result = await fetch(`${base}/mutate`, { method: "POST", headers: { cookie, authorization: "Bearer invalid" } });
  assert.equal(result.status, 400);
  assert.equal((await result.json()).code, "BEARER_NOT_ALLOWED");
});

test("Origin present but malformed never falls back to Referer", () => {
  const middleware = createOriginProtection({ allowedOrigins: ["https://app.example.test"] });
  const req = { method: "POST", get: name => ({ origin: "not-a-url", referer: "https://app.example.test/form" })[name] };
  const res = responseRecorder();
  let next = false;
  middleware(req, res, () => { next = true; });
  assert.equal(next, false);
  assert.equal(res.statusCode, 403);
  const pathReq = { method: "POST", get: name => name === "origin" ? "https://app.example.test/path" : undefined };
  const pathRes = responseRecorder();
  let pathNext = false;
  middleware(pathReq, pathRes, () => { pathNext = true; });
  assert.equal(pathNext, false);
  assert.equal(pathRes.statusCode, 403);
});

test("return paths accept only canonical local paths", () => {
  assert.equal(safeReturnPath("/dashboard?tab=1#top"), "/dashboard?tab=1#top");
  for (const value of ["https://evil.example", "//evil.example", "/\\evil.example", "/%5cevil", "/%2fevil", "/a/../admin", "/line\nfeed", "dashboard"]) {
    assert.equal(safeReturnPath(value, "/safe"), "/safe");
  }
});

test("session registry revokes one session or every session for a user without JSON searches", async () => {
  const registry = new InMemorySessionRegistry();
  await registry.bindSession({ sid: "a-1", globalUserId: "user-a", revocationVersion: 1, expiresAt: 9999 });
  await registry.bindSession({ sid: "a-2", globalUserId: "user-a", revocationVersion: 1, expiresAt: 9999 });
  await registry.bindSession({ sid: "b-1", globalUserId: "user-b", revocationVersion: 1, expiresAt: 9999 });
  assert.equal(await registry.validateSession({ sid: "a-1", globalUserId: "user-a", revocationVersion: 1, now: 1 }), true);
  await registry.revokeSession("a-1");
  assert.equal(await registry.validateSession({ sid: "a-1", globalUserId: "user-a", revocationVersion: 1, now: 1 }), false);
  const result = await registry.revokeUser("user-a");
  assert.deepEqual(result.revokedSessionIds, ["a-2"]);
  assert.equal(await registry.validateSession({ sid: "a-2", globalUserId: "user-a", revocationVersion: 1, now: 1 }), false);
  assert.equal(await registry.validateSession({ sid: "b-1", globalUserId: "user-b", revocationVersion: 1, now: 1 }), true);
  const expired = await registry.expireSessions(10000);
  assert.deepEqual(expired, ["b-1"]);
  assert.equal(await registry.validateSession({ sid: "b-1", globalUserId: "user-b", revocationVersion: 1, now: 10000 }), false);
});

test("PostgreSQL session validation is one conditional atomic statement with RETURNING", async () => {
  const calls = [];
  const registry = createPgSessionRegistry({
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      return { rows: [{ sid: "session-1" }] };
    }
  });
  assert.equal(await registry.validateSession({ sid: "session-1", globalUserId: "user-1", revocationVersion: 7, now: 1000 }), true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^UPDATE public\.application_session AS aps/);
  assert.match(calls[0].sql, /FROM public\.global_user AS gu/);
  assert.match(calls[0].sql, /aps\.global_user_id = \$2/);
  assert.match(calls[0].sql, /gu\.id = aps\.global_user_id/);
  assert.match(calls[0].sql, /aps\.status = 'ACTIVE'/);
  assert.match(calls[0].sql, /gu\.status = 'ACTIVE'/);
  assert.match(calls[0].sql, /aps\.revocation_version = \$3/);
  assert.match(calls[0].sql, /gu\.session_revocation_version = \$3/);
  assert.match(calls[0].sql, /aps\.expires_at > \$4/);
  assert.match(calls[0].sql, /RETURNING aps\.sid/);
  assert.deepEqual(calls[0].parameters.slice(0, 3), ["session-1", "user-1", 7]);
  assert.deepEqual(calls[0].parameters[3], new Date(1000));
});

function pgRotationHarness(failureStage = null) {
  const events = [];
  const client = {
    async query(sql, parameters) {
      const normalizedSql = sql.trim();
      const stage = normalizedSql.startsWith("INSERT INTO")
        ? "insert"
        : normalizedSql.startsWith("UPDATE public.application_session")
          ? "revoke"
          : normalizedSql;
      events.push({ stage, sql: normalizedSql, parameters });
      if (stage === failureStage) throw new Error(`${stage} failed`);
      return { rows: [] };
    },
    release() {
      events.push({ stage: "release" });
    }
  };
  return {
    events,
    registry: createPgSessionRegistry({
      async connect() {
        events.push({ stage: "connect" });
        return client;
      }
    })
  };
}

const pgRotationInput = {
  previousSid: "sid-before",
  sid: "sid-after",
  globalUserId: "global-user-7",
  revocationVersion: 4,
  expiresAt: Date.parse("2030-01-02T03:04:05.000Z")
};

test("PostgreSQL session rotation commits insert then previous-SID revocation and releases", async () => {
  const { events, registry } = pgRotationHarness();
  await registry.rotateSession(pgRotationInput);

  assert.deepEqual(events.map(event => event.stage), ["connect", "BEGIN", "insert", "revoke", "COMMIT", "release"]);
  assert.deepEqual(events.find(event => event.stage === "insert").parameters, [
    pgRotationInput.sid,
    pgRotationInput.globalUserId,
    pgRotationInput.revocationVersion,
    new Date(pgRotationInput.expiresAt),
    null, null, null
  ]);
  assert.deepEqual(events.find(event => event.stage === "revoke").parameters, [pgRotationInput.previousSid]);
});

test("PostgreSQL session rotation rolls back and releases when new-SID insertion fails", async () => {
  const { events, registry } = pgRotationHarness("insert");
  await assert.rejects(registry.rotateSession(pgRotationInput), /insert failed/);

  assert.deepEqual(events.map(event => event.stage), ["connect", "BEGIN", "insert", "ROLLBACK", "release"]);
  assert.equal(events.some(event => event.stage === "COMMIT"), false);
  assert.deepEqual(events.find(event => event.stage === "insert").parameters, [
    pgRotationInput.sid,
    pgRotationInput.globalUserId,
    pgRotationInput.revocationVersion,
    new Date(pgRotationInput.expiresAt),
    null, null, null
  ]);
});

test("PostgreSQL session rotation rolls back and releases when previous-SID revocation fails", async () => {
  const { events, registry } = pgRotationHarness("revoke");
  await assert.rejects(registry.rotateSession(pgRotationInput), /revoke failed/);

  assert.deepEqual(events.map(event => event.stage), ["connect", "BEGIN", "insert", "revoke", "ROLLBACK", "release"]);
  assert.equal(events.some(event => event.stage === "COMMIT"), false);
  assert.deepEqual(events.find(event => event.stage === "revoke").parameters, [pgRotationInput.previousSid]);
});

test("PostgreSQL session rotation aggregates primary, rollback and discard failures", async () => {
  const primaryError = new Error("insert failed");
  const rollbackError = new Error("rollback failed");
  const releaseError = new Error("release failed");
  const releaseCalls = [];
  const client = {
    async query(sql) {
      if (sql === "BEGIN") return;
      if (sql === "ROLLBACK") throw rollbackError;
      throw primaryError;
    },
    release(error) {
      releaseCalls.push(error);
      throw releaseError;
    }
  };
  const registry = createPgSessionRegistry({ connect: async () => client });
  await assert.rejects(registry.rotateSession(pgRotationInput), error => {
    assert.equal(error instanceof AggregateError, true);
    assert.deepEqual(error.errors, [primaryError, rollbackError, releaseError]);
    assert.equal(error.cause, primaryError);
    return true;
  });
  assert.deepEqual(releaseCalls, [rollbackError]);
});

test("session rotation invalidates the previous registry SID", async () => {
  const registry = new InMemorySessionRegistry();
  await registry.bindSession({ sid: "old", globalUserId: "user-a", revocationVersion: 1, expiresAt: 9999 });
  await registry.rotateSession({ previousSid: "old", sid: "new", globalUserId: "user-a", revocationVersion: 1, expiresAt: 9999 });
  assert.equal(await registry.validateSession({ sid: "old", globalUserId: "user-a", revocationVersion: 1, now: 1 }), false);
  assert.equal(await registry.validateSession({ sid: "new", globalUserId: "user-a", revocationVersion: 1, now: 1 }), true);
});

test("callback compensates the store and returns 503 when registry binding fails", async () => {
  const now = 2_000_000_000_000;
  const req = callbackRequest({ codeVerifier: "v", state: "s", nonce: "n", createdAt: now, returnPath: "/" });
  let destroyed = false;
  req.session.destroy = callback => { destroyed = true; callback(); };
  const res = responseRecorder();
  const controller = createOidcAuthController({
    config: config(), now: () => now,
    oidcClient: { callback: async () => ({ claims: { iss: "https://issuer", sub: "subject", auth_time: now / 1000 } }) },
    identityRepository: { resolve: async () => ({ id: "user-1", platformRoles: [], sessionRevocationVersion: 1 }) },
    sessionRegistry: sessionRegistry({ rotateSession: async () => { throw new Error("registry unavailable"); } })
  });
  await controller.callback(req, res, error => { throw error; });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "SESSION_PERSISTENCE_UNAVAILABLE");
  assert.equal(destroyed, true);
});

test("registry lookup failure returns a stable fail-closed 503", async () => {
  configureAuthentication({ mode: "oidc", policyVersion: "test-v1", sessionRegistry: { validateSession: async () => { throw new Error("unavailable"); } } });
  const req = { sessionID: "sid", session: { auth: { user: { id: "user-1" }, identity: { issuer: "i", subject: "s" }, evidence: { policyVersion: "test-v1" }, policyVersion: "test-v1", absoluteExpiresAt: Date.now() + 60000, revocationVersion: 1 } } };
  const res = responseRecorder();
  let next = false;
  await authenticate(req, res, () => { next = true; });
  assert.equal(next, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "SESSION_VALIDATION_UNAVAILABLE");
});

test("session authentication rejects stale or missing policy versions before registry access", async () => {
  let registryCalled = false;
  configureAuthentication({
    mode: "oidc",
    policyVersion: "current-v2",
    sessionRegistry: { validateSession: async () => { registryCalled = true; return true; } }
  });
  for (const storedVersion of [undefined, "old-v1", "unknown"]) {
    const req = {
      sessionID: "sid",
      session: { auth: {
        user: { id: "user-1" }, identity: { issuer: "i", subject: "s" },
        evidence: { policyVersion: storedVersion }, policyVersion: storedVersion,
        absoluteExpiresAt: Date.now() + 60000, revocationVersion: 1
      } }
    };
    const res = responseRecorder();
    await authenticate(req, res, () => assert.fail("stale policy session must not continue"));
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, "SESSION_POLICY_VERSION_MISMATCH");
  }
  assert.equal(registryCalled, false);
});

test("absolute expiry completes registry and store cleanup before returning 401", async () => {
  let expired = false;
  let destroyed = false;
  configureAuthentication({ mode: "oidc", policyVersion: "test-v1", sessionRegistry: { expireSession: async sid => { expired = sid === "sid"; } } });
  const req = {
    sessionID: "sid",
    session: {
      auth: { user: { id: "user-1" }, identity: { issuer: "i", subject: "s" }, evidence: { policyVersion: "test-v1" }, policyVersion: "test-v1", absoluteExpiresAt: 1, revocationVersion: 1 },
      destroy(callback) { destroyed = true; callback(); }
    }
  };
  const res = responseRecorder();
  await authenticate(req, res, () => assert.fail("expired session must not continue"));
  assert.equal(expired, true);
  assert.equal(destroyed, true);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "SESSION_EXPIRED");
});

test("absolute expiry fails closed and requests reconciliation for registry or store failure", async () => {
  for (const failingDependency of ["registry", "store"]) {
    configureAuthentication({
      mode: "oidc",
      policyVersion: "test-v1",
      sessionRegistry: { expireSession: async () => { if (failingDependency === "registry") throw new Error("unavailable"); } }
    });
    const req = {
      sessionID: "sid",
      session: {
        auth: { user: { id: "user-1" }, identity: { issuer: "i", subject: "s" }, evidence: { policyVersion: "test-v1" }, policyVersion: "test-v1", absoluteExpiresAt: 1, revocationVersion: 1 },
        destroy(callback) { callback(failingDependency === "store" ? new Error("unavailable") : undefined); }
      }
    };
    const res = responseRecorder();
    await authenticate(req, res, () => assert.fail("incomplete expiry must not continue"));
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "SESSION_EXPIRY_INCOMPLETE");
  }
});

test("central identity is separate and the F2 rollback cannot delete identity or privileges", () => {
  const root = path.resolve(__dirname, "../../database/central/migrations");
  const identity = fs.readFileSync(path.join(root, "000_central_identity_baseline.up.sql"), "utf8");
  const identityDown = fs.readFileSync(path.join(root, "000_central_identity_baseline.down.sql"), "utf8");
  const up = fs.readFileSync(path.join(root, "001_f2_oidc_sessions.up.sql"), "utf8");
  const down = fs.readFileSync(path.join(root, "001_f2_oidc_sessions.down.sql"), "utf8");
  assert.match(up, /to_regclass\('public\.c4g_database_identity'\)/);
  assert.match(up, /database_role\s*=\s*\$2/);
  assert.match(identity, /CREATE TABLE public\.global_user\s*\(/);
  assert.match(identity, /CREATE TABLE public\.auth_identity_ref\s*\(/);
  assert.match(identity, /CREATE TABLE public\.platform_admin_assignment\s*\(/);
  assert.match(up, /CREATE TABLE public\.application_session\s*\(/);
  assert.match(up, /CREATE TABLE public\.oidc_transaction\s*\(/);
  assert.match(up, /oidc_transaction_state_uidx/);
  assert.match(up, /global_user_id UUID NOT NULL/);
  assert.match(up, /revocation_version BIGINT NOT NULL/);
  assert.match(up, /application_session_global_user_status_version_idx/);
  assert.doesNotMatch(up, /IF NOT EXISTS/i);
  assert.doesNotMatch(up, /CREATE TABLE public\.(?:global_user|auth_identity_ref|platform_admin_assignment)/);
  assert.match(down, /DROP TABLE public\.application_session;/);
  assert.match(down, /DROP TABLE public\.oidc_transaction;/);
  assert.doesNotMatch(down, /(?:DROP|TRUNCATE|DELETE\s+FROM)[\s\S]*(?:global_user|auth_identity_ref|platform_admin_assignment)/i);
  assert.doesNotMatch(identityDown, /(?:DROP|TRUNCATE|DELETE\s+FROM)\s+public\.(?:global_user|auth_identity_ref|platform_admin_assignment)/i);
  assert.match(identityDown, /RAISE EXCEPTION[\s\S]*irreversible/i);
  assert.equal(fs.existsSync(path.resolve(__dirname, "../../database/migrations_v24_f2_oidc_sessions.sql")), false);
});

test("logout always clears the cookie and reports persistent revocation failure", async () => {
  const req = callbackRequest({});
  req.session.auth = { user: { id: "user-1" } };
  req.session.destroy = callback => callback(new Error("store unavailable"));
  const res = responseRecorder();
  let cleared = false;
  res.clearCookie = () => { cleared = true; return res; };
  const events = [];
  let identityLogoutAttempted = false;
  const controller = createOidcAuthController({
    config: config(), oidcClient: { endSessionUrl: async () => { identityLogoutAttempted = true; return "https://id.example/logout"; } }, identityRepository: {},
    sessionRegistry: sessionRegistry({ revokeSession: async () => { throw new Error("metadata unavailable"); } }),
    audit: (event, details) => events.push({ event, details })
  });
  await controller.logout(req, res, error => { throw error; });
  assert.equal(cleared, true);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "LOGOUT_INCOMPLETE");
  assert.equal(res.body.redirectUrl, "https://id.example/logout");
  assert.equal(res.body.retryRequired, true);
  assert.equal(identityLogoutAttempted, true);
  assert.equal(events[0].event, "authentication.logout_reconciliation_required");
  assert.deepEqual(events[0].details.failures, ["SESSION_METADATA_REVOCATION_FAILED", "SESSION_STORE_DESTROY_FAILED"]);
});

test("logout clears the cookie and attempts reconciliation without authenticated session state", async () => {
  let cleared = false;
  let revoked = false;
  let destroyed = false;
  const req = {
    sessionID: "stale-session",
    session: { destroy(callback) { destroyed = true; callback(); } }
  };
  const res = responseRecorder();
  res.clearCookie = () => { cleared = true; return res; };
  const controller = createOidcAuthController({
    config: config(),
    oidcClient: { endSessionUrl: async () => "https://id.example/logout" },
    identityRepository: {},
    sessionRegistry: sessionRegistry({ revokeSession: async sid => { revoked = sid === "stale-session"; } })
  });
  await controller.logout(req, res, error => { throw error; });
  assert.equal(cleared, true);
  assert.equal(revoked, true);
  assert.equal(destroyed, true);
  assert.equal(res.statusCode, 200);
});

test("logout with a session-store read failure still requires Origin and session-bound CSRF", async t => {
  class ToggleStore extends session.Store {
    constructor() { super(); this.memory = new session.MemoryStore(); this.failReads = false; }
    get(sid, callback) { this.failReads ? callback(new Error("sensitive store detail")) : this.memory.get(sid, callback); }
    set(sid, value, callback) { this.memory.set(sid, value, callback); }
    destroy(sid, callback) { this.memory.destroy(sid, callback); }
  }
  const store = new ToggleStore();
  const security = createSessionSecurity({
    config: {
      oidcEnabled: true, mode: "oidc", sessionCookieName: "__Host-c4g_session", sessionSecret: "synthetic-secret-at-least-32-characters",
      secureCookie: true, sessionIdleMs: 60000, publicOrigin: new URL("https://app.example.test"),
      allowedDevelopmentOrigins: [], nodeEnv: "production"
    },
    pool: {}, sessionStore: store
  });
  let revoked = 0;
  let federated = 0;
  const controller = createOidcAuthController({
    config: config({ secureCookie: true }), identityRepository: {},
    oidcClient: { endSessionUrl: async () => { federated += 1; return "https://id.example/logout"; } },
    sessionRegistry: sessionRegistry({ revokeSession: async () => { revoked += 1; } })
  });
  const app = express();
  app.set("trust proxy", 1);
  app.use(security.sessionMiddleware);
  app.use(security.originProtection);
  app.use(security.csrfProtection);
  app.get("/seed", (req, res) => res.json({ csrfToken: security.generateCsrfToken(req) }));
  app.get("/api/auth/csrf", (req, res) => res.json({ csrfToken: security.generateCsrfToken(req) }));
  app.post("/api/auth/logout", controller.logout);
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: "Request rejected." }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const seeded = await fetch(`${base}/seed`, { headers: { "x-forwarded-proto": "https" } });
  const cookie = seeded.headers.get("set-cookie");
  const originalToken = (await seeded.json()).csrfToken;
  store.failReads = true;
  const recovery = await fetch(`${base}/api/auth/csrf`, { headers: { cookie, "x-forwarded-proto": "https" } });
  assert.equal(recovery.status, 200);
  const recoveryToken = (await recovery.json()).csrfToken;
  assert.equal(recoveryToken, originalToken);

  for (const headers of [
    { cookie, origin: "https://evil.example", "x-csrf-token": recoveryToken, "x-forwarded-proto": "https" },
    { cookie, origin: "https://app.example.test", "x-forwarded-proto": "https" },
    { cookie, origin: "https://app.example.test", "x-csrf-token": `${recoveryToken}invalid`, "x-forwarded-proto": "https" }
  ]) {
    const rejected = await fetch(`${base}/api/auth/logout`, { method: "POST", headers });
    assert.equal(rejected.status, 403);
    assert.doesNotMatch(await rejected.text(), /sensitive store detail/);
    assert.equal(revoked, 0);
    assert.equal(federated, 0);
  }

  const logout = await fetch(`${base}/api/auth/logout`, {
    method: "POST",
    headers: { cookie, origin: "https://app.example.test", "x-csrf-token": recoveryToken, "x-forwarded-proto": "https" }
  });
  assert.equal(logout.status, 503);
  const body = await logout.json();
  assert.equal(body.code, "LOGOUT_INCOMPLETE");
  assert.equal(body.retryRequired, true);
  assert.equal(revoked, 1);
  assert.equal(federated, 1);
  assert.match(logout.headers.get("set-cookie"), /__Host-c4g_session=;/);
});

test("OIDC configuration is mandatory and validates exact redirect origin", () => {
  assert.throws(() => loadAuthConfig({}), /PUBLIC_APP_URL/);
  assert.throws(() => loadAuthConfig({ AUTH_MODE: "disabled" }), /AUTH_MODE/);
  assert.throws(() => loadAuthConfig({
    AUTH_MODE: "oidc", PUBLIC_APP_URL: "https://app.example.test", OIDC_ISSUER: "https://id.example.test/realms/c4g",
    OIDC_REDIRECT_URI: "https://other.example.test/api/auth/oidc/callback", OIDC_CLIENT_ID: "client", SESSION_SECRET: "synthetic-secret-at-least-32-characters"
  }), /public application origin/);
});

test("OIDC startup requires a versioned valid assurance policy and HTTPS public production URL", () => {
  const base = {
    AUTH_MODE: "oidc",
    PUBLIC_APP_URL: "https://app.example.test",
    OIDC_ISSUER: "https://id.example.test/realms/c4g",
    OIDC_REDIRECT_URI: "https://app.example.test/api/auth/oidc/callback",
    OIDC_CLIENT_ID: "client",
    SESSION_SECRET: require('node:crypto').randomBytes(32).toString('hex'),
    SESSION_IDLE_MS: "1800000",
    SESSION_ABSOLUTE_MS: "28800000",
    OIDC_TRANSACTION_MS: "600000",
    AUTH_POLICY_VERSION: "c4g-assurance-v1",
    AUTH_ASSURANCE_POLICY_JSON: JSON.stringify({
      "recent-mfa": { mfa: true, maxAgeSeconds: 300, acceptedAcr: ["c4g-loa2"], acceptedAmr: ["otp"], amrMode: "all" }
    })
  };
  assert.equal(loadAuthConfig(base).policyVersion, "c4g-assurance-v1");
  assert.equal(loadAuthConfig({ ...base, NODE_ENV: 'production' }).sessionSecret, base.SESSION_SECRET);
  for (const secret of ['short', 'x'.repeat(64), 'ab'.repeat(31), 'g0'.repeat(32)]) {
    assert.throws(() => loadAuthConfig({ ...base, NODE_ENV: 'production', SESSION_SECRET: secret }), /SESSION_SECRET/);
  }
  assert.deepEqual(loadAuthConfig(base).acrLoaMap, { "c4g-loa1": 1, "c4g-loa2": 2 });
  assert.throws(() => loadAuthConfig({ ...base, AUTH_POLICY_VERSION: "" }), /required/);
  assert.throws(() => loadAuthConfig({ ...base, AUTH_POLICY_VERSION: "unknown-v1" }), /not recognized/);
  assert.throws(() => loadAuthConfig({ ...base, AUTH_ASSURANCE_POLICY_JSON: "" }), /required/);
  assert.throws(() => loadAuthConfig({
    ...base,
    AUTH_ASSURANCE_POLICY_JSON: JSON.stringify({
      "recent-mfa": { mfa: true, maxAgeSeconds: 300, acceptedAcr: ["c4g-loa1"], acceptedAmr: ["pwd"], amrMode: "all" }
    })
  }), /diverges from the recognized policy version/);
  assert.throws(() => loadAuthConfig({ ...base, PRIVILEGED_LOGIN_ASSURANCE_CATEGORY: "unknown" }), /configured category/);
  for (const name of ["SESSION_IDLE_MS", "SESSION_ABSOLUTE_MS", "OIDC_TRANSACTION_MS"]) {
    assert.throws(() => loadAuthConfig({ ...base, [name]: "" }), new RegExp(name));
    assert.throws(() => loadAuthConfig({ ...base, [name]: "invalid" }), new RegExp(name));
    assert.throws(() => loadAuthConfig({ ...base, [name]: "0" }), new RegExp(name));
  }
  assert.throws(() => loadAuthConfig({ ...base, OIDC_POST_LOGOUT_REDIRECT_URI: "https://other.example.test/logout" }), /OIDC_POST_LOGOUT_REDIRECT_URI/);
  assert.throws(() => loadAuthConfig({ ...base, NODE_ENV: "production", PUBLIC_APP_URL: "http://app.example.test", OIDC_REDIRECT_URI: "http://app.example.test/api/auth/oidc/callback" }), /HTTPS/);
});
