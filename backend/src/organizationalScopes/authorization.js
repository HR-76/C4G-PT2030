'use strict';

const { createAuthorizationService } = require('../authorization/authorizationService');

const TARGETS = new Set(['ORGANIZATION', 'ORGANIZATIONAL_SCOPE']);

function targetCatalog(operationCatalog, resourceType) {
  return Object.freeze({
    version: operationCatalog.version,
    resolve(code) {
      const operation = operationCatalog.resolve(code);
      return operation ? Object.freeze({ ...operation, resourceType }) : null;
    }
  });
}

function createOrganizationalScopeAuthorization({ operationCatalog, membershipPort, authorizationDataPort,
  resourcePort, policyEngine, auditCoordinator, clock, metricsPort, telemetryPort = null }) {
  if (!resourcePort || typeof resourcePort.load !== 'function') {
    throw new TypeError('Organizational scope authorization resource port is invalid.');
  }
  return Object.freeze({
    async authorize(request, client, target) {
      if (!client || typeof client.query !== 'function') throw new TypeError('Prepared tenant client is required for authorization.');
      if (!target || Object.getPrototypeOf(target) !== Object.prototype
          || Reflect.ownKeys(target).length !== 2 || !TARGETS.has(target.resourceType)
          || typeof target.decisionKey !== 'string' || !/^[A-Z_]{1,32}$/.test(target.decisionKey)) {
        throw new TypeError('Organizational scope authorization target is invalid.');
      }
      const scopedPolicyEngine = Object.freeze({
        evaluate: input => policyEngine.evaluate(Object.freeze({ ...input, exactResourceScope: true,
          allowInactiveResource: request.operationCode === 'ORGANIZATIONAL_SCOPE_ARCHIVE' }))
      });
      const scopedAuditCoordinator = Object.freeze({
        emit: event => auditCoordinator.emit(Object.freeze({ ...event, eventId: `${event.eventId}:${target.decisionKey}` }))
      });
      const service = createAuthorizationService({ operationCatalog: targetCatalog(operationCatalog, target.resourceType), membershipPort, authorizationDataPort,
        resourcePort: Object.freeze({ load: input => resourcePort.load(client, input) }), policyEngine: scopedPolicyEngine,
        auditCoordinator: scopedAuditCoordinator, clock, metricsPort, telemetryPort });
      return service.authorize(request);
    }
  });
}

module.exports = { createOrganizationalScopeAuthorization };
