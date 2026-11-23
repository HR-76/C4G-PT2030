'use strict';
// Entity admission for an API started by src/server.js (staging), outside the local installer.
// Contract: context/features/staging-entity-admission.md. PostgreSQL and Keycloak administration stay in the IPC worker;
// this process reuses the member runtime's public settings and only calls the worker's closed methods.
const path = require('node:path');

const ADMISSION_PATH = '/api/admission-activation';
const SUPERVISION_MS = 5000;
// The privileged worker of this runtime; the local installer has its own.
const WORKER_ENTRY = path.join(__dirname, 'provisioningWorker.js');

function invalid(code) {
  return Object.assign(new TypeError(code), { code });
}

// Returns null when the runtime is not selected. Otherwise: createAdmission for the production composition,
// credentialResolver for the tenant runtime, start() once the composition exists and the member runtime started, and close().
function configuredEntityAdmission({ env, express, members = null, centralPool = null, trustProxy = 1,
  createWorker = (file, entry) => require('../platformOnboarding/memberWorkerClient').createMemberWorkerClient(file, entry),
  createService = options => require('./service').createAdmissionService(options),
  createCompletion = options => require('./completionService').createCompletionService(options),
  createListing = options => require('./listing').createAdmissionListing(options),
  createOidc = options => require('../platformOnboarding/oidcActivationAdapter').createOidcActivationAdapter(options),
  readMemberSettings = (directory, environment) => require('../platformOnboarding/memberRuntime').readSettings(directory, environment),
  report = line => { process.stderr.write(line + '\n'); } }) {
  const selection = env.ENTITY_ADMISSION_RUNTIME || 'disabled';
  if (selection === 'disabled') return null;
  if (selection !== 'central') throw invalid('ENTITY_ADMISSION_RUNTIME_INVALID');
  // The activation clients, the bridge secret and the bridge listener belong to the member runtime.
  if (!members || typeof members.setBridgeFallback !== 'function' || typeof members.setProjectionFallback !== 'function') throw invalid('ENTITY_ADMISSION_REQUIRES_MEMBER_RUNTIME');
  if (!centralPool || typeof centralPool.query !== 'function') throw invalid('ENTITY_ADMISSION_CENTRAL_POOL_REQUIRED');
  const directory = env.ENTITY_ADMISSION_DIRECTORY;
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw invalid('ENTITY_ADMISSION_DIRECTORY_INVALID');
  const settings = readMemberSettings(env.MEMBER_ONBOARDING_DIRECTORY, env);
  const worker = createWorker(path.join(directory, 'worker.json'), WORKER_ENTRY);
  let service = null, oidc = null, supervisor = null, started = null;

  function createAdmission({ authorityCoordinator, authConfig }) {
    const workerOnly = async () => { throw invalid('WORKER_ONLY'); };
    // Completion runs in the worker; here it only answers the submit and status requests.
    const completion = createCompletion({ coordinator: authorityCoordinator, issuer: settings.issuer, policyVersion: authConfig.policyVersion,
      assuranceRequirements: authConfig.assurancePolicy[authConfig.privilegedLoginCategory], mfaPolicyCode: 'USER_OPTIONAL',
      dataResidencyCode: settings.dataResidencyCode, tenant: { ensure: workerOnly }, projection: { ensure: workerOnly }, publishCredentials: workerOnly });
    service = createService({ coordinator: authorityCoordinator, issuer: settings.issuer, completion, listing: createListing({ pool: centralPool }),
      identity: { ensure: value => worker.call('identity', value) },
      // The adapter needs the service, so it only exists after start(); activation cannot be reached before that.
      verification: { verify: value => { if (!oidc) throw invalid('ACTIVATION_INVALID'); return oidc.verify(value); } } });
    return service;
  }

  function start() {
    return started ||= (async () => {
      if (!service) throw invalid('ENTITY_ADMISSION_NOT_COMPOSED');
      try { await worker.call('health', {}); } catch { throw invalid('ENTITY_ADMISSION_WORKER_UNAVAILABLE'); }
      // The worker also runs the completion loop: a call restarts it if it ended.
      // A failing step is reported once per change, as codes only: the worker's output is not captured anywhere else.
      let reported = '';
      supervisor = setInterval(() => { worker.call('health', {}).then(state => {
        const failure = state?.lastFailure, signature = failure ? `${failure.step}:${failure.code}` : '';
        if (signature !== reported) { reported = signature; report(signature ? `C4G_ADMISSION_STEP_FAILED ${signature}` : 'C4G_ADMISSION_STEP_RECOVERED'); }
      }).catch(() => {}); }, SUPERVISION_MS);
      supervisor.unref?.();
      oidc = await createOidc({ issuer: settings.issuer, origin: settings.origin, manualClientId: settings.manualClientId,
        existingClientId: settings.existingClientId, callbackPath: ADMISSION_PATH + '/callback', service,
        passwordReady: subject => worker.call('passwordReady', { subject }) });
      // One bridge for Keycloak: a ticket that is not a member invitation is checked as an admission invitation.
      members.setBridgeFallback((ticket, subject) => oidc.bridge(ticket, subject));
      // People invited into an entity created by admission are projected into that entity's own database by the worker.
      members.setProjectionFallback(value => worker.call('memberProjection', value));
      const activation = require('../platformOnboarding/activationHttp').createActivationHttp({ express, service, oidc, origin: settings.origin,
        identityOrigin: new URL(settings.issuer).origin, bridgeSecret: settings.bridgeSecret, purpose: 'ADMISSION' });
      const app = express();
      app.disable('x-powered-by');
      app.set('trust proxy', trustProxy);
      app.use(ADMISSION_PATH, activation.router);
      return Object.freeze({ handler: app,
        handles: url => url === ADMISSION_PATH || url.startsWith(ADMISSION_PATH + '/') || url.startsWith(ADMISSION_PATH + '?') });
    })();
  }

  let closing = null;
  function close() {
    return closing ||= (async () => {
      clearInterval(supervisor);
      await worker.close();
    })();
  }

  return Object.freeze({ createAdmission, credentialResolver: request => worker.call('resolve', request), start, close });
}

module.exports = { configuredEntityAdmission, ADMISSION_PATH, WORKER_ENTRY };
