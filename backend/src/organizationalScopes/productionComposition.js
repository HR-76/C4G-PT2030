'use strict';

const crypto = require('node:crypto');
const { createPolicyEngine } = require('../authorization/policyEngine');
const { createAuditCoordinator } = require('../authorization/audit');
const { createMetricsPort } = require('../authorization/metrics');
const { createOrganizationalScopeAuthorization } = require('./authorization');
const { createArchiveParticipantRegistry } = require('./participantRegistry');
const { isTenantCapabilityEvidenceForPool } = require('../security/tenantMigrationPreflight');
const { createOrganizationalScopeAuditWriter } = require('./postgresAuditWriter');
const { createRepository } = require('./repository');
const { createOrganizationalScopeService, createPreparedOrganizationalScopeService } = require('./service');
const { createF13P1TenantOperations, DEFINITIONS } = require('./tenantOperations');

const EXPECTED_OPERATIONS = Object.freeze(DEFINITIONS.map(value => value.operationCode));

function createOrganizationalScopeProductionComposition({ authorizationCatalogs, telemetry = null }) {
  if (!authorizationCatalogs?.operationCatalog || !authorizationCatalogs?.permissionCatalog
      || !authorizationCatalogs?.profileCatalog
      || EXPECTED_OPERATIONS.some(code => !authorizationCatalogs.operationCatalog.resolve(code))) {
    throw new TypeError('F13-P1 production catalogs are incomplete.');
  }
  function bindTenant({ pool, organizationId, tenantId, membershipPort, authorizationDataPort,
    authorizationAuditPort, tenantCapabilityEvidence, archiveParticipant = null, identityFactory = null,
    auditWriter = null, clock = { now: () => new Date() }, assurancePolicyVersion = 'c4g-assurance-v1',
    recentMfaRequirement = Object.freeze({ maxAgeSeconds: 300, mfa: true,
      acceptedAcr: Object.freeze(['c4g-loa2']), acceptedAmr: Object.freeze(['otp']), amrMode: 'all' }) }) {
    if (!pool || typeof pool.connect !== 'function' || typeof organizationId !== 'string'
        || typeof tenantId !== 'string' || !membershipPort || typeof membershipPort.revalidate !== 'function'
        || !authorizationDataPort || typeof authorizationDataPort.load !== 'function'
        || !authorizationAuditPort || typeof authorizationAuditPort.accept !== 'function'
        || !clock || typeof clock.now !== 'function' || !isTenantCapabilityEvidenceForPool(tenantCapabilityEvidence, pool)
        || tenantCapabilityEvidence.tenantId !== tenantId
        || !tenantCapabilityEvidence.capabilities.includes('F13_P1_ORGANIZATIONAL_SCOPE')
        || !tenantCapabilityEvidence.compatibility.writeVersions.includes(tenantCapabilityEvidence.currentVersion)) {
      throw new TypeError('F13-P1 production tenant binding is incomplete.');
    }
    const participantRegistry = createArchiveParticipantRegistry({ capabilityEvidence:tenantCapabilityEvidence,
      participant:archiveParticipant });
    const ids = identityFactory || Object.freeze({ next: () => crypto.randomUUID() });
    const functionalAudit = auditWriter || createOrganizationalScopeAuditWriter({ organizationId, tenantId });
    const repository = createRepository({ organizationId, identityFactory: ids, auditWriter: functionalAudit,
      participantRegistry });
    const policyEngine = createPolicyEngine({ permissionCatalog: authorizationCatalogs.permissionCatalog,
      profileCatalog: authorizationCatalogs.profileCatalog, assurancePolicyVersion, recentMfaRequirement });
    const authorization = createOrganizationalScopeAuthorization({ operationCatalog: authorizationCatalogs.operationCatalog,
      membershipPort, authorizationDataPort, resourcePort: { load: (client, input) => repository.loadAuthorizationResource(client, input) },
      policyEngine, auditCoordinator: createAuditCoordinator({ port: authorizationAuditPort, timeoutMs: 100 }),
      clock, metricsPort: createMetricsPort(labels => { try { telemetry?.record('F5', 1, labels); } catch {} }) });
    const service = createOrganizationalScopeService({ pool, organizationId, repository, authorization });
    const prepared = createPreparedOrganizationalScopeService({ organizationId, repository, authorization });
    const handlers = Object.freeze({
      ORGANIZATIONAL_SCOPE_READ: ({ client, input }) => prepared.read(client, input),
      ORGANIZATIONAL_SCOPE_CREATE: ({ client, input }) => prepared.create(client, input),
      ORGANIZATIONAL_SCOPE_RENAME: ({ client, input }) => prepared.renameLabel(client, input),
      ORGANIZATIONAL_SCOPE_REPARENT: ({ client, input }) => prepared.reparent(client, input),
      ORGANIZATIONAL_SCOPE_ARCHIVE: ({ client, input }) => prepared.archive(client, input)
    });
    const operations = createF13P1TenantOperations({ handlers,
      authorizationOperationCatalog: authorizationCatalogs.operationCatalog });
    if (operations.catalog.size !== EXPECTED_OPERATIONS.length) {
      throw new TypeError('F13-P1 production tenant operation catalog is incomplete.');
    }
    return Object.freeze({ operations, service });
  }
  return Object.freeze({ bindTenant, operationCodes: EXPECTED_OPERATIONS });
}

module.exports = { EXPECTED_OPERATIONS, createOrganizationalScopeProductionComposition };
