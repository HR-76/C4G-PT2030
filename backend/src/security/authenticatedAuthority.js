'use strict';

const { types: { isProxy } } = require('node:util');
const { createUuidV7 } = require('../audit/uuidV7');
const { hash,scope,isAuthorityCoordinator } = require('./authorityCoordinator');

function denied(authorityFailure = 'SESSION_INVALID') {
  const error = new Error('Authenticated authority required.');
  error.code = 'AUTHORITY_REQUIRED';
  error.authorityFailure = authorityFailure;
  throw error;
}
function unavailable() { const error=new Error('Authenticated authority unavailable.');error.code='AUTHORITY_UNAVAILABLE';throw error; }
const authorities = new WeakMap();
function isTaxonomySessionAuthority(value, binding = null) {
  const registered = value && authorities.get(value);
  return Boolean(registered && (!binding || (registered.membershipPort === binding.membershipPort
    && registered.authorizationDataPort === binding.authorizationDataPort && registered.policyVersion === binding.policyVersion
    && (!Object.hasOwn(binding,'authorityCoordinator')||registered.authorityCoordinator===binding.authorityCoordinator))));
}
function plain(value) {
  return value && !isProxy(value) && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).every(key => typeof key === 'string'
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

// Kept by the authenticated application layer, never issued from a functional command.
function createTaxonomySessionAuthority({ sessionStore, sessionRegistry, authorizationDataPort,
  membershipPort, policyVersion, authorityCoordinator=null,clock = { now: () => new Date() } }) {
  if (!sessionStore?.get || !sessionRegistry?.validateSession || !sessionRegistry?.resolveOrganizationContext
      || !authorizationDataPort?.load || !membershipPort?.revalidate || typeof policyVersion !== 'string') {
    throw new TypeError('F13 session authority dependencies are invalid.');
  }
  const handles = new WeakMap();
  if(authorityCoordinator&&!isAuthorityCoordinator(authorityCoordinator))throw new TypeError('Trusted authority coordinator required.');
  const coordinated=callback=>authorityCoordinator?authorityCoordinator.withAuthority(callback):callback();
  async function validated(handle) {
    if (!handle || !handles.has(handle)) denied();
    const expected=handles.get(handle);
    if(authorityCoordinator)await authorityCoordinator.validateEpochs(expected.authorityEpochs);
    return session(expected.sid,expected);
  }
  async function session(sid, expected = null) {
    const stored = await new Promise((resolve, reject) => sessionStore.get(sid, (error, value) => error ? reject(error) : resolve(value)));
    const auth = stored?.auth, now = clock.now().getTime();
    const idleUntil=stored?.cookie?.expires ? new Date(stored.cookie.expires).getTime() : Infinity;
    if(Number.isNaN(idleUntil)||idleUntil<=now)denied();
    if (!plain(auth) || !plain(auth.user) || !plain(auth.evidence) || !plain(auth.organizationContext)
        || typeof auth.user.id !== 'string' || !Number.isSafeInteger(auth.revocationVersion)
        || auth.policyVersion !== policyVersion || auth.evidence.policyVersion !== policyVersion
        || !Number.isFinite(auth.absoluteExpiresAt) || auth.absoluteExpiresAt <= now) denied();
    if (expected && (auth.user.id !== expected.userId || auth.revocationVersion !== expected.revocationVersion)) denied();
    if (!await sessionRegistry.validateSession({ sid, globalUserId: auth.user.id, revocationVersion: auth.revocationVersion, now })) denied();
    const resolved = await sessionRegistry.resolveOrganizationContext({ sid, globalUserId: auth.user.id, now });
    const context = resolved?.context;
    if(Number.isFinite(resolved?.expiresAt)&&resolved.expiresAt<=now)denied();
    if (resolved?.state !== 'VALID' || !context || context.organizationId !== auth.organizationContext.organizationId
        || context.membershipId !== auth.organizationContext.membershipId
        || context.membershipVersion !== auth.organizationContext.membershipVersion) denied('MEMBERSHIP_INVALID');
    const actor = { type: 'HUMAN', id: auth.user.id, organizationId: context.organizationId,
      membershipId: context.membershipId, membershipVersion: context.membershipVersion };
    const membership = await membershipPort.revalidate(actor);
    if (!membership || membership.status !== 'ACTIVE' || membership.id !== actor.membershipId
        || membership.organizationId !== actor.organizationId || membership.globalUserId !== actor.id
        || membership.membershipVersion !== actor.membershipVersion) denied('MEMBERSHIP_INVALID');
    const snapshot = await authorizationDataPort.load(actor);
    if (!snapshot) unavailable();
    if (snapshot.organizationId !== actor.organizationId || snapshot.membershipVersion !== actor.membershipVersion) denied('MEMBERSHIP_INVALID');
    if (!Number.isSafeInteger(snapshot.authorizationVersion) || snapshot.authorizationVersion < 1) unavailable();
    actor.authorizationVersion = snapshot.authorizationVersion;
    if (expected && (actor.organizationId !== expected.organizationId || actor.membershipId !== expected.membershipId
        || actor.membershipVersion !== expected.membershipVersion || actor.authorizationVersion !== expected.authorizationVersion)) denied('MEMBERSHIP_INVALID');
    return Object.freeze({ actor: Object.freeze(actor), assuranceEvidence: Object.freeze({ ...auth.evidence,
      amr: Array.isArray(auth.evidence.amr) ? Object.freeze([...auth.evidence.amr]) : null }), revocationVersion: auth.revocationVersion,
      expiresAt:Math.min(auth.absoluteExpiresAt,idleUntil,Number.isFinite(resolved.expiresAt)?resolved.expiresAt:auth.absoluteExpiresAt,
        Number.isFinite(membership.validUntil)?membership.validUntil:Infinity) });
  }
  const authority = Object.freeze({
    async guardIdentity(handle) {
      if(!handle||!handles.has(handle))denied();
      return coordinated(async()=>{
        const current=await validated(handle),expected=handles.get(handle);
        return Object.freeze({sessionDigest:hash(expected.sid),revocationVersion:current.revocationVersion,expiresAt:current.expiresAt});
      });
    },
    async captureAuthenticatedRequest(request) {
      // This method is a root-composition adapter invoked only after F3 session middleware.
      if (!request?.sessionID || !request.user?.id || request.authContext?.sessionId !== request.sessionID) denied();
      return coordinated(async()=>{
      const current = await session(request.sessionID);
      if (request.user.id !== current.actor.id) denied();
      if (request.organizationContext?.organizationId !== current.actor.organizationId
          || request.organizationContext?.membershipId !== current.actor.membershipId
          || request.organizationContext?.membershipVersion !== current.actor.membershipVersion) denied('MEMBERSHIP_INVALID');
      const handle = Object.freeze({});
      const authorityEpochs=authorityCoordinator?await authorityCoordinator.snapshotEpochs(scope({organizationId:current.actor.organizationId,
        subjectId:current.actor.id,membershipId:current.actor.membershipId,sessionDigest:hash(request.sessionID)})):null;
      handles.set(handle, Object.freeze({ sid: request.sessionID, userId: current.actor.id,
        revocationVersion: current.revocationVersion, ...current.actor,authorityEpochs }));
      return handle;
      });
    },
    async resolve(handle) {
      if(!handle||!handles.has(handle))denied();
      return coordinated(async()=>{
      const current = await validated(handle);
      return Object.freeze({ actor: current.actor, assuranceEvidence: current.assuranceEvidence, correlationId: createUuidV7() });
      });
    }
  });
  authorities.set(authority, { membershipPort, authorizationDataPort, policyVersion,authorityCoordinator });
  return authority;
}

module.exports = { createTaxonomySessionAuthority, isTaxonomySessionAuthority };
