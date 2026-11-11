'use strict';

const { canonicalClone } = require('./canonicalization');
const { PROFILE_SCOPE_TYPES } = require('./constants');

const baseOperations = [
  ['F13_PROFILE_READ', 'organization_profile.read', 'PROFILE_PROJECTION', 'READ', 'NORMAL', ['ORGANIZATION','UNIT','TEAM'], false, false, false, 'PROFILE_ACCESSED'],
  ['F13_PROFILE_DRAFT_CREATE', 'organization_profile.draft.create', 'PROFILE_SCOPE', 'WRITE', 'NORMAL', ['ORGANIZATION','UNIT','TEAM'], false, false, false, 'PROFILE_DRAFT_CREATED'],
  ['F13_PROFILE_DRAFT_EDIT', 'organization_profile.draft.edit', 'PROFILE_DRAFT', 'WRITE', 'NORMAL', ['ORGANIZATION','UNIT','TEAM'], false, false, false, 'PROFILE_DRAFT_REVISION_CREATED'],
  ['F13_PROFILE_SUBMIT', 'organization_profile.submit', 'PROFILE_DRAFT', 'WRITE', 'NORMAL', ['ORGANIZATION','UNIT','TEAM'], false, false, false, 'PROFILE_DRAFT_SUBMITTED'],
  ['F13_PROFILE_APPROVE', 'organization_profile.approve', 'PROFILE_DRAFT_REVISION', 'WRITE', 'RECENT_MFA', ['ORGANIZATION','UNIT','TEAM'], true, false, false, 'PROFILE_VERSION_APPROVED'],
  ['F13_PROFILE_REJECT', 'organization_profile.reject', 'PROFILE_DRAFT_REVISION', 'WRITE', 'RECENT_MFA', ['ORGANIZATION','UNIT','TEAM'], true, true, false, 'PROFILE_VERSION_REJECTED'],
  ['F13_PROFILE_PUBLISH', 'organization_profile.publish', 'PROFILE_VERSION', 'WRITE', 'RECENT_MFA', ['ORGANIZATION','UNIT','TEAM'], true, false, false, 'PROFILE_VERSION_PUBLISHED'],
  ['F13_PROFILE_COHORT_ACTIVATE', 'organization_profile.activate', 'PROFILE_ACTIVATION_COHORT', 'WRITE', 'RECENT_MFA', ['ORGANIZATION'], true, true, false, 'PROFILE_COHORT_ACTIVATED'],
  ['F13_PROFILE_SCOPE_DEACTIVATE', 'organization_profile.deactivate', 'SCOPE_ACTIVATION', 'WRITE', 'RECENT_MFA', ['ORGANIZATION','UNIT','TEAM'], true, true, false, 'PROFILE_SCOPE_DEACTIVATED'],
  ['F13_PROFILE_ROLLBACK', 'organization_profile.rollback', 'ACTIVATION_RECORD', 'WRITE', 'RECENT_MFA', ['ORGANIZATION'], true, true, false, 'PROFILE_ROLLBACK_ACTIVATED'],
  ['F13_PROFILE_ARCHIVE', 'organization_profile.archive', 'PROFILE_VERSION', 'WRITE', 'RECENT_MFA', ['ORGANIZATION','UNIT','TEAM'], true, true, false, 'PROFILE_ARCHIVED'],
  ['F13_PROFILE_RESTORE', 'organization_profile.restore', 'PROFILE_VERSION', 'WRITE', 'RECENT_MFA', ['ORGANIZATION','UNIT','TEAM'], true, true, false, 'PROFILE_RESTORED'],
  ['F13_TAXONOMY_READ', 'profile_taxonomy.read', 'TAXONOMY_RELEASE', 'READ', 'NORMAL', ['ORGANIZATION','UNIT','TEAM'], false, false, false, 'TAXONOMY_ACCESSED'],
  ['F13_TAXONOMY_RELEASE_CREATE', 'profile_taxonomy.release.create', 'TAXONOMY_RELEASE_DRAFT', 'WRITE', 'NORMAL', ['ORGANIZATION'], false, false, false, 'TAXONOMY_RELEASE_CREATED'],
  ['F13_TAXONOMY_LOCAL_CONCEPT_CREATE', 'profile_taxonomy.local_concept.create', 'LOCAL_CONCEPT_DRAFT', 'WRITE', 'NORMAL', ['ORGANIZATION'], false, false, false, 'TAXONOMY_LOCAL_CONCEPT_CREATED'],
  ['F13_TAXONOMY_LOCAL_CONCEPT_APPROVE', 'profile_taxonomy.local_concept.approve', 'LOCAL_CONCEPT_REVISION', 'WRITE', 'RECENT_MFA', ['ORGANIZATION'], true, false, false, 'TAXONOMY_LOCAL_CONCEPT_APPROVED'],
  ['F13_TAXONOMY_RELATION_CREATE', 'profile_taxonomy.relation.create', 'TAXONOMY_RELATION', 'WRITE', 'NORMAL', ['ORGANIZATION'], false, false, false, 'TAXONOMY_RELATION_CREATED'],
  ['F13_TAXONOMY_MAPPING_CREATE', 'profile_taxonomy.mapping.create', 'TAXONOMY_MAPPING', 'WRITE', 'NORMAL', ['ORGANIZATION'], false, false, false, 'TAXONOMY_MAPPING_CREATED'],
  ['F13_TAXONOMY_RELEASE_PUBLISH', 'profile_taxonomy.release.publish', 'TAXONOMY_RELEASE', 'WRITE', 'RECENT_MFA', ['ORGANIZATION'], true, false, false, 'TAXONOMY_RELEASE_PUBLISHED'],
  ['F13_METRIC_CATALOG_READ', 'profile_metric_catalog.read', 'METRIC_CATALOG_RELEASE', 'READ', 'NORMAL', ['ORGANIZATION'], false, false, false, 'METRIC_CATALOG_ACCESSED'],
  ['F13_METRIC_CATALOG_ADMIN', 'profile_metric_catalog.admin', 'METRIC_CATALOG_REVISION', 'WRITE', 'RECENT_MFA', ['ORGANIZATION'], true, true, false, 'METRIC_CATALOG_CHANGED'],
  ['F13_EVIDENCE_LINK_READ', 'profile_evidence.link.read', 'EVIDENCE_LINK', 'READ', 'NORMAL', ['ORGANIZATION','UNIT','TEAM'], false, false, false, 'EVIDENCE_LINK_ACCESSED'],
  ['F13_EVIDENCE_ATTACH', 'profile_evidence.attach', 'ASSERTION', 'WRITE', 'NORMAL', ['ORGANIZATION','UNIT','TEAM'], false, false, false, 'EVIDENCE_ATTACHED'],
  ['F13_COMPETENCY_VERIFY', 'profile_competency.verify', 'COMPETENCY_ASSERTION', 'WRITE', 'RECENT_MFA', ['ORGANIZATION','UNIT','TEAM'], true, false, false, 'COMPETENCY_ASSERTION_VERIFIED'],
  ['F13_FINANCIAL_VERIFY', 'profile_financial.verify', 'FINANCIAL_FACT', 'WRITE', 'RECENT_MFA', ['ORGANIZATION'], true, false, false, 'FINANCIAL_FACT_VERIFIED'],
  ['F13_OPERATIONAL_VERIFY', 'profile_operational.verify', 'OPERATIONAL_ASSERTION', 'WRITE', 'RECENT_MFA', ['ORGANIZATION','UNIT'], true, false, false, 'OPERATIONAL_ASSERTION_VERIFIED'],
  ['F13_ASSERTION_DISPUTE', 'profile_assertion.dispute', 'ASSERTION', 'WRITE', 'RECENT_MFA', ['ORGANIZATION','UNIT','TEAM'], false, true, false, 'ASSERTION_DISPUTED'],
  ['F13_ASSERTION_CONFLICT_RESOLVE', 'profile_assertion.conflict.resolve', 'ASSERTION_CONFLICT', 'WRITE', 'RECENT_MFA', ['ORGANIZATION','UNIT','TEAM'], true, true, false, 'ASSERTION_CONFLICT_RESOLVED'],
  ['F13_ASSERTION_REVOKE', 'profile_assertion.revoke', 'ASSERTION', 'WRITE', 'RECENT_MFA', ['ORGANIZATION','UNIT','TEAM'], true, true, false, 'ASSERTION_REVOKED'],
  ['F13_RESTRICTED_VALUE_READ', 'organization_profile.restricted_value.read', 'RESTRICTED_PROFILE_VALUE', 'READ', 'RECENT_MFA', ['ORGANIZATION','UNIT'], false, true, true, 'RESTRICTED_VALUE_ACCESSED'],
  ['F13_PROFILE_EXPORT_FULL', 'organization_profile.export.full', 'PROFILE_EXPORT_REQUEST', 'READ', 'RECENT_MFA', ['ORGANIZATION','UNIT','TEAM'], false, true, true, 'PROFILE_EXPORT_REQUESTED'],
  ['F13_PROFILE_EXPORT_REDACTED', 'organization_profile.export.redacted', 'PROFILE_EXPORT_REQUEST', 'READ', 'RECENT_MFA', ['ORGANIZATION','UNIT','TEAM'], false, true, true, 'PROFILE_REDACTED_EXPORT_REQUESTED'],
  ['F13_PROFILE_CONFIDENTIALITY_RECLASSIFY', 'organization_profile.confidentiality.reclassify', 'PROFILE_DATA_CLASSIFICATION', 'WRITE', 'RECENT_MFA', ['ORGANIZATION','UNIT','TEAM'], true, true, false, 'PROFILE_CONFIDENTIALITY_RECLASSIFIED']
];

