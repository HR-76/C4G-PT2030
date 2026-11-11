'use strict';
const { randomBytes } = require('node:crypto');
const { localizationSettings } = require('./identityLocalization');
const policyVersion = 'c4g-user-mfa-v1';

// Administration is used by the explicit local installer only, never by the API.
async function identityAdmin(config) {
  const response = await fetch('http://127.0.0.1:8080/realms/master/protocol/openid-connect/token', {
    method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli',
      username: 'f2-admin', password: config.F2_KEYCLOAK_ADMIN_PASSWORD }) });
  if (!response.ok) throw Error('LOCAL_IDP_ADMIN_UNAVAILABLE');
  const token = (await response.json()).access_token;
  return async (route, method = 'GET', body, allowMissing = false) => {
    const result = await fetch('http://127.0.0.1:8080/admin/realms/' + route, {
      method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (allowMissing && result.status === 404) return null;
    if (!result.ok) throw Error('LOCAL_IDP_CONFIGURATION_FAILED_' + result.status);
    if (result.status === 201) return result.headers.get('location')?.split('/').at(-1) || null;
    return result.status === 204 ? null : result.json();
  };
}

async function configureOptionalIdentity(config, state, persist, {
  clientId = 'c4g-native-local', username = 'hugo', origin = 'http://localhost:3000'
} = {}) {
  if (!/^c4g-native-[a-z0-9-]+$/.test(clientId) || new URL(origin).origin !== origin
      || new URL(origin).hostname !== 'localhost' || new URL(origin).protocol !== 'http:') {
    throw Error('LOCAL_IDENTITY_TARGET_INVALID');
  }
  const realmName = clientId, admin = await identityAdmin(config);
  let realm = await admin(realmName, 'GET', undefined, true);
  if (realm && realm.attributes?.['c4g.local.installation'] !== state.installationId) throw Error('LOCAL_REALM_ALREADY_OWNED');
  if (!realm) {
    await admin('', 'POST', { realm: realmName, enabled: true, displayName: 'C4G', loginTheme: 'c4g', accountTheme: 'c4g',
      ...localizationSettings,
      sslRequired: 'external', registrationAllowed: false, resetPasswordAllowed: false,
      loginWithEmailAllowed: false, editUsernameAllowed: false,
      bruteForceProtected: true, passwordPolicy: 'length(12)',
      attributes: { 'c4g.local.installation': state.installationId, 'acr.loa.map': JSON.stringify({ 'c4g-loa1': 1, 'c4g-loa2': 2 }) } });
    realm = await admin(realmName);
  }
  const kc = (route, method, body) => admin(realmName + '/' + route, method, body);
  const profile = await kc('users/profile');
  if (!profile.attributes.some(item => item.name === 'c4g.local.installation')) {
    await kc('users/profile', 'PUT', { ...profile, attributes: [...profile.attributes,
      { name: 'c4g.local.installation', displayName: 'Installation', multivalued: false,
        permissions: { view: ['admin'], edit: ['admin'] } }] });
  }
  const flowId = await require('./identityFlow').configureOptionalFlow(kc, state, clientId);
  const flow = (await kc('authentication/flows')).find(item => item.id === flowId);
  if (realm.browserFlow !== flow.alias) await admin(realmName, 'PUT', { ...realm, browserFlow: flow.alias });
  // Use the same conditional flow in the account console and the application.
  const clients = await kc('clients?clientId=' + clientId);
  if (!clients.length) {
    await kc('clients', 'POST', { clientId, name: 'C4G', enabled: true, publicClient: true, protocol: 'openid-connect',
      standardFlowEnabled: true, directAccessGrantsEnabled: false,
      rootUrl: origin, baseUrl: origin + '/conta/seguranca', redirectUris: [origin + '/api/auth/oidc/callback'], webOrigins: [origin],
      attributes: { 'c4g.local.installation': state.installationId, 'post.logout.redirect.uris': origin + '/login',
        'access.token.lifespan': '1800',
        'pkce.code.challenge.method': 'S256', 'default.acr.values': 'c4g-loa1', 'minimum.acr.value': 'c4g-loa1' },
      authenticationFlowBindingOverrides: { browser: flowId },
      protocolMappers: [{ name: 'c4g-amr', protocol: 'openid-connect', protocolMapper: 'oidc-amr-mapper',
        config: { 'id.token.claim': 'true', 'access.token.claim': 'true', 'lightweight.claim': 'false' } }] });
  } else if (clients.length !== 1 || clients[0].attributes?.['c4g.local.installation'] !== state.installationId
      || clients[0].authenticationFlowBindingOverrides?.browser !== flowId) {
    throw Error('LOCAL_OIDC_CLIENT_CONFIGURATION_DRIFT');
  }
  if (clients.length === 1 && clients[0].attributes?.['access.token.lifespan'] !== '1800') {
    await kc('clients/' + clients[0].id, 'PUT', { ...clients[0],
      attributes: { ...clients[0].attributes, 'access.token.lifespan': '1800' } });
  }
  if (!state.optionalAccounts) {
    state.optionalAccounts = {
      admin: { username: 'admin', password: config.F2_ADMIN_PASSWORD },
      hugo: { username, password: state.managerAccess?.password || randomBytes(24).toString('hex') }
    };
    await persist(state);
  }
  if (state.optionalAccounts.hugo.username !== username) throw Error('LOCAL_IDENTITY_STATE_MISMATCH');
  const subjects = {};
  for (const [key, account] of Object.entries(state.optionalAccounts)) {
    let users = await kc('users?username=' + encodeURIComponent(account.username) + '&exact=true');
    if (!users.length) {
      await kc('users', 'POST', { username: account.username, enabled: true,
        email: account.username + '@c4g.local.invalid', emailVerified: true,
        firstName: key === 'admin' ? 'Administrador' : 'Hugo', lastName: 'C4G',
        attributes: { 'c4g.local.installation': [state.installationId] }, requiredActions: [],
        credentials: [{ type: 'password', value: account.password, temporary: false }] });
      users = await kc('users?username=' + encodeURIComponent(account.username) + '&exact=true');
    }
    if (users.length !== 1 || users[0].attributes?.['c4g.local.installation']?.[0] !== state.installationId) {
      throw Error('LOCAL_ACCOUNT_ALREADY_OWNED');
    }
    // Never replace credentials or required actions on an existing account.
    subjects[key] = users[0].id;
  }
  if (state.identity && state.identity.policyVersion !== policyVersion) {
    state.identityHistory ||= [];
    state.identityHistory.push(state.identity);
  }
  state.identity = { issuer: 'https://localhost:8443/realms/' + realmName, realm: realmName,
    clientId, origin, policyVersion, adminSubject: subjects.admin, managerSubject: subjects.hugo };
  await persist(state);
  return structuredClone(state.optionalAccounts);
}
module.exports = { identityAdmin, configureOptionalIdentity, policyVersion };
