const {
  createOperationCatalog, createPermissionCatalog, createProfileCatalog
} = require('../../src/authorization/catalogs');

const ORGANIZATION_A = 'org-synthetic-alpha';
const ORGANIZATION_B = 'org-synthetic-beta';
const ACTOR_ID = 'user-synthetic-alpha';

function syntheticCatalogs() {
  const permissionCatalog = createPermissionCatalog(Object.freeze({
    version: 'f5-test-permissions-v1',
    permissions: Object.freeze([
      Object.freeze({ code: 'synthetic_resource.read',
        scopes: Object.freeze(['ORGANIZATION', 'UNIT', 'UNIT_SUBTREE', 'TEAM', 'RESOURCE']),
        sensitive: false, sodRule: null, auditEvent: 'AUTHORIZATION_ALLOWED' }),
      Object.freeze({ code: 'synthetic_resource.update',
        scopes: Object.freeze(['ORGANIZATION', 'UNIT', 'UNIT_SUBTREE', 'TEAM', 'RESOURCE']),
        sensitive: true, sodRule: 'TWO_PERSON', auditEvent: 'SENSITIVE_ACTION_ALLOWED' })
    ])
  }));
  const profileCatalog = createProfileCatalog(Object.freeze({
    version: 'f5-test-profiles-v1',
    profiles: Object.freeze(['ORG_ADMIN', 'FUNDING_MANAGER', 'CONTRIBUTOR', 'VIEWER'].map(code => Object.freeze({
      code, permissions: Object.freeze([])
    })))
  }), permissionCatalog);
  const operationCatalog = createOperationCatalog(Object.freeze({
    version: 'f5-test-operations-v1',
    operations: Object.freeze([
      Object.freeze({ code: 'SYNTHETIC_READ', permission: 'synthetic_resource.read', resourceType: 'SYNTHETIC_RESOURCE', effect: 'READ', auditEvent: 'AUTHORIZATION_ALLOWED' }),
      Object.freeze({ code: 'SYNTHETIC_JOB', permission: 'synthetic_resource.read', resourceType: 'SYNTHETIC_RESOURCE', effect: 'READ', auditEvent: 'SERVICE_JOB_DISPATCHED' }),
      Object.freeze({ code: 'SYNTHETIC_REPORT', permission: 'synthetic_resource.read', resourceType: 'SYNTHETIC_RESOURCE', effect: 'READ', auditEvent: 'AUTHORIZATION_ALLOWED' }),
      Object.freeze({ code: 'SYNTHETIC_EXPORT', permission: 'synthetic_resource.read', resourceType: 'SYNTHETIC_RESOURCE', effect: 'READ', auditEvent: 'EXPORT_ALLOWED' }),
      Object.freeze({ code: 'SYNTHETIC_DOCUMENT', permission: 'synthetic_resource.read', resourceType: 'SYNTHETIC_RESOURCE', effect: 'READ', auditEvent: 'DOCUMENT_ALLOWED' }),
      Object.freeze({ code: 'SYNTHETIC_UPDATE', permission: 'synthetic_resource.update', resourceType: 'SYNTHETIC_RESOURCE', effect: 'WRITE', auditEvent: 'SENSITIVE_ACTION_ALLOWED' })
    ])
  }), permissionCatalog);
  return Object.freeze({ permissionCatalog, profileCatalog, operationCatalog });
}

function actor(overrides = {}) {
  return Object.freeze({ type: 'HUMAN', id: ACTOR_ID, organizationId: ORGANIZATION_A,
    membershipId: 'membership-alpha', membershipVersion: 3, authorizationVersion: 7, ...overrides });
}

function membership(overrides = {}) {
  return Object.freeze({ id: 'membership-alpha', organizationId: ORGANIZATION_A, status: 'ACTIVE', ...overrides });
}

function resource(overrides = {}) {
  return Object.freeze({ id: 'resource-alpha', organizationId: ORGANIZATION_A, status: 'ACTIVE',
    unitId: 'unit-child', ancestorUnitIds: Object.freeze(['unit-root']), teamIds: Object.freeze(['team-alpha']), ...overrides });
}

function grant(permission = 'synthetic_resource.read', type = 'ORGANIZATION', id = ORGANIZATION_A) {
  return Object.freeze({ permission, scope: Object.freeze({ type, id, organizationId: ORGANIZATION_A }) });
}

function snapshot(overrides = {}) {
  return Object.freeze({ organizationId: ORGANIZATION_A, membershipVersion: 3, authorizationVersion: 7,
    profileCode: 'VIEWER', grants: Object.freeze([grant()]), sodRules: Object.freeze([]), supportGrant: null, ...overrides });
}

function assurance(authTime = 1894708500) {
  return Object.freeze({ authTime, acr: 'c4g-loa2', amr: Object.freeze(['otp']), policyVersion: 'c4g-assurance-v1' });
}

module.exports = { ACTOR_ID, ORGANIZATION_A, ORGANIZATION_B, actor, assurance, grant, membership, resource, snapshot, syntheticCatalogs };