const F13_OPERATION_DEFINITIONS = canonicalClone(baseOperations.map(([code, permission, resourceType, effect, assurance, scopes, makerCheckerRequired, reasonRequired, purposeRequired, auditEvent]) => ({
  assurance, auditEvent, code, effect, makerCheckerRequired, permission, purposeRequired, reasonRequired, resourceType, scopes
})));
const F13_AUDIT_EVENT_DEFINITIONS = canonicalClone([...new Set(F13_OPERATION_DEFINITIONS.map(item => item.auditEvent))].map(code => ({
  code,
  eventVersion: 1
})));

validateStructuralCatalogs();

function validateStructuralCatalogs() {
  if (F13_OPERATION_DEFINITIONS.length !== 33 || new Set(F13_OPERATION_DEFINITIONS.map(item => item.code)).size !== 33
      || new Set(F13_OPERATION_DEFINITIONS.map(item => item.permission)).size !== 33) throw new TypeError('F13 operation catalog is incomplete.');
  for (const item of F13_OPERATION_DEFINITIONS) {
    if (!/^F13_[A-Z0-9_]{1,59}$/.test(item.code)
        || !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(item.permission)
        || !/^[A-Z][A-Z0-9_]{0,63}$/.test(item.resourceType)
        || !['READ','WRITE'].includes(item.effect)
        || !['NORMAL','RECENT_MFA'].includes(item.assurance)
        || !Array.isArray(item.scopes) || item.scopes.length === 0
        || item.scopes.some(scope => !PROFILE_SCOPE_TYPES.includes(scope))
        || new Set(item.scopes).size !== item.scopes.length
        || typeof item.makerCheckerRequired !== 'boolean'
        || typeof item.reasonRequired !== 'boolean' || typeof item.purposeRequired !== 'boolean'
        || !/^[A-Z][A-Z0-9_]{0,63}$/.test(item.auditEvent)) throw new TypeError('F13 operation catalog entry is invalid.');
  }
  return true;
}

function resolveOperation(code) {
  return typeof code === 'string' ? F13_OPERATION_DEFINITIONS.find(item => item.code === code) || null : null;
}

function resolveAuditEvent(code, eventVersion = 1) {
  return typeof code === 'string' && eventVersion === 1
    ? F13_AUDIT_EVENT_DEFINITIONS.find(item => item.code === code) || null : null;
}

module.exports = { F13_AUDIT_EVENT_DEFINITIONS, F13_OPERATION_DEFINITIONS, resolveAuditEvent, resolveOperation, validateStructuralCatalogs };
