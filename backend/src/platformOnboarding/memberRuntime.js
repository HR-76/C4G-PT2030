'use strict';
// Member invitations for an API started by src/server.js (staging), outside the local installer.
// Contract: context/features/staging-member-invitations.md. Identity and email credentials stay in the IPC worker;
// this process only holds the bridge secret and the public client identifiers.
const fs = require('node:fs');
const path = require('node:path');

const ACTIVATION_PATH = '/api/activation';
const BRIDGE_PORT = 5285;

function invalid(code) {
  return Object.assign(new TypeError(code), { code });
}

function readSettings(directory, env) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw invalid('MEMBER_ONBOARDING_DIRECTORY_INVALID');
  let settings;
  try { settings = JSON.parse(fs.readFileSync(path.join(directory, 'http.json'), 'utf8')); } catch { throw invalid('MEMBER_CONFIGURATION_INVALID'); }
  const text = value => typeof value === 'string' && value.length > 0;
  // The Keycloak module only sends a 64-character lowercase hexadecimal secret.
  if (!/^[a-f0-9]{64}$/.test(settings?.bridgeSecret || '')) throw invalid('ACTIVATION_BRIDGE_SECRET_INVALID');
  if (!text(settings.issuer) || settings.issuer !== env.OIDC_ISSUER || !settings.issuer.startsWith('https://')
    || !text(settings.origin) || settings.origin !== env.PUBLIC_APP_URL
    || !text(settings.manualClientId) || !text(settings.existingClientId) || !text(settings.dataResidencyCode)) throw invalid('MEMBER_CONFIGURATION_INVALID');
  return settings;
}

function bridgePort(env) {
  if (env.MEMBER_ACTIVATION_BRIDGE_PORT === undefined) return BRIDGE_PORT;
  const port = Number(env.MEMBER_ACTIVATION_BRIDGE_PORT);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw invalid('MEMBER_ACTIVATION_BRIDGE_PORT_INVALID');
  return port;
}

// Returns null when the runtime is not selected. Otherwise: createMemberOnboarding for the production composition,
// start() once the composition exists (OIDC discovery, activation pages and the bridge listener) and close().
function configuredMemberOnboarding({ env, express, trustProxy = 1,
  createWorker = file => require('./memberWorkerClient').createMemberWorkerClient(file),
  createService = options => require('./memberService').createMemberOnboardingService(options),
  createOidc = options => require('./oidcActivationAdapter').createOidcActivationAdapter(options) }) {
  const selection = env.MEMBER_ONBOARDING_RUNTIME || 'disabled';
  if (selection === 'disabled') return null;
  if (selection !== 'central') throw invalid('MEMBER_ONBOARDING_RUNTIME_INVALID');
  const directory = env.MEMBER_ONBOARDING_DIRECTORY;
  if(!['disabled','central'].includes(env.USER_DELETION_RUNTIME||'disabled'))throw invalid('USER_DELETION_RUNTIME_INVALID');
  const settings = readSettings(directory, env);
  const port = bridgePort(env);
  const worker = createWorker(path.join(directory, 'worker.json'));
  let service = null, deletionService=null, oidc = null, bridgeServer = null, started = null;

  function createMemberOnboarding({ authorityCoordinator, authConfig, prepareEmail, deliveryHistory }) {
    service = createService({ coordinator: authorityCoordinator, issuer: settings.issuer, policyVersion: authConfig.policyVersion,
      assuranceRequirements: authConfig.assurancePolicy[authConfig.privilegedLoginCategory], mfaPolicyCode: 'USER_OPTIONAL',
      dataResidencyCode: settings.dataResidencyCode,
      identity: { ensure: value => worker.call('identity', value) },
      projection: { ensure: value => worker.call('projection', value) },
      // The adapter needs the service, so it only exists after start(); activation cannot be reached before that.
      verification: { verify: value => { if (!oidc) throw invalid('ACTIVATION_INVALID'); return oidc.verify(value); } },
      prepareEmail, deliveryHistory,
      email: { secret: value => worker.call('activationSecret', value), send: value => worker.call('activationEmail', value), test: value => worker.call('testInvitationEmail', value) } });
    return service;
  }

  function start() {
    return started ||= (async () => {
      if (!service) throw invalid('MEMBER_ONBOARDING_NOT_COMPOSED');
      if(env.USER_DELETION_RUNTIME==='central'){
        if(!deletionService)throw invalid('DELETION_NOT_CONFIGURED');
        await deletionService.ready();
        if((await worker.call('deletionReady',{}))?.ready!==true)throw invalid('DELETION_NOT_CONFIGURED');
      }
      oidc = await createOidc({ issuer: settings.issuer, origin: settings.origin, manualClientId: settings.manualClientId,
        existingClientId: settings.existingClientId, callbackPath: ACTIVATION_PATH + '/callback', service,
        passwordReady: subject => worker.call('passwordReady', { subject }) });
      const activation = require('./activationHttp').createActivationHttp({ express, service, oidc, origin: settings.origin,
        identityOrigin: new URL(settings.issuer).origin, bridgeSecret: settings.bridgeSecret });
      const app = express();
      app.disable('x-powered-by');
      app.set('trust proxy', trustProxy);
      app.use(ACTIVATION_PATH, activation.router);
      const bridge = express();
      bridge.disable('x-powered-by');
      bridge.use('/bridge', activation.bridge);
      bridgeServer = bridge.listen(port, env.MEMBER_ACTIVATION_BRIDGE_HOST || '0.0.0.0');
      await new Promise((resolve, reject) => { bridgeServer.once('listening', resolve); bridgeServer.once('error', reject); });
      return Object.freeze({ handler: app, bridgeServer,
        handles: url => url === ACTIVATION_PATH || url.startsWith(ACTIVATION_PATH + '/') || url.startsWith(ACTIVATION_PATH + '?') });
    })();
  }

  let closing = null;
  function close() {
    return closing ||= (async () => {
      if (bridgeServer?.listening) await new Promise(resolve => { bridgeServer.close(resolve); bridgeServer.closeAllConnections?.(); });
      await worker.close();
    })();
  }

  function createUserDeletion({authorityCoordinator,authConfig}){
    if(env.USER_DELETION_RUNTIME!=='central')return null;
    deletionService=require('../platformDirectory/deletion').createUserDeletion({coordinator:authorityCoordinator,issuer:settings.issuer,
      policyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory || 'recent-mfa'],
      audit:require('./audit').createOnboardingAudit(),
      identity:{remove:value=>worker.call('deleteIdentity',value)},projection:{anonymize:value=>worker.call('erasePerson',value)}});
    return deletionService;
  }
  return Object.freeze({ createMemberOnboarding, createUserDeletion, start, close });
}

module.exports = { configuredMemberOnboarding, ACTIVATION_PATH, BRIDGE_PORT };
