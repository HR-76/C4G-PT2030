const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "../../..");
const tempRoot = path.join(repoRoot, ".tmp", "f2-integration");
const playwright = require(path.join(tempRoot, "playwright", "node_modules", "playwright-core"));
const { Pool } = require(path.join(repoRoot, "backend", "node_modules", "pg"));
const { loadAuthConfig } = require(path.join(repoRoot, "backend", "src", "security", "authConfig"));
const { createOidcAuthController } = require(path.join(repoRoot, "backend", "src", "controllers", "oidcAuthController"));
const { createIdentityRepository } = require(path.join(repoRoot, "backend", "src", "security", "identityRepository"));
const { createPgSessionRegistry } = require(path.join(repoRoot, "backend", "src", "security", "sessionRegistry"));
const { createSignedOidcAdapter } = require(path.join(repoRoot, "backend", "test", "support", "realOidcFixture"));
const entryUrl = "https://localhost:8443";

function loadEnvironment() {
  const values = {};
  for (const line of fs.readFileSync(path.join(tempRoot, ".env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function browserExecutable() {
  const candidates = [
    path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env['PROGRAMFILES(X86)'] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe")
  ];
  const executable = candidates.find(candidate => candidate && fs.existsSync(candidate));
  if (!executable) throw new Error("Chrome or Edge is required for the F2 gate.");
  return executable;
}

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret) {
  const counter = Math.floor(Date.now() / 30000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(number).padStart(6, "0");
}

async function freshTotp(credentials) {
  let code = totp(credentials.totpSecret);
  while (credentials.lastTotp === code) {
    await new Promise(resolve => setTimeout(resolve, 500));
    code = totp(credentials.totpSecret);
  }
  credentials.lastTotp = code;
  return code;
}

async function completeKeycloak(page, credentials, expectApplication = true, required = {}) {
  const username = page.locator("#username");
  if (required.username) await username.waitFor({ state: "visible", timeout: 10000 });
  if (await username.count()) await username.fill(credentials.username);
  const password = page.locator("#password");
  if (required.password) await password.waitFor({ state: "visible", timeout: 10000 });
  if (await password.count()) await password.fill(credentials.password);
  if (await page.locator("#kc-login").count()) {
    await page.locator("#kc-login").click();
    await Promise.race([
      page.locator("#otp").waitFor({ state: "visible", timeout: 5000 }),
      page.waitForURL(url => url.origin === entryUrl && !url.pathname.startsWith("/api/"), { timeout: 5000 })
    ]).catch(() => {});
  }
  const otp = page.locator("#otp");
  if (required.otp) await otp.waitFor({ state: "visible", timeout: 10000 });
  if (await otp.count()) {
    await otp.fill(await freshTotp(credentials));
    await page.locator("#kc-login").click();
  }
  if (expectApplication) await page.waitForURL(url => url.origin === entryUrl && !url.pathname.startsWith("/api/"), { timeout: 30000 });
}

async function login(context, credentials, required = {}) {
  const page = await context.newPage();
  await page.goto(`${entryUrl}/login`);
  await page.getByRole("button", { name: /Continuar com Keycloak/i }).click();
  await page.waitForURL(url => url.pathname.includes("/protocol/openid-connect/auth"), { timeout: 30000 });
  await completeKeycloak(page, credentials, true, required);
  const session = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session", { credentials: "include" });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(session.status, 200);
  assert.equal(Object.keys(session.body).some(key => /token/i.test(key)), false);
  return { page, user: session.body.user };
}

async function browserFetch(page, url, options = {}) {
  return page.evaluate(async ({ url, options }) => {
    const response = await fetch(url, { ...options, credentials: "include" });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    return { status: response.status, body };
  }, { url, options });
}

function proxyLogs(env) {
  const result = spawnSync("docker", [
    "compose", "--env-file", path.join(tempRoot, ".env"),
    "-f", path.join(__dirname, "compose.yaml"), "logs", "--no-color", "proxy"
  ], { cwd: repoRoot, env: { ...process.env, ...env }, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, "Disposable proxy logs were unavailable");
  return `${result.stdout}\n${result.stderr}`;
}

function controllerResponse() {
  return {
    statusCode: 200,
    body: null,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    redirect(value, location) { this.statusCode = value; this.location = location; return this; }
  };
}

async function rejectSignedAssurance({ central, env, claimOverrides }) {
  if (!env.AUTHORITY_DATABASE_URL || !env.AUTHORITY_COMMIT_PERMIT_SECRET) throw new Error('F2_AUTHORITY_CONFIGURATION_REQUIRED');
  const authority = new Pool({connectionString:env.AUTHORITY_DATABASE_URL});
  try {
  const coordinator = require(path.join(repoRoot,'backend/src/security/authorityCoordinator')).createAuthorityCoordinator({pool:authority,permitSecret:env.AUTHORITY_COMMIT_PERMIT_SECRET});
  const config = loadAuthConfig(env);
  const state = crypto.randomBytes(24).toString("hex");
  const sid = `negative-${crypto.randomBytes(18).toString("hex")}`;
  const nonce = crypto.randomBytes(24).toString("hex");
  const createdAt = Date.now();
  const transaction = {
    codeVerifier: "local-negative-verifier-with-sufficient-length-1234567890",
    state, nonce, createdAt, returnPath: "/", stepUp: false
  };
  const oidcClient = await createSignedOidcAdapter({
    issuer: config.issuer.href.replace(/\/$/, ""),
    clientId: config.clientId,
    redirectUri: config.redirectUri.href,
    claims: {
      sub: "22222222-2222-4222-8222-222222222222",
      nonce,
      auth_time: Math.floor(Date.now() / 1000),
      ...claimOverrides
    }
  });
  const registry = createPgSessionRegistry(central,coordinator);
  await registry.registerOidcTransaction({ sid, state, expiresAt: createdAt + config.oidcTransactionMs });
  const req = {
    sessionID: sid,
    session: { oidcTransaction: transaction },
    query: { state },
    originalUrl: `/api/auth/oidc/callback?code=local-code&state=${state}`
  };
  const res = controllerResponse();
  const controller = createOidcAuthController({
    config, oidcClient, identityRepository: createIdentityRepository(coordinator), sessionRegistry: registry
  });
  await controller.callback(req, res, error => { throw error; });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "MFA_EVIDENCE_INSUFFICIENT");
  assert.equal(req.session.auth, undefined);
  const effects = await central.query(
    `SELECT EXISTS (SELECT 1 FROM public.application_session WHERE sid = $1) AS registry,
            EXISTS (SELECT 1 FROM public.application_session_store WHERE sid = $1) AS store`,
    [sid]
  );
  assert.deepEqual(effects.rows[0], { registry: false, store: false });
  } finally { await authority.end(); }
}

async function assertBrowserHasNoTokenStorage(page) {
  const storage = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage)
  }));
  assert.doesNotMatch(JSON.stringify(storage), /access[_-]?token|refresh[_-]?token|id[_-]?token|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./i);
}

