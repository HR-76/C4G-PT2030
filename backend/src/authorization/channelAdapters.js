const CHANNELS = Object.freeze(['API', 'JOB', 'REPORTING', 'EXPORT', 'DOCUMENT']);

function createChannelAdapter({ channel, operationCode, authorizationService, effect }) {
  if (!CHANNELS.includes(channel) || typeof operationCode !== 'string'
      || !authorizationService || typeof authorizationService.authorize !== 'function' || typeof effect !== 'function') {
    throw new TypeError('Authorization channel adapter configuration is invalid.');
  }
  return Object.freeze({ async execute(input) {
    if (!input || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype
        || Reflect.ownKeys(input).some(key => !['actor', 'resourceId', 'assuranceEvidence', 'correlationId', 'payload'].includes(key))) {
      throw new TypeError('Channel input is invalid.');
    }
    const decision = await authorizationService.authorize({ operationCode, actor: input.actor,
      resourceId: input.resourceId, assuranceEvidence: input.assuranceEvidence, correlationId: input.correlationId });
    if (!decision.allowed) return decision;
    return Object.freeze({ allowed: true, value: await effect({ resource: decision.resource, payload: input.payload, channel }) });
  } });
}

function createServiceActor({ serviceId, organizationId, operationCode, executionId, authorizationVersion }) {
  if (![serviceId, organizationId, operationCode, executionId].every(value => typeof value === 'string' && value.length > 0)
      || !Number.isSafeInteger(authorizationVersion) || authorizationVersion < 1) {
    throw new TypeError('Service actor binding is invalid.');
  }
  return Object.freeze({ type: 'SERVICE', id: serviceId, organizationId, membershipId: `service:${executionId}`,
    membershipVersion: 1, authorizationVersion, operationCode, executionId });
}

module.exports = { CHANNELS, createChannelAdapter, createServiceActor };
