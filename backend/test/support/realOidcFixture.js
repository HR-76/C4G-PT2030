const { generateKeyPair } = require("node:crypto");
const { promisify } = require("node:util");
const { OidcClient } = require("../../src/security/oidcClient");

const generateKeyPairAsync = promisify(generateKeyPair);

async function createSignedOidcAdapter({ issuer, clientId, redirectUri, claims }) {
  const openid = await import("openid-client");
  const jose = await import("jose");
  const signingKey = await generateKeyPairAsync("rsa", { modulusLength: 2048 });
  const publicJwk = await jose.exportJWK(signingKey.publicKey);
  Object.assign(publicJwk, { kid: "f2-local-assurance-key", alg: "RS256", use: "sig" });
  const now = Math.floor(Date.now() / 1000);
  const idToken = await new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: publicJwk.kid, typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(signingKey.privateKey);
  const configuration = new openid.Configuration({
    issuer,
    authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
    token_endpoint: `${issuer}/protocol/openid-connect/token`,
    jwks_uri: `${issuer}/protocol/openid-connect/certs`,
    id_token_signing_alg_values_supported: ["RS256"]
  }, clientId, { token_endpoint_auth_method: "none", redirect_uris: [redirectUri] });
  configuration[openid.customFetch] = async url => {
    if (String(url) === `${issuer}/protocol/openid-connect/token`) {
      return new Response(JSON.stringify({
        access_token: "local-ephemeral-access-token",
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url) === `${issuer}/protocol/openid-connect/certs`) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response("not found", { status: 404 });
  };
  return new OidcClient({
    issuer: new URL(issuer), clientId, redirectUri: new URL(redirectUri)
  }, { library: openid, configuration });
}

module.exports = { createSignedOidcAdapter };