function monitorContext(context, diagnostics) {
  context.on("page", page => {
    page.on("console", message => {
      diagnostics.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", error => diagnostics.push(error.message));
    page.on("requestfailed", request => diagnostics.push(`${request.method()} ${new URL(request.url()).pathname} ${request.failure() && request.failure().errorText}`));
  });
}

function assertNoSensitiveRuntimeArtifacts(env, diagnostics) {
  const files = ["api.stdout.log", "api.stderr.log", "frontend.stdout.log", "frontend.stderr.log"]
    .map(name => path.join(tempRoot, name))
    .filter(file => fs.existsSync(file));
  let evidence = `${diagnostics.join("\n")}\n${files.map(file => fs.readFileSync(file, "utf8")).join("\n")}`;
  const containerLogs = spawnSync("docker", [
    "compose", "--env-file", path.join(tempRoot, ".env"), "-f", path.join(__dirname, "compose.yaml"),
    "logs", "--no-color", "proxy", "keycloak"
  ], { cwd: repoRoot, env: { ...process.env, ...env }, encoding: "utf8", windowsHide: true });
  assert.equal(containerLogs.status, 0, "Disposable logs were not available for sanitization checks");
  evidence += `\n${containerLogs.stdout}\n${containerLogs.stderr}`;
  assert.doesNotMatch(evidence, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
  for (const secretName of [
    "F2_CENTRAL_PASSWORD", "F2_LEGACY_PASSWORD", "F2_KEYCLOAK_ADMIN_PASSWORD",
    "F2_USER_PASSWORD", "F2_ADMIN_PASSWORD", "F2_ADMIN_TOTP_SECRET", "SESSION_SECRET"
  ]) {
    assert.ok(!evidence.includes(env[secretName]), `${secretName} appeared in disposable runtime evidence`);
  }
}

async function beginOidcTransaction(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${entryUrl}/api/auth/oidc/login`);
  const authorization = new URL(page.url());
  assert.ok(authorization.pathname.endsWith("/protocol/openid-connect/auth"));
  const state = authorization.searchParams.get("state");
  assert.ok(state);
  return { context, page, state };
}

function databasePool(env, prefix) {
  return new Pool({
    host: env[`${prefix}_HOST`], port: Number(env[`${prefix}_PORT`]), database: env[`${prefix}_NAME`],
    user: env[`${prefix}_USER`], password: env[`${prefix}_PASSWORD`]
  });
}

async function activeSession(database, userId) {
  const result = await database.query(
    `SELECT aps.sid, aps.status, aps.revocation_reason, store.sid IS NOT NULL AS store_present, store.sess
       FROM public.application_session aps
       LEFT JOIN public.application_session_store store ON store.sid = aps.sid
      WHERE aps.global_user_id = $1 ORDER BY aps.created_at DESC LIMIT 1`,
    [userId]
  );
  return result.rows[0];
}

async function sessionBySid(database, sid) {
  const result = await database.query(
    `SELECT aps.sid, aps.status, aps.revocation_reason, store.sid IS NOT NULL AS store_present, store.sess
       FROM public.application_session aps
       LEFT JOIN public.application_session_store store ON store.sid = aps.sid
      WHERE aps.sid = $1`,
    [sid]
  );
  return result.rows[0];
}

async function run() {
  const env = loadEnvironment();
  const admin = { username: "admin", password: env.F2_ADMIN_PASSWORD, totpSecret: env.F2_ADMIN_TOTP_SECRET };
  const researcher = { username: "researcher", password: env.F2_USER_PASSWORD };
  const browser = await playwright.chromium.launch({ executablePath: browserExecutable(), headless: true });
  const central = databasePool(env, "CENTRAL_DB");
  const legacy = databasePool(env, "DB");
  const completed = [];
  const diagnostics = [];
  const record = async (number, name, operation) => {
    await operation();
    completed.push({ number, name });
    console.log(`PASS ${number}: ${name}`);
  };
  try {
    const primary = await browser.newContext();
    monitorContext(primary, diagnostics);
    let primaryPage;
    let primaryUser;
    let primarySid;
    let firstCallbackUrl;
    await record(1, "login password and TOTP", async () => {
      primary.on("request", request => {
        if (!firstCallbackUrl && request.url().includes("/api/auth/oidc/callback?")) firstCallbackUrl = request.url();
      });
      const result = await login(primary, admin, { username: true, password: true, otp: true });
      primaryPage = result.page;
      primaryUser = result.user;
      assert.equal(primaryUser.email, "admin@example.invalid");
      await assertBrowserHasNoTokenStorage(primaryPage);

      const withoutOtp = await browser.newContext();
      monitorContext(withoutOtp, diagnostics);
      const withoutOtpPage = await withoutOtp.newPage();
      await withoutOtpPage.goto(`${entryUrl}/login`);
      await withoutOtpPage.getByRole("button", { name: /Continuar com Keycloak/i }).click();
      await withoutOtpPage.waitForURL(url => url.pathname.includes("/protocol/openid-connect/auth"), { timeout: 30000 });
      await withoutOtpPage.locator("#username").fill(researcher.username);
      await withoutOtpPage.locator("#password").fill(researcher.password);
      await withoutOtpPage.locator("#kc-login").click();
      await withoutOtpPage.waitForTimeout(1000);
      assert.equal(new URL(withoutOtpPage.url()).origin, entryUrl);
      assert.equal((await browserFetch(withoutOtpPage, "/api/auth/session")).status, 401);
      await withoutOtp.close();
    });

    await record(2, "OIDC claims, state, code replay and PKCE", async () => {
      const stored = await activeSession(central, primaryUser.id);
      assert.equal(stored.sess.auth.evidence.acr, "c4g-loa2");
      assert.ok(stored.sess.auth.evidence.amr.includes("otp"));
      assert.ok(Number.isFinite(stored.sess.auth.evidence.authTime));
      const replay = await primaryPage.goto(firstCallbackUrl);
      assert.equal(replay.status(), 400);
      await primaryPage.goto(entryUrl);
      const stateCase = await beginOidcTransaction(browser);
      const stateResponse = await stateCase.page.goto(`${entryUrl}/api/auth/oidc/callback?code=invalid-code&state=tampered-state`);
      assert.equal(stateResponse.status(), 400);
      await stateCase.page.goto(`${entryUrl}/login`);
      assert.equal((await browserFetch(stateCase.page, "/api/auth/session")).status, 401);
      await stateCase.context.close();

      const codeCase = await beginOidcTransaction(browser);
      const codeResponse = await codeCase.page.goto(`${entryUrl}/api/auth/oidc/callback?code=invalid-code&state=${encodeURIComponent(codeCase.state)}`);
      assert.equal(codeResponse.status(), 400);
      await codeCase.page.goto(`${entryUrl}/login`);
      assert.equal((await browserFetch(codeCase.page, "/api/auth/session")).status, 401);
      await codeCase.context.close();

      const pkceCase = await beginOidcTransaction(browser);
      const corrupted = await central.query(
        `UPDATE public.application_session_store
            SET sess = jsonb_set(sess::jsonb, '{oidcTransaction,codeVerifier}', to_jsonb($1::text), false)::json
          WHERE sid = (SELECT sid FROM public.oidc_transaction WHERE state = $2)`,
        ["invalid-pkce-verifier-with-sufficient-length-1234567890", pkceCase.state]
      );
      assert.equal(corrupted.rowCount, 1);
      let pkceStatus = 0;
      pkceCase.page.on("response", response => {
        if (new URL(response.url()).pathname.startsWith("/api/auth/oidc/callback")) pkceStatus = response.status();
      });
      await completeKeycloak(pkceCase.page, admin, false);
      const pkceDeadline = Date.now() + 15000;
      while (!pkceStatus && Date.now() < pkceDeadline) await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(pkceStatus, 400);
      await pkceCase.page.goto(`${entryUrl}/login`);
      assert.equal((await browserFetch(pkceCase.page, "/api/auth/session")).status, 401);
      await pkceCase.context.close();
    });

    await record(3, "session survives validated API restart", async () => {
      const before = await activeSession(central, primaryUser.id);
      const lifecycle = spawnSync(process.execPath, [path.join(__dirname, "process-lifecycle.js"), "restart-api"], {
        cwd: repoRoot, env: { ...process.env, ...env }, encoding: "utf8", windowsHide: true
      });
      assert.equal(lifecycle.status, 0, "API lifecycle restart failed");
      const session = await browserFetch(primaryPage, "/api/auth/session");
      assert.equal(session.status, 200);
      assert.equal(session.body.user.id, primaryUser.id);
      const after = await activeSession(central, primaryUser.id);
      assert.equal(after.sid, before.sid);
      assert.equal(after.store_present, true);
      primarySid = after.sid;
    });

    const second = await browser.newContext();
    monitorContext(second, diagnostics);
    const secondLogin = await login(second, admin, { username: true, password: true, otp: true });
    const secondSession = await central.query(
      `SELECT sid FROM public.application_session
        WHERE global_user_id = $1 AND status = 'ACTIVE' AND sid <> $2
        ORDER BY created_at DESC LIMIT 1`,
      [primaryUser.id, primarySid]
    );
    assert.equal(secondSession.rows.length, 1);
    const secondSid = secondSession.rows[0].sid;
    await record(4, "CSRF missing, invalid and cross-session have no effects", async () => {
      const before = await sessionBySid(central, primarySid);
      const primaryToken = (await browserFetch(primaryPage, "/api/auth/csrf")).body.csrfToken;
      const otherToken = (await browserFetch(secondLogin.page, "/api/auth/csrf")).body.csrfToken;
      for (const token of [null, `${primaryToken}invalid`, otherToken]) {
        const headers = token ? { "X-CSRF-Token": token } : {};
        const result = await browserFetch(primaryPage, "/api/auth/logout", { method: "POST", headers });
        assert.equal(result.status, 403);
        assert.doesNotMatch(JSON.stringify(result.body), /stack|postgres|query|sensitive/i);
        const after = await sessionBySid(central, primarySid);
        assert.equal(after.sid, before.sid);
        assert.equal(after.status, "ACTIVE");
        assert.equal(after.store_present, true);
        assert.equal(after.revocation_reason, null);
      }
    });

    await record(5, "unauthorized Origin has no effects", async () => {
      const before = await sessionBySid(central, primarySid);
      const originPage = await primary.newPage();
      await originPage.goto("https://localhost:8444/");
      await originPage.evaluate(async target => {
        try { await fetch(target, { credentials: "include" }); } catch { /* CORS intentionally hides the response */ }
      }, `${entryUrl}/api/auth/session?f2_gate=origin-check`);
      await originPage.evaluate(async target => {
        try {
          await fetch(target, { method: "POST", credentials: "include", body: "cross-origin" });
        } catch { /* CORS intentionally hides the rejected response body */ }
      }, `${entryUrl}/api/auth/logout?f2_gate=origin-check`);
      await originPage.waitForTimeout(250);
      const access = proxyLogs(env);
      assert.equal(/gate="origin-check" origin="https:\/\/localhost:8444" GET \/api\/auth\/session 200/.test(access), true,
        "Correlated authenticated cross-origin GET was not observed.");
      assert.equal(/gate="origin-check" origin="https:\/\/localhost:8444" POST \/api\/auth\/logout 403/.test(access), true,
        "Correlated unauthorized Origin rejection was not observed.");
      await originPage.close();
      const after = await sessionBySid(central, primarySid);
      assert.equal(after.sid, before.sid);
      assert.equal(after.status, "ACTIVE");
    });

    await record(6, "ACR-only and AMR-only evidence is rejected", async () => {
      await rejectSignedAssurance({ central, env, claimOverrides: { acr: "c4g-loa2", amr: [] } });
      await rejectSignedAssurance({ central, env, claimOverrides: { amr: ["otp"] } });
    });

    await record(7, "policy version divergence is rejected", async () => {
      const changed = await central.query(
        `UPDATE public.application_session_store
            SET sess = jsonb_set(
              jsonb_set(sess::jsonb, '{auth,policyVersion}', to_jsonb($1::text), false),
              '{auth,evidence,policyVersion}', to_jsonb($1::text), false
            )::json
          WHERE sid = $2`,
        ["divergent-policy-version", secondSid]
      );
      assert.equal(changed.rowCount, 1);
      const rejected = await browserFetch(secondLogin.page, "/api/auth/session");
      assert.equal(rejected.status, 401);
      assert.equal(rejected.body.code, "SESSION_POLICY_VERSION_MISMATCH");
      const registry = await central.query("SELECT status FROM public.application_session WHERE sid = $1", [secondSid]);
      assert.equal(registry.rows[0].status, "ACTIVE");
    });

    let preStepUpSid;
    await record(8, "expired step-up requires password and TOTP", async () => {
      preStepUpSid = primarySid;
      await primaryPage.waitForTimeout(2500);
      await primaryPage.goto(`${entryUrl}/api/auth/step-up?category=recent-mfa&returnTo=/`);
      await primaryPage.waitForURL(url => url.pathname.includes("/protocol/openid-connect/auth"), { timeout: 30000 });
      await completeKeycloak(primaryPage, admin, true, { password: true, otp: true });
    });

    await record(9, "step-up rotates the real SID", async () => {
      const current = await activeSession(central, primaryUser.id);
      assert.notEqual(current.sid, preStepUpSid);
      primarySid = current.sid;
      assert.equal(current.sess.auth.evidence.acr, "c4g-loa2");
      assert.ok(current.sess.auth.evidence.amr.includes("otp"));
      assert.ok(Math.floor(Date.now() / 1000) - current.sess.auth.evidence.authTime <= 2);
      const old = await central.query("SELECT status, revocation_reason FROM public.application_session WHERE sid = $1", [preStepUpSid]);
      assert.deepEqual(old.rows[0], { status: "REVOKED", revocation_reason: "SESSION_ROTATED" });
    });

    await record(10, "normal, federated and degraded logout revoke or fail closed", async () => {
      const degraded = await browser.newContext();
      monitorContext(degraded, diagnostics);
      const degradedLogin = await login(degraded, admin, { username: true, password: true, otp: true });
      const degradedToken = (await browserFetch(degradedLogin.page, "/api/auth/csrf")).body.csrfToken;
      await central.query("ALTER TABLE public.application_session RENAME TO application_session_unavailable");
      await central.query("ALTER TABLE public.application_session_store RENAME TO application_session_store_unavailable");
      let incomplete;
      try {
        incomplete = await browserFetch(degradedLogin.page, "/api/auth/logout", {
          method: "POST", headers: { "X-CSRF-Token": degradedToken }
        });
      } finally {
        await central.query("ALTER TABLE public.application_session_unavailable RENAME TO application_session");
        await central.query("ALTER TABLE public.application_session_store_unavailable RENAME TO application_session_store");
      }
      assert.equal(incomplete.status, 503);
      assert.equal(incomplete.body.code, "LOGOUT_INCOMPLETE");
      assert.equal(incomplete.body.retryRequired, true);
      assert.ok(new URL(incomplete.body.redirectUrl).pathname.includes("/protocol/openid-connect/logout"));
      assert.equal((await browserFetch(degradedLogin.page, "/api/auth/session")).status, 401);
      await degraded.close();

      const current = await sessionBySid(central, primarySid);
      const token = (await browserFetch(primaryPage, "/api/auth/csrf")).body.csrfToken;
      const logout = await browserFetch(primaryPage, "/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": token } });
      assert.equal(logout.status, 200);
      assert.ok(new URL(logout.body.redirectUrl).pathname.includes("/protocol/openid-connect/logout"));
      const reused = await browserFetch(primaryPage, "/api/auth/session");
      assert.equal(reused.status, 401);
      const revoked = await central.query("SELECT status, revocation_reason FROM public.application_session WHERE sid = $1", [current.sid]);
      assert.deepEqual(revoked.rows[0], { status: "REVOKED", revocation_reason: "LOCAL_LOGOUT" });
      const stored = await central.query("SELECT 1 FROM public.application_session_store WHERE sid = $1", [current.sid]);
      assert.equal(stored.rows.length, 0);
      await primaryPage.goto(logout.body.redirectUrl);
      const confirm = primaryPage.locator("#kc-logout");
      if (await confirm.count()) await confirm.click();
      await primaryPage.waitForURL(url => url.origin === entryUrl && url.pathname === "/login", { timeout: 30000 });
      await primaryPage.getByRole("button", { name: /Continuar com Keycloak/i }).click();
      await primaryPage.waitForURL(url => url.pathname.includes("/protocol/openid-connect/auth"), { timeout: 30000 });
      await primaryPage.locator("#username").waitFor({ state: "visible", timeout: 10000 });
    });

    const centralIdentity = await central.query("SELECT (pg_catalog.pg_control_system()).system_identifier::text AS system_identifier, inet_server_addr()::text AS address, inet_server_port() AS port");
    const legacyIdentity = await legacy.query("SELECT (pg_catalog.pg_control_system()).system_identifier::text AS system_identifier, inet_server_addr()::text AS address, inet_server_port() AS port");
    assert.notDeepEqual(centralIdentity.rows[0], legacyIdentity.rows[0]);
    assert.notEqual(centralIdentity.rows[0].system_identifier, legacyIdentity.rows[0].system_identifier);
    const legacyCentralTables = await legacy.query("SELECT to_regclass('public.global_user') AS identity, to_regclass('public.application_session') AS sessions");
    assert.deepEqual(legacyCentralTables.rows[0], { identity: null, sessions: null });
    assert.equal(completed.length, 10);
    await assertBrowserHasNoTokenStorage(primaryPage);
    assertNoSensitiveRuntimeArtifacts(env, diagnostics);
    await second.close();
    await primary.close();
  } finally {
    await Promise.allSettled([central.end(), legacy.end(), browser.close()]);
  }
}

run().catch(error => {
  console.error(`F2 gate stopped: ${error.name}: ${String(error.message).replace(/https?:\/\/[^\s]+/g, "[url]")}`);
  process.exitCode = 1;
});
