const assert = require("node:assert/strict");
const test = require("node:test");
const { OidcClient } = require("../../src/security/oidcClient");

async function fixture() {
  const library = await import("openid-client");
  const issuer = "https://identity.example.test";
  const clientId = "c4g-locale-test";
  const configuration = new library.Configuration({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    end_session_endpoint: `${issuer}/logout`,
    jwks_uri: `${issuer}/jwks`
  }, clientId);
  const settings = {
    clientId,
    redirectUri: new URL("https://app.example.test/api/auth/oidc/callback"),
    postLogoutRedirectUri: new URL("https://app.example.test/login"),
    emailVerification: true
  };
  return { library, settings, adapter: new OidcClient(settings, { library, configuration }) };
}

for (const [name, input] of [
  ["normal login", { returnPath: "/oportunidades" }],
  ["recent authentication", { stepUp: true, maxAge: 300, acrValues: ["c4g-loa1", "c4g-loa2"], returnPath: "/conta/seguranca" }],
  ["enable email verification", { accountAction: "enable", returnPath: "/conta/seguranca" }],
  ["disable email verification", { accountAction: "disable", returnPath: "/conta/seguranca" }]
]) {
  test(`OIDC requests European Portuguese for ${name} while preserving security parameters`, async () => {
    const { adapter, library, settings } = await fixture();
    const { redirectUrl, transaction } = await adapter.begin(input);
    const url = new URL(redirectUrl);
    const parameters = url.searchParams;
    assert.equal(parameters.get("ui_locales"), "pt-PT pt");
    assert.equal(url.origin, "https://identity.example.test");
    assert.equal(parameters.get("client_id"), settings.clientId);
    assert.equal(parameters.get("redirect_uri"), settings.redirectUri.href);
    assert.equal(parameters.get("response_type"), "code");
    assert.equal(parameters.get("scope"), "openid profile email");
    assert.equal(parameters.get("code_challenge_method"), "S256");
    assert.equal(parameters.get("code_challenge"), await library.calculatePKCECodeChallenge(transaction.codeVerifier));
    assert.equal(parameters.get("state"), transaction.state);
    assert.equal(parameters.get("nonce"), transaction.nonce);
    assert.ok(transaction.state);
    assert.ok(transaction.nonce);
    assert.equal(transaction.returnPath, input.returnPath);
    assert.equal(parameters.get("prompt"), input.stepUp ? "login" : null);
    assert.equal(parameters.get("max_age"), input.stepUp ? String(input.maxAge) : null);
    assert.equal(parameters.get("acr_values"), input.acrValues?.join(" ") || null);
    assert.equal(parameters.get("kc_action"), input.accountAction ? `c4g-email-${input.accountAction}` : null);
  });
}

test("OIDC logout keeps European Portuguese and the existing redirect", async () => {
  const { adapter, settings } = await fixture();
  const url = new URL(await adapter.endSessionUrl());
  assert.equal(url.origin, "https://identity.example.test");
  assert.equal(url.pathname, "/logout");
  assert.equal(url.searchParams.get("ui_locales"), "pt-PT pt");
  assert.equal(url.searchParams.get("client_id"), settings.clientId);
  assert.equal(url.searchParams.get("post_logout_redirect_uri"), settings.postLogoutRedirectUri.href);
});
