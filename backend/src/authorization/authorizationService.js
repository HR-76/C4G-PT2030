function closed(value, keys) {
  return value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function publicDenial(reasonCode) {
  return Object.freeze({ allowed: false, reasonCode, publicCode: 'RESOURCE_NOT_AVAILABLE' });
}

function createAuthorizationService({ operationCatalog, membershipPort, authorizationDataPort, resourcePort,
  policyEngine, auditCoordinator, clock, metricsPort, telemetryPort = null, serviceOperationCatalog = null,
  withAuthorityReads = work => work(), scopeSnapshot = snapshot => snapshot }) {
  if (![membershipPort, authorizationDataPort, resourcePort, policyEngine, auditCoordinator, clock, metricsPort].every(Boolean)) {
    throw new TypeError('Authorization service dependencies are invalid.');
  }
  if (typeof withAuthorityReads !== 'function' || typeof scopeSnapshot !== 'function') {
    throw new TypeError('Authorization read boundary is invalid.');
  }
  async function deny(actor, operation, reasonCode, correlationId) {
    const eventType = reasonCode.startsWith('AUTH_') || reasonCode.includes('MFA') ? 'AUTHORIZATION_MFA_REQUIRED' : 'AUTHORIZATION_DENIED';
    await auditCoordinator.emit({ eventId: correlationId, schemaVersion: 'f5-audit-v1', occurredAt: clock.now().toISOString(),
      eventType, actorType: actor.type, actorId: actor.id, membershipId: actor.membershipId,
      organizationId: actor.organizationId, operationCode: operation && operation.code || 'UNKNOWN',
      permissionCode: operation && operation.permission || 'UNKNOWN', result: 'DENY', reasonCode,
      correlationId }).catch(() => {});
    try { metricsPort.record(Object.freeze({ result: 'DENY', reasonCode, category: 'AUTHORIZATION' })); } catch { /* non-authoritative */ }
    try { telemetryPort?.record('F5', 1, Object.freeze({ result: 'DENY', reasonCode, category: 'AUTHORIZATION' })); } catch { /* non-authoritative */ }
    return publicDenial(reasonCode);
  }
  return Object.freeze({ async authorize(request) {
    if (!closed(request, ['operationCode', 'actor', 'resourceId', 'assuranceEvidence', 'correlationId'])) {
      throw new TypeError('Authorization request is not closed.');
    }
    const operation = operationCatalog.resolve(request.operationCode);
    if (!operation) return deny(request.actor, null, 'OPERATION_NOT_REGISTERED', request.correlationId);
    const actor = request.actor;
    const serviceBinding=serviceOperationCatalog?.resolve(operation.code)||null;
    const actorKeys = actor && actor.type === 'SERVICE'
      ? ['type', 'id', 'organizationId', 'membershipId', 'membershipVersion', 'authorizationVersion', 'operationCode', 'executionId',...(serviceBinding?['jobType']:[])]
      : ['type', 'id', 'organizationId', 'membershipId', 'membershipVersion', 'authorizationVersion'];
    if (!closed(actor, actorKeys)) {
      throw new TypeError('Authorization actor is not closed.');
    }
    if(actor.type==='SERVICE'&&actor.operationCode!==operation.code){if(serviceBinding)return deny(actor,operation,'SERVICE_BINDING_MISMATCH',request.correlationId);throw new TypeError('Authorization actor is not closed.');}
    if(serviceBinding&&(actor.type!=='SERVICE'||actor.membershipId!==null||actor.id!==serviceBinding.serviceActorCode||actor.jobType!==serviceBinding.jobType))return deny(actor,operation,'SERVICE_BINDING_MISMATCH',request.correlationId);
    if(!serviceBinding&&actor.type==='SERVICE'&&actor.membershipId===null)return deny(actor,operation,'SERVICE_BINDING_MISMATCH',request.correlationId);
    let membership, snapshot, readFailure = 'MEMBERSHIP_UNAVAILABLE';
    try {
      // Only fresh Central reads belong in this boundary. Inactive membership
      // still short-circuits; a failed group commit cannot yield a decision.
      ({ membership, snapshot } = await withAuthorityReads(async () => {
        const membership = await membershipPort.revalidate(actor);
        if (!membership || membership.status !== 'ACTIVE' || membership.organizationId !== actor.organizationId) return { membership };
        readFailure = 'POLICY_DATA_UNAVAILABLE';
        return { membership, snapshot: await authorizationDataPort.load(actor) };
      }));
    } catch { return deny(actor, operation, readFailure, request.correlationId); }
    if (!membership || membership.status !== 'ACTIVE' || membership.organizationId !== actor.organizationId) {
      return deny(actor, operation, 'MEMBERSHIP_INACTIVE_OR_MISMATCH', request.correlationId);
    }
    // Resource-specific tenant work and audit keep their original outer scope.
    try { snapshot = await scopeSnapshot(snapshot, actor); }
    catch { return deny(actor, operation, 'POLICY_DATA_UNAVAILABLE', request.correlationId); }
    let resource;
    try { resource = await resourcePort.load({ organizationId: actor.organizationId, resourceType: operation.resourceType,
      resourceId: request.resourceId }); }
    catch { return deny(actor, operation, 'RESOURCE_NOT_AVAILABLE', request.correlationId); }
    if (!resource || resource.organizationId !== actor.organizationId) {
      return deny(actor, operation, 'RESOURCE_NOT_AVAILABLE', request.correlationId);
    }
    let decision;
    try {
      decision = policyEngine.evaluate({ actor, membership, snapshot, operation, resource, serviceBinding,
        assuranceEvidence: request.assuranceEvidence, now: clock.now() });
    } catch { return deny(actor, operation, 'POLICY_INVALID', request.correlationId); }
    if (!decision.allowed) return deny(actor, operation, decision.reasonCode, request.correlationId);
    const criticalEvents = new Set(['SENSITIVE_ACTION_ALLOWED', 'SUPPORT_USED', 'SERVICE_JOB_DISPATCHED',
      'EXPORT_ALLOWED', 'DOCUMENT_ALLOWED', 'DOCUMENT_UPLOAD_INTENT_ACCEPTED',
      'DOCUMENT_ACCESS_CAPABILITY_ISSUED', 'DOCUMENT_VERSION_CREATED', 'DOCUMENT_LIFECYCLE_REQUESTED']);
    const eventType = actor.type === 'SUPPORT' ? 'SUPPORT_USED'
      : decision.permission.sensitive ? 'SENSITIVE_ACTION_ALLOWED' : operation.auditEvent;
    const critical = criticalEvents.has(eventType);
    try {
      await auditCoordinator.emit({ eventId: request.correlationId, schemaVersion: 'f5-audit-v1',
        occurredAt: clock.now().toISOString(), eventType, actorType: actor.type, actorId: actor.id,
        membershipId: actor.membershipId, organizationId: actor.organizationId, operationCode: operation.code,
        permissionCode: operation.permission, resourceType: operation.resourceType, resourceId: resource.id,
        result: 'ALLOW', reasonCode: decision.reasonCode, catalogVersion: operationCatalog.version,
        membershipVersion: actor.membershipVersion, authorizationVersion: actor.authorizationVersion,
        correlationId: request.correlationId });
    } catch { return deny(actor, operation, critical ? 'AUDIT_CRITICAL_UNAVAILABLE' : 'AUDIT_UNAVAILABLE', request.correlationId); }
    try { metricsPort.record(Object.freeze({ result: 'ALLOW', reasonCode: 'AUTHORIZED', category: 'AUTHORIZATION' })); } catch { /* non-authoritative */ }
    try { telemetryPort?.record('F5', 1, Object.freeze({ result: 'ALLOW', reasonCode: 'AUTHORIZED', category: 'AUTHORIZATION' })); } catch { /* non-authoritative */ }
    return Object.freeze({ allowed: true, reasonCode: 'AUTHORIZED', operation, resource });
  } });
}

module.exports = { createAuthorizationService, publicDenial };
