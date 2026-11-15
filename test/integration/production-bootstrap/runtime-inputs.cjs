'use strict';
// Synthetic provider settings: no provider is contacted by the PostgreSQL gate.
const { randomBytes } = require('node:crypto');
function fixture(config) {
  const runtimeConfig = { version: 1, app: { origin: 'https://app.example.invalid', oidcClientId: 'synthetic-web', trustedProxyHops: 1, uiKeyId: 'synthetic-1' },
    identity: { issuer: config.administrator.issuer, adminOrigin: 'http://c4g-production-keycloak:8080', memberClientId: 'synthetic-member-worker',
      manualClientId: 'synthetic-member-manual', existingClientId: 'synthetic-member-existing', bridgeEndpoint: 'http://c4g-activation-bridge:5285/bridge/check', certificate: null },
    email: { activationFrom: 'C4G <activation@example.invalid>', billingFrom: 'C4G <billing@example.invalid>',
      smtp: { host: 'smtp.example.invalid', port: 587, username: 'synthetic-user', from: 'auth@example.invalid', fromDisplayName: 'C4G synthetic' } } };
  const runtimeCredentials = Object.fromEntries(require('../../../backend/scripts/productionBootstrap/runtimeConfiguration').SECRET_KEYS.map(key => [key, randomBytes(32).toString('hex')]));
  return { runtimeConfig, runtimeCredentials };
}
module.exports = { fixture };
