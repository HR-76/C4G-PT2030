const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { selectAuthRoutes, createProductionComposition } = require('../src/productionComposition');

function oidcEnvironment() {
  return {
    AUTH_MODE: 'oidc', NODE_ENV: 'production',
    PUBLIC_APP_URL: 'https://app.example.test',
    OIDC_ISSUER: 'https://id.example.test/realms/c4g',
    OIDC_REDIRECT_URI: 'https://app.example.test/api/auth/oidc/callback',
    OIDC_CLIENT_ID: 'client',
    SESSION_SECRET: require('node:crypto').randomBytes(32).toString('hex'),
    AUTHORITY_COMMIT_PERMIT_SECRET: require('node:crypto').randomBytes(32).toString('hex'),
    SESSION_IDLE_MS: '1800000', SESSION_ABSOLUTE_MS: '28800000', OIDC_TRANSACTION_MS: '600000',
    AUTH_POLICY_VERSION: 'c4g-assurance-v1',
    AUTH_ASSURANCE_POLICY_JSON: JSON.stringify({
      'recent-mfa': { mfa: true, maxAgeSeconds: 300, acceptedAcr: ['c4g-loa2'], acceptedAmr: ['otp'], amrMode: 'all' }
    })
  };
}

test('OIDC is the only selectable authentication route', () => {
  const oidc = {};
  assert.deepEqual(selectAuthRoutes('oidc', {}, oidc), { oidcAuth: oidc });
  for (const mode of ['disabled', 'transition', 'password']) {
    assert.throws(() => selectAuthRoutes(mode, {}, oidc), /requires OIDC/);
  }
});

test('production refuses reuse of the Central pool for authority', () => {
  const pool = {};
  assert.throws(() => createProductionComposition({
    dependencies: { express() {}, cors() {}, centralPool: pool, authorityPool: pool, routes: {} },
    env: oidcEnvironment()
  }), /Separate authority pool required/);
});

test('production and server contain no alternate application runtime or background bootstrap', () => {
  const root = path.resolve(__dirname, '../src');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const composition = fs.readFileSync(path.join(root, 'productionComposition.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const source of [app, composition]) {
    assert.doesNotMatch(source, /\.listen\s*\(/);
    assert.doesNotMatch(source, /cron\.schedule|runLegacyBootstrap|runRequiredLegacyBootstrap/);
  }
  assert.match(server, /\.listen\s*\(/);
  assert.doesNotMatch(server, /setInterval|cron\.schedule|runLegacyBootstrap|runRequiredLegacyBootstrap/);
  assert.doesNotMatch(composition, /OPPORTUNITIES_RUNTIME|legacyPool|routes\/authRoutes/);
});

test('document runtime accepts only its closed selector', () => {
  const pool = {};
  const dependencies = { express() {}, cors() {}, centralPool: pool, authorityPool: {}, routes: {} };
  assert.throws(() => createProductionComposition({
    dependencies, env: { ...oidcEnvironment(), DOCUMENTS_RUNTIME: 'invalid' }
  }), /Document runtime selection/);
});
