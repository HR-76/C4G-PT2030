const { types: { isProxy } } = require('node:util');
const { createServiceOperationCatalog } = require('./serviceOperationCatalog');

const VERSION = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const PERMISSION = /^[a-z][a-z0-9_]{0,62}(?:\.[a-z][a-z0-9_]{0,62})+$/;
const OPERATION = /^[A-Z][A-Z0-9_]{0,63}$/;
const PROFILE_CODES = Object.freeze(['ORG_ADMIN', 'FUNDING_MANAGER', 'CONTRIBUTOR', 'VIEWER']);
const SCOPE_TYPES = Object.freeze(['ORGANIZATION', 'UNIT', 'UNIT_SUBTREE', 'TEAM', 'RESOURCE']);
const scopeSet = new Set(SCOPE_TYPES);

function exactRecord(value, keys) {
  return Boolean(value) && typeof value === 'object' && !isProxy(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function frozenUniqueStrings(value, validator, { empty = false } = {}) {
  return Array.isArray(value) && Object.isFrozen(value) && (empty || value.length > 0)
    && value.every(item => typeof item === 'string' && validator(item))
    && new Set(value).size === value.length;
}

function createPermissionCatalog(configuration) {
  if (!exactRecord(configuration, ['version', 'permissions']) || !VERSION.test(configuration.version)
      || !Array.isArray(configuration.permissions) || !Object.isFrozen(configuration.permissions)) {
    throw new TypeError('Permission catalog configuration is invalid.');
  }
  const entries = new Map();
  for (const entry of configuration.permissions) {
    if (!exactRecord(entry, ['code', 'scopes', 'sensitive', 'sodRule', 'auditEvent']) || !Object.isFrozen(entry)
        || !PERMISSION.test(entry.code) || entry.code.includes('*') || entries.has(entry.code)
        || !frozenUniqueStrings(entry.scopes, value => scopeSet.has(value))
        || typeof entry.sensitive !== 'boolean'
        || (entry.sodRule !== null && (typeof entry.sodRule !== 'string' || !OPERATION.test(entry.sodRule)))
        || typeof entry.auditEvent !== 'string' || !OPERATION.test(entry.auditEvent)) {
      throw new TypeError('Permission catalog entry is invalid.');
    }
    entries.set(entry.code, entry);
  }
  return Object.freeze({
    version: configuration.version,
    permissions: Object.freeze([...entries.values()]),
    resolve(code) { return typeof code === 'string' ? entries.get(code) || null : null; },
    get size() { return entries.size; }
  });
}

function createProfileCatalog(configuration, permissionCatalog) {
  if (!permissionCatalog || typeof permissionCatalog.resolve !== 'function'
      || !exactRecord(configuration, ['version', 'profiles']) || !VERSION.test(configuration.version)
      || !Array.isArray(configuration.profiles) || !Object.isFrozen(configuration.profiles)) {
    throw new TypeError('Profile catalog configuration is invalid.');
  }
  const profiles = new Map();
  for (const profile of configuration.profiles) {
    if (!exactRecord(profile, ['code', 'permissions']) || !Object.isFrozen(profile)
        || !PROFILE_CODES.includes(profile.code) || profiles.has(profile.code)
        || !frozenUniqueStrings(profile.permissions, code => PERMISSION.test(code) && !code.includes('*'), { empty: true })
        || profile.permissions.some(code => !permissionCatalog.resolve(code))) {
      throw new TypeError('Profile catalog entry is invalid.');
    }
    profiles.set(profile.code, profile);
  }
  if (profiles.size !== PROFILE_CODES.length || PROFILE_CODES.some(code => !profiles.has(code))) {
    throw new TypeError('All structural base profiles are required.');
  }
  return Object.freeze({
    version: configuration.version,
    profiles: Object.freeze([...profiles.values()]),
    resolve(code) { return typeof code === 'string' ? profiles.get(code) || null : null; }
  });
}

function createOperationCatalog(configuration, permissionCatalog) {
  if (!exactRecord(configuration, ['version', 'operations']) || !VERSION.test(configuration.version)
      || !Array.isArray(configuration.operations) || !Object.isFrozen(configuration.operations)) {
    throw new TypeError('Authorization operation catalog configuration is invalid.');
  }
  const operations = new Map();
  for (const operation of configuration.operations) {
    if (!exactRecord(operation, ['code', 'permission', 'resourceType', 'effect', 'auditEvent']) || !Object.isFrozen(operation)
        || !OPERATION.test(operation.code) || operations.has(operation.code)
        || !PERMISSION.test(operation.permission) || !permissionCatalog.resolve(operation.permission)
        || typeof operation.resourceType !== 'string' || !OPERATION.test(operation.resourceType)
        || typeof operation.auditEvent !== 'string' || !OPERATION.test(operation.auditEvent)
        || !['READ', 'WRITE'].includes(operation.effect)) {
      throw new TypeError('Authorization operation entry is invalid.');
    }
    operations.set(operation.code, operation);
  }
  return Object.freeze({
    version: configuration.version,
    resolve(code) { return typeof code === 'string' ? operations.get(code) || null : null; },
    get size() { return operations.size; }
  });
}

function createProductionCatalogs({ catalogVersion = 'f11' } = {}) {
  if (!['f5', 'f7', 'f11', 'f12', 'f13p1', 'f13'].includes(catalogVersion)) throw new TypeError('Production catalog version is unsupported.');
  const auditPermissions = ['f7', 'f11', 'f12', 'f13p1', 'f13'].includes(catalogVersion) ? Object.freeze([
    Object.freeze({ code: 'audit_event.read', scopes: Object.freeze(['ORGANIZATION']), sensitive: false, sodRule: null, auditEvent: 'SENSITIVE_ACTION_ALLOWED' }),
    Object.freeze({ code: 'audit_event.verify', scopes: Object.freeze(['ORGANIZATION']), sensitive: true, sodRule: null, auditEvent: 'SENSITIVE_ACTION_ALLOWED' }),
    Object.freeze({ code: 'audit_event.export', scopes: Object.freeze(['ORGANIZATION']), sensitive: true, sodRule: null, auditEvent: 'EXPORT_ALLOWED' }),
    Object.freeze({ code: 'audit_event.read_cross_organization', scopes: Object.freeze(['ORGANIZATION']), sensitive: true, sodRule: 'AUDIT_CROSS_ORG_SOD', auditEvent: 'SENSITIVE_ACTION_ALLOWED' })
  ]) : Object.freeze([]);
  const documentPermissions = ['f11', 'f12', 'f13p1', 'f13'].includes(catalogVersion) ? Object.freeze([
    Object.freeze({ code: 'document.upload.initiate', scopes: Object.freeze(['ORGANIZATION', 'RESOURCE']), sensitive: false, sodRule: null, auditEvent: 'DOCUMENT_UPLOAD_INTENT_ACCEPTED' }),
    Object.freeze({ code: 'document.upload.confirm', scopes: Object.freeze(['ORGANIZATION', 'RESOURCE']), sensitive: false, sodRule: null, auditEvent: 'DOCUMENT_UPLOAD_CONFIRMED' }),
    Object.freeze({ code: 'document.read', scopes: Object.freeze(['ORGANIZATION', 'RESOURCE']), sensitive: false, sodRule: null, auditEvent: 'DOCUMENT_ACCESS_CAPABILITY_ISSUED' }),
    Object.freeze({ code: 'document.version.create', scopes: Object.freeze(['ORGANIZATION', 'RESOURCE']), sensitive: false, sodRule: null, auditEvent: 'DOCUMENT_VERSION_CREATED' }),
    Object.freeze({ code: 'document.version.list', scopes: Object.freeze(['ORGANIZATION', 'RESOURCE']), sensitive: false, sodRule: null, auditEvent: 'DOCUMENT_ACCESS_CAPABILITY_ISSUED' }),
    Object.freeze({ code: 'document.download.request', scopes: Object.freeze(['ORGANIZATION', 'RESOURCE']), sensitive: false, sodRule: null, auditEvent: 'DOCUMENT_ACCESS_CAPABILITY_ISSUED' }),
    Object.freeze({ code: 'document.quarantine.manage', scopes: Object.freeze(['ORGANIZATION', 'RESOURCE']), sensitive: true, sodRule: 'DOCUMENT_QUARANTINE_SOD', auditEvent: 'DOCUMENT_LIFECYCLE_REQUESTED' })
  ]) : Object.freeze([]);
  const criteriaPermissions = ['f12','f13p1','f13'].includes(catalogVersion) ? ['read','edit','confirm'].map(action=>Object.freeze({code:'opportunity.criteria.'+action,scopes:Object.freeze(['ORGANIZATION','RESOURCE']),sensitive:false,sodRule:null,auditEvent:'OPPORTUNITY_ACCESS_DENIED'})) : [];
  const opportunityPermissions = ['f12','f13p1','f13'].includes(catalogVersion) ? Object.freeze([
    Object.freeze({ code: 'async_job.replay', scopes: Object.freeze(['ORGANIZATION', 'RESOURCE']), sensitive: true, sodRule: 'ASYNC_JOB_REPLAY_SOD', auditEvent: 'ASYNC_REPLAY_REQUESTED' }),
    Object.freeze({ code: 'async_job.replay_approve', scopes: Object.freeze(['ORGANIZATION', 'RESOURCE']), sensitive: true, sodRule: 'ASYNC_JOB_REPLAY_SOD', auditEvent: 'ASYNC_REPLAY_APPROVED' }),
    ...criteriaPermissions,
    Object.freeze({ code: 'opportunity.read', scopes: Object.freeze(['ORGANIZATION', 'RESOURCE']), sensitive: false, sodRule: null, auditEvent: 'OPPORTUNITY_ACCESS_DENIED' }),
    Object.freeze({ code: 'opportunity.private.create', scopes: Object.freeze(['ORGANIZATION']), sensitive: false, sodRule: null, auditEvent: 'OPPORTUNITY_CREATED' }),
    Object.freeze({ code: 'opportunity.private.update', scopes: Object.freeze(['ORGANIZATION', 'RESOURCE']), sensitive: false, sodRule: null, auditEvent: 'OPPORTUNITY_REVISION_CREATED' }),
    Object.freeze({ code: 'opportunity.archive', scopes: Object.freeze(['ORGANIZATION', 'RESOURCE']), sensitive: true, sodRule: 'OPPORTUNITY_ARCHIVE_SOD', auditEvent: 'OPPORTUNITY_ARCHIVED' }),
    Object.freeze({ code: 'opportunity.restore', scopes: Object.freeze(['ORGANIZATION', 'RESOURCE']), sensitive: true, sodRule: 'OPPORTUNITY_RESTORE_SOD', auditEvent: 'OPPORTUNITY_RESTORED' }),
    Object.freeze({ code: 'opportunity.duplicate.review', scopes: Object.freeze(['ORGANIZATION', 'RESOURCE']), sensitive: true, sodRule: 'OPPORTUNITY_DUPLICATE_REVIEW_SOD', auditEvent: 'OPPORTUNITY_DUPLICATE_DECISION_RECORDED' }),
    Object.freeze({ code: 'opportunity.duplicate.scan', scopes: Object.freeze(['ORGANIZATION']), sensitive: false, sodRule: null, auditEvent: 'SERVICE_JOB_DISPATCHED' }),
    Object.freeze({ code: 'opportunity.catalog.reconcile', scopes: Object.freeze(['ORGANIZATION']), sensitive: false, sodRule: null, auditEvent: 'SERVICE_JOB_DISPATCHED' }),
    Object.freeze({ code: 'opportunity.central.manage', scopes: Object.freeze(['RESOURCE']), sensitive: true, sodRule: 'OPPORTUNITY_CENTRAL_MANAGE_SOD', auditEvent: 'OPPORTUNITY_REVISION_CREATED' })
    ,Object.freeze({ code: 'opportunity_import.upload', scopes: Object.freeze(['ORGANIZATION']), sensitive: false, sodRule: null, auditEvent: 'OPPORTUNITY_IMPORT_UPLOADED' })
    ,Object.freeze({ code: 'opportunity_import.preview', scopes: Object.freeze(['ORGANIZATION','RESOURCE']), sensitive: false, sodRule: null, auditEvent: 'OPPORTUNITY_IMPORT_UPLOADED' })
    ,Object.freeze({ code: 'opportunity_import.confirm', scopes: Object.freeze(['ORGANIZATION','RESOURCE']), sensitive: true, sodRule: null, auditEvent: 'OPPORTUNITY_IMPORT_CONFIRMED' })
    ,Object.freeze({ code: 'opportunity_import.read', scopes: Object.freeze(['ORGANIZATION','RESOURCE']), sensitive: false, sodRule: null, auditEvent: 'OPPORTUNITY_IMPORT_UPLOADED' })
    ,Object.freeze({ code: 'opportunity_import.cancel', scopes: Object.freeze(['ORGANIZATION','RESOURCE']), sensitive: false, sodRule: null, auditEvent: 'OPPORTUNITY_IMPORT_CANCELLED' })
    ,Object.freeze({ code: 'opportunity_import.review', scopes: Object.freeze(['ORGANIZATION','RESOURCE']), sensitive: true, sodRule: null, auditEvent: 'OPPORTUNITY_IMPORT_POSSIBLE_REVIEWED' })
    ,Object.freeze({ code: 'opportunity_import.download_report', scopes: Object.freeze(['ORGANIZATION','RESOURCE']), sensitive: false, sodRule: null, auditEvent: 'DOCUMENT_ACCESS_CAPABILITY_ISSUED' })
  ]) : Object.freeze([]);
  const scopePermissions = ['f13p1','f13'].includes(catalogVersion) ? Object.freeze([
    Object.freeze({ code:'organizational_scope.read', scopes:Object.freeze(['ORGANIZATION','UNIT','TEAM']), sensitive:false, sodRule:null, auditEvent:'AUTHORIZATION_DENIED' }),
    Object.freeze({ code:'organizational_scope.create', scopes:Object.freeze(['ORGANIZATION','UNIT']), sensitive:false, sodRule:null, auditEvent:'ORGANIZATIONAL_SCOPE_CREATED' }),
    Object.freeze({ code:'organizational_scope.rename', scopes:Object.freeze(['ORGANIZATION','UNIT','TEAM']), sensitive:false, sodRule:null, auditEvent:'ORGANIZATIONAL_SCOPE_RENAMED' }),
    Object.freeze({ code:'organizational_scope.reparent', scopes:Object.freeze(['ORGANIZATION','UNIT','TEAM']), sensitive:false, sodRule:null, auditEvent:'ORGANIZATIONAL_SCOPE_REPARENTED' }),
    Object.freeze({ code:'organizational_scope.archive', scopes:Object.freeze(['UNIT','TEAM']), sensitive:true, sodRule:'ORGANIZATIONAL_SCOPE_ARCHIVE_SOD', auditEvent:'ORGANIZATIONAL_SCOPE_ARCHIVED' })
  ]) : Object.freeze([]);
  const taxonomyPermissions = catalogVersion === 'f13' ? Object.freeze([
    Object.freeze({ code:'profile_taxonomy.read', scopes:Object.freeze(['ORGANIZATION','UNIT','TEAM']), sensitive:false, sodRule:null, auditEvent:'TAXONOMY_ACCESSED' }),
    Object.freeze({ code:'profile_taxonomy.release.create', scopes:Object.freeze(['ORGANIZATION']), sensitive:false, sodRule:null, auditEvent:'TAXONOMY_RELEASE_CREATED' }),
    Object.freeze({ code:'profile_taxonomy.local_concept.create', scopes:Object.freeze(['ORGANIZATION']), sensitive:false, sodRule:null, auditEvent:'TAXONOMY_LOCAL_CONCEPT_CREATED' }),
    Object.freeze({ code:'profile_taxonomy.local_concept.approve', scopes:Object.freeze(['ORGANIZATION']), sensitive:true, sodRule:'F13_TAXONOMY_CONCEPT_SOD', auditEvent:'TAXONOMY_LOCAL_CONCEPT_APPROVED' }),
    Object.freeze({ code:'profile_taxonomy.relation.create', scopes:Object.freeze(['ORGANIZATION']), sensitive:false, sodRule:null, auditEvent:'TAXONOMY_RELATION_CREATED' }),
    Object.freeze({ code:'profile_taxonomy.mapping.create', scopes:Object.freeze(['ORGANIZATION']), sensitive:false, sodRule:null, auditEvent:'TAXONOMY_MAPPING_CREATED' }),
    Object.freeze({ code:'profile_taxonomy.release.publish', scopes:Object.freeze(['ORGANIZATION']), sensitive:true, sodRule:'F13_TAXONOMY_RELEASE_SOD', auditEvent:'TAXONOMY_RELEASE_PUBLISHED' })
  ]) : Object.freeze([]);
  const authoringPermissions=catalogVersion==='f13'?Object.freeze([
    Object.freeze({code:'organization_profile.read',scopes:Object.freeze(['ORGANIZATION','UNIT','TEAM']),sensitive:false,sodRule:null,auditEvent:'PROFILE_ACCESSED'}),
    Object.freeze({code:'organization_profile.approve',scopes:Object.freeze(['ORGANIZATION','UNIT','TEAM']),sensitive:true,sodRule:'F13_PROFILE_APPROVAL_SOD',auditEvent:'PROFILE_VERSION_APPROVED'}),
    Object.freeze({code:'organization_profile.activate',scopes:Object.freeze(['ORGANIZATION']),sensitive:true,sodRule:'F13_PROFILE_ACTIVATION_SOD',auditEvent:'PROFILE_COHORT_ACTIVATED'}),
    Object.freeze({code:'prequalification.evaluate',scopes:Object.freeze(['ORGANIZATION']),sensitive:false,sodRule:null,auditEvent:'PREQUALIFICATION_EVALUATED'}),
    Object.freeze({code:'prequalification.decide',scopes:Object.freeze(['ORGANIZATION']),sensitive:false,sodRule:null,auditEvent:'PREQUALIFICATION_DECIDED'}),
    Object.freeze({code:'prequalification.read',scopes:Object.freeze(['ORGANIZATION']),sensitive:false,sodRule:null,auditEvent:'PREQUALIFICATION_ACCESSED'}),
    Object.freeze({code:'organization_profile.publish',scopes:Object.freeze(['ORGANIZATION','UNIT','TEAM']),sensitive:true,sodRule:'F13_PROFILE_PUBLICATION_SOD',auditEvent:'PROFILE_VERSION_PUBLISHED'}),
    Object.freeze({code:'organization_profile.draft.create',scopes:Object.freeze(['ORGANIZATION','UNIT','TEAM']),sensitive:false,sodRule:null,auditEvent:'PROFILE_DRAFT_CREATED'}),
    Object.freeze({code:'organization_profile.draft.edit',scopes:Object.freeze(['ORGANIZATION','UNIT','TEAM']),sensitive:false,sodRule:null,auditEvent:'PROFILE_DRAFT_REVISION_CREATED'}),
    Object.freeze({code:'organization_profile.submit',scopes:Object.freeze(['ORGANIZATION','UNIT','TEAM']),sensitive:false,sodRule:null,auditEvent:'PROFILE_DRAFT_SUBMITTED'}),
    Object.freeze({code:'profile_evidence.attach',scopes:Object.freeze(['ORGANIZATION','UNIT','TEAM']),sensitive:false,sodRule:null,auditEvent:'EVIDENCE_ATTACHED'}),
    Object.freeze({code:'profile_evidence.link.read',scopes:Object.freeze(['ORGANIZATION','UNIT','TEAM']),sensitive:false,sodRule:null,auditEvent:'EVIDENCE_LINK_ACCESSED'}),
    Object.freeze({code:'profile_assertion.revoke',scopes:Object.freeze(['ORGANIZATION','UNIT','TEAM']),sensitive:true,sodRule:'F13_COMPETENCY_VERIFICATION_SOD',auditEvent:'ASSERTION_REVOKED'}),
    Object.freeze({code:'profile_competency.verify',scopes:Object.freeze(['ORGANIZATION','UNIT','TEAM']),sensitive:true,sodRule:'F13_COMPETENCY_VERIFICATION_SOD',auditEvent:'COMPETENCY_ASSERTION_VERIFIED'})
  ]):Object.freeze([]);
  const financialPermissions=catalogVersion==='f13'?Object.freeze([
    Object.freeze({code:'profile_financial.create',scopes:Object.freeze(['ORGANIZATION']),sensitive:false,sodRule:null,auditEvent:'FINANCIAL_ASSERTION_CREATED'}),
    Object.freeze({code:'profile_financial.edit',scopes:Object.freeze(['ORGANIZATION']),sensitive:false,sodRule:null,auditEvent:'FINANCIAL_ASSERTION_EDITED'}),
    Object.freeze({code:'profile_financial.read',scopes:Object.freeze(['ORGANIZATION']),sensitive:true,sodRule:null,auditEvent:'FINANCIAL_ASSERTION_READ'}),
    Object.freeze({code:'profile_financial.submit',scopes:Object.freeze(['ORGANIZATION']),sensitive:false,sodRule:null,auditEvent:'FINANCIAL_ASSERTION_SUBMITTED'}),
    Object.freeze({code:'profile_financial.verify',scopes:Object.freeze(['ORGANIZATION']),sensitive:true,sodRule:'F13_FINANCIAL_VERIFICATION_SOD',auditEvent:'FINANCIAL_FACT_VERIFIED'}),
    Object.freeze({code:'profile_financial.reject',scopes:Object.freeze(['ORGANIZATION']),sensitive:true,sodRule:'F13_FINANCIAL_VERIFICATION_SOD',auditEvent:'FINANCIAL_ASSERTION_REJECTED'}),
    Object.freeze({code:'profile_financial.dispute',scopes:Object.freeze(['ORGANIZATION']),sensitive:true,sodRule:null,auditEvent:'FINANCIAL_ASSERTION_DISPUTED'}),
    Object.freeze({code:'profile_financial.revoke',scopes:Object.freeze(['ORGANIZATION']),sensitive:true,sodRule:null,auditEvent:'FINANCIAL_ASSERTION_REVOKED'}),
  ]):Object.freeze([]);
  const operationalPermissions=catalogVersion==='f13'?Object.freeze([
    Object.freeze({code:'profile_operational.create',scopes:Object.freeze(['ORGANIZATION']),sensitive:false,sodRule:null,auditEvent:'OPERATIONAL_ASSERTION_CREATED'}),
    Object.freeze({code:'profile_operational.edit',scopes:Object.freeze(['ORGANIZATION']),sensitive:false,sodRule:null,auditEvent:'OPERATIONAL_ASSERTION_EDITED'}),
    Object.freeze({code:'profile_operational.read',scopes:Object.freeze(['ORGANIZATION']),sensitive:true,sodRule:null,auditEvent:'OPERATIONAL_ASSERTION_READ'}),
    Object.freeze({code:'profile_operational.submit',scopes:Object.freeze(['ORGANIZATION']),sensitive:false,sodRule:null,auditEvent:'OPERATIONAL_ASSERTION_SUBMITTED'}),
    Object.freeze({code:'profile_operational.verify',scopes:Object.freeze(['ORGANIZATION']),sensitive:true,sodRule:'F13_OPERATIONAL_VERIFICATION_SOD',auditEvent:'OPERATIONAL_ASSERTION_VERIFIED'}),
    Object.freeze({code:'profile_operational.reject',scopes:Object.freeze(['ORGANIZATION']),sensitive:true,sodRule:'F13_OPERATIONAL_VERIFICATION_SOD',auditEvent:'OPERATIONAL_ASSERTION_REJECTED'}),
    Object.freeze({code:'profile_operational.dispute',scopes:Object.freeze(['ORGANIZATION']),sensitive:true,sodRule:null,auditEvent:'OPERATIONAL_ASSERTION_DISPUTED'}),
    Object.freeze({code:'profile_operational.revoke',scopes:Object.freeze(['ORGANIZATION']),sensitive:true,sodRule:'F13_OPERATIONAL_VERIFICATION_SOD',auditEvent:'OPERATIONAL_ASSERTION_REVOKED'}),
  ]):Object.freeze([]);
  const populationPermissions=catalogVersion==='f13'?Object.freeze([
    Object.freeze({code:'profile_population.create',scopes:Object.freeze(['ORGANIZATION']),sensitive:false,sodRule:null,auditEvent:'POPULATION_ASSERTION_CREATED'}),
    Object.freeze({code:'profile_population.edit',scopes:Object.freeze(['ORGANIZATION']),sensitive:false,sodRule:null,auditEvent:'POPULATION_ASSERTION_EDITED'}),
    Object.freeze({code:'profile_population.read',scopes:Object.freeze(['ORGANIZATION']),sensitive:true,sodRule:null,auditEvent:'POPULATION_ASSERTION_READ'}),
    Object.freeze({code:'profile_population.submit',scopes:Object.freeze(['ORGANIZATION']),sensitive:false,sodRule:null,auditEvent:'POPULATION_ASSERTION_SUBMITTED'}),
    Object.freeze({code:'profile_population.verify',scopes:Object.freeze(['ORGANIZATION']),sensitive:true,sodRule:'F13_POPULATION_VERIFICATION_SOD',auditEvent:'POPULATION_ASSERTION_VERIFIED'}),
    Object.freeze({code:'profile_population.reject',scopes:Object.freeze(['ORGANIZATION']),sensitive:true,sodRule:'F13_POPULATION_VERIFICATION_SOD',auditEvent:'POPULATION_ASSERTION_REJECTED'}),
    Object.freeze({code:'profile_population.dispute',scopes:Object.freeze(['ORGANIZATION']),sensitive:true,sodRule:null,auditEvent:'POPULATION_ASSERTION_DISPUTED'}),
    Object.freeze({code:'profile_population.revoke',scopes:Object.freeze(['ORGANIZATION']),sensitive:true,sodRule:'F13_POPULATION_VERIFICATION_SOD',auditEvent:'POPULATION_ASSERTION_REVOKED'}),
  ]):Object.freeze([]);
  const applicationPermissions=catalogVersion==='f13'?Object.freeze([
    ...['read','register','manage'].map(action=>Object.freeze({code:`opportunity_interest.${action}`,scopes:Object.freeze(['ORGANIZATION','RESOURCE']),sensitive:false,sodRule:null,auditEvent:'AUTHORIZATION_ALLOWED'})),
    ...['read','create','edit','transition'].map(action=>Object.freeze({code:`application.${action}`,scopes:Object.freeze(['ORGANIZATION','RESOURCE']),sensitive:false,sodRule:null,auditEvent:action==='create'?'APPLICATION_CREATED':action==='transition'?'APPLICATION_STAGE_CHANGED':'APPLICATION_CHANGED'})),
    // Normal session assurance; the repository still requires distinct requester and reviewer.
    Object.freeze({code:'application.review.decide',scopes:Object.freeze(['ORGANIZATION','RESOURCE']),sensitive:false,sodRule:null,auditEvent:'APPLICATION_CHANGED'})
  ]):Object.freeze([]);
  const directoryPermissions=catalogVersion==='f13'?['read','edit'].map(action=>Object.freeze({code:`organization_directory.${action}`,scopes:Object.freeze(['ORGANIZATION']),sensitive:false,sodRule:null,auditEvent:'AUTHORIZATION_DENIED'})):[];
  const noticePermissions=catalogVersion==='f13'?['notification.read','organization_notice.manage'].map(code=>Object.freeze({code,scopes:Object.freeze(['ORGANIZATION']),sensitive:false,sodRule:null,auditEvent:'AUTHORIZATION_ALLOWED'})):[];
  const permissions = Object.freeze([...(catalogVersion==='f13'?[Object.freeze({code:'billing.read',scopes:Object.freeze(['ORGANIZATION']),sensitive:false,sodRule:null,auditEvent:'AUTHORIZATION_ALLOWED'})]:[]),...noticePermissions,...auditPermissions, ...documentPermissions, ...opportunityPermissions, ...scopePermissions, ...taxonomyPermissions,...authoringPermissions,...financialPermissions,...operationalPermissions,...populationPermissions,...applicationPermissions,...directoryPermissions,...(catalogVersion==='f13'?[Object.freeze({code:'organization_membership.read',scopes:Object.freeze(['ORGANIZATION']),sensitive:false,sodRule:null,auditEvent:'AUTHORIZATION_ALLOWED'}),Object.freeze({code:'organization_membership.manage',scopes:Object.freeze(['ORGANIZATION']),sensitive:true,sodRule:null,auditEvent:'GRANT_CHANGED'})]:[]),...(catalogVersion==='f13'?['read','edit'].map(action=>Object.freeze({code:`personal_profile.${action}`,scopes:Object.freeze(['ORGANIZATION']),sensitive:false,sodRule:null,auditEvent:'AUTHORIZATION_DENIED'})):[])]);
  const permissionCatalog = createPermissionCatalog(Object.freeze({
    version: catalogVersion === 'f13' ? 'f13-taxonomy-permissions-v1' : catalogVersion === 'f13p1' ? 'f13-p1-permissions-v1' : catalogVersion === 'f12' ? 'f12-opportunity-permissions-v1' : catalogVersion === 'f11' ? 'f11-document-permissions-v3' : catalogVersion === 'f7' ? 'f7-audit-permissions-v2' : 'f5-permissions-v1', permissions
  }));
  const profileCatalog = createProfileCatalog(Object.freeze({
    version: 'f5-profiles-v1',
    profiles: Object.freeze(PROFILE_CODES.map(code => Object.freeze({ code, permissions: Object.freeze([]) })))
  }), permissionCatalog);
  const operationCatalog = createOperationCatalog(Object.freeze({
    version: catalogVersion === 'f13' ? 'f13-taxonomy-operations-v1' : catalogVersion === 'f13p1' ? 'f13-p1-operations-v1' : catalogVersion === 'f12' ? 'f12-opportunity-operations-v1' : catalogVersion === 'f11' ? 'f11-document-operations-v3' : catalogVersion === 'f7' ? 'f7-audit-operations-v2' : 'f5-operations-v1', operations: ['f7', 'f11', 'f12', 'f13p1', 'f13'].includes(catalogVersion) ? Object.freeze([
      Object.freeze({ code: 'AUDIT_EVENT_READ', permission: 'audit_event.read', resourceType: 'AUDIT_EVENT', effect: 'READ', auditEvent: 'SENSITIVE_ACTION_ALLOWED' }),
      Object.freeze({ code: 'AUDIT_EVENT_VERIFY', permission: 'audit_event.verify', resourceType: 'AUDIT_STREAM', effect: 'READ', auditEvent: 'SENSITIVE_ACTION_ALLOWED' }),
      Object.freeze({ code: 'AUDIT_EVENT_EXPORT', permission: 'audit_event.export', resourceType: 'AUDIT_EXPORT', effect: 'READ', auditEvent: 'EXPORT_ALLOWED' }),
      Object.freeze({ code: 'AUDIT_EVENT_READ_CROSS_ORGANIZATION', permission: 'audit_event.read_cross_organization', resourceType: 'AUDIT_EVENT', effect: 'READ', auditEvent: 'SENSITIVE_ACTION_ALLOWED' }),
      ...(['f11', 'f12', 'f13p1', 'f13'].includes(catalogVersion) ? [
        Object.freeze({ code: 'DOCUMENT_UPLOAD_INITIATE', permission: 'document.upload.initiate', resourceType: 'DOCUMENT', effect: 'WRITE', auditEvent: 'DOCUMENT_UPLOAD_INTENT_ACCEPTED' }),
        Object.freeze({ code: 'DOCUMENT_UPLOAD_CONFIRM', permission: 'document.upload.confirm', resourceType: 'DOCUMENT_VERSION', effect: 'WRITE', auditEvent: 'DOCUMENT_UPLOAD_CONFIRMED' }),
        Object.freeze({ code: 'DOCUMENT_READ', permission: 'document.read', resourceType: 'DOCUMENT', effect: 'READ', auditEvent: 'DOCUMENT_ACCESS_CAPABILITY_ISSUED' }),
        Object.freeze({ code: 'DOCUMENT_VERSION_CREATE', permission: 'document.version.create', resourceType: 'DOCUMENT', effect: 'WRITE', auditEvent: 'DOCUMENT_VERSION_CREATED' }),
        Object.freeze({ code: 'DOCUMENT_VERSION_LIST', permission: 'document.version.list', resourceType: 'DOCUMENT', effect: 'READ', auditEvent: 'DOCUMENT_ACCESS_CAPABILITY_ISSUED' }),
        Object.freeze({ code: 'DOCUMENT_DOWNLOAD_REQUEST', permission: 'document.download.request', resourceType: 'DOCUMENT_VERSION', effect: 'READ', auditEvent: 'DOCUMENT_ACCESS_CAPABILITY_ISSUED' }),
        Object.freeze({ code: 'DOCUMENT_QUARANTINE_MANAGE', permission: 'document.quarantine.manage', resourceType: 'DOCUMENT_VERSION', effect: 'WRITE', auditEvent: 'DOCUMENT_LIFECYCLE_REQUESTED' })
      ] : []),
      ...(['f12','f13p1','f13'].includes(catalogVersion) ? [
        Object.freeze({ code: 'ASYNC_JOB_REPLAY', permission: 'async_job.replay', resourceType: 'ASYNC_EXECUTION', effect: 'WRITE', auditEvent: 'ASYNC_REPLAY_REQUESTED' }),
        Object.freeze({ code: 'ASYNC_JOB_REPLAY_APPROVE', permission: 'async_job.replay_approve', resourceType: 'ASYNC_EXECUTION', effect: 'WRITE', auditEvent: 'ASYNC_REPLAY_APPROVED' }),
        ...['READ','EDIT','CONFIRM'].map(action=>Object.freeze({code:'OPPORTUNITY_CRITERIA_'+action,permission:'opportunity.criteria.'+action.toLowerCase(),resourceType:action==='CONFIRM'?'OPPORTUNITY_CRITERIA_REVISION':'OPPORTUNITY_CRITERIA_SET',effect:action==='READ'?'READ':'WRITE',auditEvent:'OPPORTUNITY_ACCESS_DENIED'})),
        Object.freeze({ code: 'OPPORTUNITY_READ', permission: 'opportunity.read', resourceType: 'OPPORTUNITY', effect: 'READ', auditEvent: 'OPPORTUNITY_ACCESS_DENIED' }),
        Object.freeze({ code: 'OPPORTUNITY_PRIVATE_CREATE', permission: 'opportunity.private.create', resourceType: 'OPPORTUNITY', effect: 'WRITE', auditEvent: 'OPPORTUNITY_CREATED' }),
        Object.freeze({ code: 'OPPORTUNITY_PRIVATE_UPDATE', permission: 'opportunity.private.update', resourceType: 'OPPORTUNITY', effect: 'WRITE', auditEvent: 'OPPORTUNITY_REVISION_CREATED' }),
        Object.freeze({ code: 'OPPORTUNITY_ARCHIVE', permission: 'opportunity.archive', resourceType: 'OPPORTUNITY', effect: 'WRITE', auditEvent: 'OPPORTUNITY_ARCHIVED' }),
        Object.freeze({ code: 'OPPORTUNITY_RESTORE', permission: 'opportunity.restore', resourceType: 'OPPORTUNITY', effect: 'WRITE', auditEvent: 'OPPORTUNITY_RESTORED' }),
        Object.freeze({ code: 'OPPORTUNITY_DUPLICATE_REVIEW', permission: 'opportunity.duplicate.review', resourceType: 'OPPORTUNITY_DUPLICATE', effect: 'WRITE', auditEvent: 'OPPORTUNITY_DUPLICATE_DECISION_RECORDED' }),
        Object.freeze({ code: 'OPPORTUNITY_DUPLICATE_SCAN_JOB', permission: 'opportunity.duplicate.scan', resourceType: 'OPPORTUNITY', effect: 'WRITE', auditEvent: 'SERVICE_JOB_DISPATCHED' }),
        Object.freeze({ code: 'OPPORTUNITY_CATALOG_RECONCILE_JOB', permission: 'opportunity.catalog.reconcile', resourceType: 'OPPORTUNITY', effect: 'WRITE', auditEvent: 'SERVICE_JOB_DISPATCHED' }),
        Object.freeze({ code: 'OPPORTUNITY_CENTRAL_MANAGE', permission: 'opportunity.central.manage', resourceType: 'OPPORTUNITY', effect: 'WRITE', auditEvent: 'OPPORTUNITY_REVISION_CREATED' })
        ,Object.freeze({ code: 'OPPORTUNITY_IMPORT_UPLOAD', permission: 'opportunity_import.upload', resourceType: 'OPPORTUNITY_IMPORT', effect: 'WRITE', auditEvent: 'OPPORTUNITY_IMPORT_UPLOADED' })
        ,Object.freeze({ code: 'OPPORTUNITY_IMPORT_PREVIEW', permission: 'opportunity_import.preview', resourceType: 'OPPORTUNITY_IMPORT', effect: 'WRITE', auditEvent: 'OPPORTUNITY_IMPORT_UPLOADED' })
        ,Object.freeze({ code: 'OPPORTUNITY_IMPORT_CONFIRM', permission: 'opportunity_import.confirm', resourceType: 'OPPORTUNITY_IMPORT', effect: 'WRITE', auditEvent: 'OPPORTUNITY_IMPORT_CONFIRMED' })
        ,Object.freeze({ code: 'OPPORTUNITY_IMPORT_READ', permission: 'opportunity_import.read', resourceType: 'OPPORTUNITY_IMPORT', effect: 'READ', auditEvent: 'OPPORTUNITY_IMPORT_UPLOADED' })
        ,Object.freeze({ code: 'OPPORTUNITY_IMPORT_CANCEL', permission: 'opportunity_import.cancel', resourceType: 'OPPORTUNITY_IMPORT', effect: 'WRITE', auditEvent: 'OPPORTUNITY_IMPORT_CANCELLED' })
        ,Object.freeze({ code: 'OPPORTUNITY_IMPORT_REVIEW', permission: 'opportunity_import.review', resourceType: 'OPPORTUNITY_IMPORT_ROW', effect: 'WRITE', auditEvent: 'OPPORTUNITY_IMPORT_POSSIBLE_REVIEWED' })
        ,Object.freeze({ code: 'OPPORTUNITY_IMPORT_DOWNLOAD_REPORT', permission: 'opportunity_import.download_report', resourceType: 'OPPORTUNITY_IMPORT_REPORT', effect: 'READ', auditEvent: 'DOCUMENT_ACCESS_CAPABILITY_ISSUED' })
      ] : []),
      ...(['f13p1','f13'].includes(catalogVersion) ? [
        Object.freeze({code:'ORGANIZATIONAL_SCOPE_READ',permission:'organizational_scope.read',resourceType:'ORGANIZATIONAL_SCOPE',effect:'READ',auditEvent:'AUTHORIZATION_DENIED'}),
        Object.freeze({code:'ORGANIZATIONAL_SCOPE_CREATE',permission:'organizational_scope.create',resourceType:'ORGANIZATION',effect:'WRITE',auditEvent:'AUTHORIZATION_ALLOWED'}),
        Object.freeze({code:'ORGANIZATIONAL_SCOPE_RENAME',permission:'organizational_scope.rename',resourceType:'ORGANIZATIONAL_SCOPE',effect:'WRITE',auditEvent:'AUTHORIZATION_ALLOWED'}),
        Object.freeze({code:'ORGANIZATIONAL_SCOPE_REPARENT',permission:'organizational_scope.reparent',resourceType:'ORGANIZATIONAL_SCOPE',effect:'WRITE',auditEvent:'AUTHORIZATION_ALLOWED'}),
        Object.freeze({code:'ORGANIZATIONAL_SCOPE_ARCHIVE',permission:'organizational_scope.archive',resourceType:'ORGANIZATIONAL_SCOPE',effect:'WRITE',auditEvent:'SENSITIVE_ACTION_ALLOWED'})
      ] : []),
      ...(catalogVersion === 'f13' ? [
        ...['READ','ACK','SYNC'].map(action=>Object.freeze({code:`NOTIFICATION_${action}`,permission:'notification.read',resourceType:'NOTIFICATION_INBOX',effect:action==='READ'?'READ':'WRITE',auditEvent:'AUTHORIZATION_ALLOWED'})),
        ...['READ','SEND'].map(action=>Object.freeze({code:`ORGANIZATION_NOTICE_${action}`,permission:'organization_notice.manage',resourceType:'ORGANIZATION_NOTICE',effect:action==='READ'?'READ':'WRITE',auditEvent:'AUTHORIZATION_ALLOWED'})),
        Object.freeze({code:'CUSTOMER_BILLING_READ',permission:'billing.read',resourceType:'ORGANIZATION',effect:'READ',auditEvent:'AUTHORIZATION_ALLOWED'}),
        Object.freeze({code:'ORGANIZATION_MEMBERSHIP_READ',permission:'organization_membership.read',resourceType:'ORGANIZATION',effect:'READ',auditEvent:'AUTHORIZATION_ALLOWED'}),
        Object.freeze({code:'ORGANIZATION_MEMBERSHIP_MANAGE',permission:'organization_membership.manage',resourceType:'ORGANIZATION',effect:'WRITE',auditEvent:'GRANT_CHANGED'}),
        ...['READ','EDIT'].map(action=>Object.freeze({code:`PERSONAL_PROFILE_${action}`,permission:`personal_profile.${action.toLowerCase()}`,resourceType:'ORGANIZATION',effect:action==='READ'?'READ':'WRITE',auditEvent:'AUTHORIZATION_ALLOWED'})),
        ...['READ','EDIT'].map(action=>Object.freeze({code:`ORGANIZATION_DIRECTORY_${action}`,permission:`organization_directory.${action.toLowerCase()}`,resourceType:'ORGANIZATION',effect:action==='READ'?'READ':'WRITE',auditEvent:'AUTHORIZATION_ALLOWED'})),
        ...['READ','REGISTER','MANAGE'].map(action=>Object.freeze({code:`OPPORTUNITY_INTEREST_${action}`,permission:`opportunity_interest.${action.toLowerCase()}`,resourceType:'OPPORTUNITY_INTEREST',effect:action==='READ'?'READ':'WRITE',auditEvent:'AUTHORIZATION_ALLOWED'})),
        ...['READ','CREATE','EDIT','TRANSITION'].map(action=>Object.freeze({code:`APPLICATION_${action}`,permission:`application.${action.toLowerCase()}`,resourceType:'APPLICATION',effect:action==='READ'?'READ':'WRITE',auditEvent:action==='CREATE'?'APPLICATION_CREATED':action==='TRANSITION'?'APPLICATION_STAGE_CHANGED':'APPLICATION_CHANGED'})),
        ...['READ','ACK','SYNC'].map(action=>Object.freeze({code:`APPLICATION_ALERT_${action}`,permission:'application.read',resourceType:'APPLICATION',effect:action==='READ'?'READ':'WRITE',auditEvent:'APPLICATION_ALERT_READ'})),
        Object.freeze({code:'APPLICATION_WORK_READ',permission:'application.read',resourceType:'APPLICATION',effect:'READ',auditEvent:'APPLICATION_CHANGED'}),
        Object.freeze({code:'APPLICATION_WORK_EDIT',permission:'application.edit',resourceType:'APPLICATION',effect:'WRITE',auditEvent:'APPLICATION_CHANGED'}),
        Object.freeze({code:'APPLICATION_CHAT_READ',permission:'application.read',resourceType:'APPLICATION',effect:'READ',auditEvent:'APPLICATION_CHANGED'}),
        Object.freeze({code:'APPLICATION_CHAT_SEND',permission:'application.read',resourceType:'APPLICATION',effect:'WRITE',auditEvent:'APPLICATION_CHANGED'}),
        Object.freeze({code:'APPLICATION_DOCUMENT_READ',permission:'application.read',resourceType:'APPLICATION',effect:'READ',auditEvent:'APPLICATION_CHANGED'}),
        Object.freeze({code:'APPLICATION_DOCUMENT_EDIT',permission:'application.edit',resourceType:'APPLICATION',effect:'WRITE',auditEvent:'APPLICATION_CHANGED'}),
        Object.freeze({code:'APPLICATION_REVIEW_DECIDE',permission:'application.review.decide',resourceType:'APPLICATION',effect:'WRITE',auditEvent:'APPLICATION_CHANGED'}),
        Object.freeze({code:'F13_FINANCIAL_CREATE',permission:'profile_financial.create',resourceType:'FINANCIAL_SCOPE',effect:'WRITE',auditEvent:'FINANCIAL_ASSERTION_CREATED'}),
        Object.freeze({code:'F13_OPERATIONAL_CREATE',permission:'profile_operational.create',resourceType:'OPERATIONAL_SCOPE',effect:'WRITE',auditEvent:'OPERATIONAL_ASSERTION_CREATED'}),
        Object.freeze({code:'F13_OPERATIONAL_EDIT',permission:'profile_operational.edit',resourceType:'OPERATIONAL_ASSERTION',effect:'WRITE',auditEvent:'OPERATIONAL_ASSERTION_EDITED'}),
        Object.freeze({code:'F13_OPERATIONAL_READ',permission:'profile_operational.read',resourceType:'OPERATIONAL_ASSERTION',effect:'READ',auditEvent:'OPERATIONAL_ASSERTION_READ'}),
        Object.freeze({code:'F13_OPERATIONAL_SUBMIT',permission:'profile_operational.submit',resourceType:'OPERATIONAL_ASSERTION',effect:'WRITE',auditEvent:'OPERATIONAL_ASSERTION_SUBMITTED'}),
        Object.freeze({code:'F13_OPERATIONAL_VERIFY',permission:'profile_operational.verify',resourceType:'OPERATIONAL_ASSERTION',effect:'WRITE',auditEvent:'OPERATIONAL_ASSERTION_VERIFIED'}),
        Object.freeze({code:'F13_OPERATIONAL_REJECT',permission:'profile_operational.reject',resourceType:'OPERATIONAL_ASSERTION',effect:'WRITE',auditEvent:'OPERATIONAL_ASSERTION_REJECTED'}),
        Object.freeze({code:'F13_OPERATIONAL_DISPUTE',permission:'profile_operational.dispute',resourceType:'OPERATIONAL_ASSERTION',effect:'WRITE',auditEvent:'OPERATIONAL_ASSERTION_DISPUTED'}),
        Object.freeze({code:'F13_OPERATIONAL_REVOKE',permission:'profile_operational.revoke',resourceType:'OPERATIONAL_ASSERTION',effect:'WRITE',auditEvent:'OPERATIONAL_ASSERTION_REVOKED'}),
        Object.freeze({code:'F13_POPULATION_CREATE',permission:'profile_population.create',resourceType:'POPULATION_SCOPE',effect:'WRITE',auditEvent:'POPULATION_ASSERTION_CREATED'}),
        Object.freeze({code:'F13_POPULATION_EDIT',permission:'profile_population.edit',resourceType:'POPULATION_ASSERTION',effect:'WRITE',auditEvent:'POPULATION_ASSERTION_EDITED'}),
        Object.freeze({code:'F13_POPULATION_READ',permission:'profile_population.read',resourceType:'POPULATION_ASSERTION',effect:'READ',auditEvent:'POPULATION_ASSERTION_READ'}),
        Object.freeze({code:'F13_POPULATION_SUBMIT',permission:'profile_population.submit',resourceType:'POPULATION_ASSERTION',effect:'WRITE',auditEvent:'POPULATION_ASSERTION_SUBMITTED'}),
        Object.freeze({code:'F13_POPULATION_VERIFY',permission:'profile_population.verify',resourceType:'POPULATION_ASSERTION',effect:'WRITE',auditEvent:'POPULATION_ASSERTION_VERIFIED'}),
        Object.freeze({code:'F13_POPULATION_REJECT',permission:'profile_population.reject',resourceType:'POPULATION_ASSERTION',effect:'WRITE',auditEvent:'POPULATION_ASSERTION_REJECTED'}),
        Object.freeze({code:'F13_POPULATION_DISPUTE',permission:'profile_population.dispute',resourceType:'POPULATION_ASSERTION',effect:'WRITE',auditEvent:'POPULATION_ASSERTION_DISPUTED'}),
        Object.freeze({code:'F13_POPULATION_REVOKE',permission:'profile_population.revoke',resourceType:'POPULATION_ASSERTION',effect:'WRITE',auditEvent:'POPULATION_ASSERTION_REVOKED'}),
        Object.freeze({code:'F13_FINANCIAL_EDIT',permission:'profile_financial.edit',resourceType:'FINANCIAL_FACT',effect:'WRITE',auditEvent:'FINANCIAL_ASSERTION_EDITED'}),
        Object.freeze({code:'F13_FINANCIAL_READ',permission:'profile_financial.read',resourceType:'FINANCIAL_FACT',effect:'READ',auditEvent:'FINANCIAL_ASSERTION_READ'}),
        Object.freeze({code:'F13_FINANCIAL_SUBMIT',permission:'profile_financial.submit',resourceType:'FINANCIAL_FACT',effect:'WRITE',auditEvent:'FINANCIAL_ASSERTION_SUBMITTED'}),
        Object.freeze({code:'F13_FINANCIAL_VERIFY',permission:'profile_financial.verify',resourceType:'FINANCIAL_FACT',effect:'WRITE',auditEvent:'FINANCIAL_FACT_VERIFIED'}),
        Object.freeze({code:'F13_FINANCIAL_REJECT',permission:'profile_financial.reject',resourceType:'FINANCIAL_FACT',effect:'WRITE',auditEvent:'FINANCIAL_ASSERTION_REJECTED'}),
        Object.freeze({code:'F13_FINANCIAL_DISPUTE',permission:'profile_financial.dispute',resourceType:'FINANCIAL_FACT',effect:'WRITE',auditEvent:'FINANCIAL_ASSERTION_DISPUTED'}),
        Object.freeze({code:'F13_FINANCIAL_REVOKE',permission:'profile_financial.revoke',resourceType:'FINANCIAL_FACT',effect:'WRITE',auditEvent:'FINANCIAL_ASSERTION_REVOKED'}),
        Object.freeze({code:'F13_PROFILE_DRAFT_CREATE',permission:'organization_profile.draft.create',resourceType:'PROFILE_SCOPE',effect:'WRITE',auditEvent:'PROFILE_DRAFT_CREATED'}),
        Object.freeze({code:'F13_PROFILE_DRAFT_EDIT',permission:'organization_profile.draft.edit',resourceType:'PROFILE_DRAFT',effect:'WRITE',auditEvent:'PROFILE_DRAFT_REVISION_CREATED'}),
        Object.freeze({code:'F13_PROFILE_SUBMIT',permission:'organization_profile.submit',resourceType:'PROFILE_DRAFT',effect:'WRITE',auditEvent:'PROFILE_DRAFT_SUBMITTED'}),
        Object.freeze({code:'F13_PROFILE_APPROVE',permission:'organization_profile.approve',resourceType:'PROFILE_DRAFT_REVISION',effect:'WRITE',auditEvent:'PROFILE_VERSION_APPROVED'}),
        Object.freeze({code:'F13_PROFILE_COHORT_ACTIVATE',permission:'organization_profile.activate',resourceType:'PROFILE_ACTIVATION_COHORT',effect:'WRITE',auditEvent:'PROFILE_COHORT_ACTIVATED'}),
        Object.freeze({code:'F14_PREQUALIFICATION_EVALUATE',permission:'prequalification.evaluate',resourceType:'OPPORTUNITY',effect:'WRITE',auditEvent:'PREQUALIFICATION_EVALUATED'}),
        Object.freeze({code:'F14_PREQUALIFICATION_DECIDE',permission:'prequalification.decide',resourceType:'PREQUALIFICATION_EVALUATION',effect:'WRITE',auditEvent:'PREQUALIFICATION_DECIDED'}),
        Object.freeze({code:'F14_PREQUALIFICATION_READ',permission:'prequalification.read',resourceType:'PREQUALIFICATION_EVALUATION',effect:'READ',auditEvent:'PREQUALIFICATION_ACCESSED'}),
        Object.freeze({code:'F13_PROFILE_PUBLISH',permission:'organization_profile.publish',resourceType:'PROFILE_VERSION',effect:'WRITE',auditEvent:'PROFILE_VERSION_PUBLISHED'}),
        Object.freeze({code:'F13_PROFILE_READ',permission:'organization_profile.read',resourceType:'PROFILE_PROJECTION',effect:'READ',auditEvent:'PROFILE_ACCESSED'}),
        Object.freeze({code:'F13_COMPETENCY_DRAFT_EDIT',permission:'organization_profile.draft.edit',resourceType:'PROFILE_DRAFT',effect:'WRITE',auditEvent:'PROFILE_DRAFT_REVISION_CREATED'}),
        Object.freeze({code:'F13_EXPERIENCE_DRAFT_EDIT',permission:'organization_profile.draft.edit',resourceType:'PROFILE_DRAFT',effect:'WRITE',auditEvent:'PROFILE_DRAFT_REVISION_CREATED'}),
        Object.freeze({code:'F13_EVIDENCE_ATTACH',permission:'profile_evidence.attach',resourceType:'ASSERTION',effect:'WRITE',auditEvent:'EVIDENCE_ATTACHED'}),
        Object.freeze({code:'F13_ASSERTION_REVOKE',permission:'profile_assertion.revoke',resourceType:'ASSERTION',effect:'WRITE',auditEvent:'ASSERTION_REVOKED'}),
        Object.freeze({code:'F13_COMPETENCY_VERIFY',permission:'profile_competency.verify',resourceType:'COMPETENCY_ASSERTION',effect:'WRITE',auditEvent:'COMPETENCY_ASSERTION_VERIFIED'}),
        Object.freeze({code:'F13_EVIDENCE_LINK_READ',permission:'profile_evidence.link.read',resourceType:'EVIDENCE_LINK',effect:'READ',auditEvent:'EVIDENCE_LINK_ACCESSED'}),
        Object.freeze({code:'F13_TAXONOMY_READ',permission:'profile_taxonomy.read',resourceType:'TAXONOMY_RELEASE',effect:'READ',auditEvent:'TAXONOMY_ACCESSED'}),
        Object.freeze({code:'F13_TAXONOMY_RELEASE_CREATE',permission:'profile_taxonomy.release.create',resourceType:'TAXONOMY_RELEASE_DRAFT',effect:'WRITE',auditEvent:'TAXONOMY_RELEASE_CREATED'}),
        Object.freeze({code:'F13_TAXONOMY_LOCAL_CONCEPT_CREATE',permission:'profile_taxonomy.local_concept.create',resourceType:'LOCAL_CONCEPT_DRAFT',effect:'WRITE',auditEvent:'TAXONOMY_LOCAL_CONCEPT_CREATED'}),
        Object.freeze({code:'F13_TAXONOMY_LOCAL_CONCEPT_APPROVE',permission:'profile_taxonomy.local_concept.approve',resourceType:'LOCAL_CONCEPT_REVISION',effect:'WRITE',auditEvent:'TAXONOMY_LOCAL_CONCEPT_APPROVED'}),
        Object.freeze({code:'F13_TAXONOMY_RELATION_CREATE',permission:'profile_taxonomy.relation.create',resourceType:'TAXONOMY_RELATION',effect:'WRITE',auditEvent:'TAXONOMY_RELATION_CREATED'}),
        Object.freeze({code:'F13_TAXONOMY_MAPPING_CREATE',permission:'profile_taxonomy.mapping.create',resourceType:'TAXONOMY_MAPPING',effect:'WRITE',auditEvent:'TAXONOMY_MAPPING_CREATED'}),
        Object.freeze({code:'F13_TAXONOMY_RELEASE_PUBLISH',permission:'profile_taxonomy.release.publish',resourceType:'TAXONOMY_RELEASE',effect:'WRITE',auditEvent:'TAXONOMY_RELEASE_PUBLISHED'})
      ] : [])
    ]) : Object.freeze([])
  }), permissionCatalog);
  const serviceOperationCatalog = ['f12','f13p1','f13'].includes(catalogVersion) ? createServiceOperationCatalog(Object.freeze({version:'f12-service-operations-v1',bindings:Object.freeze([
    Object.freeze({operationCode:'OPPORTUNITY_DUPLICATE_SCAN_JOB',permission:'opportunity.duplicate.scan',serviceActorCode:'F12_DUPLICATE_SCANNER',jobType:'opportunity.duplicate.scan'}),
    Object.freeze({operationCode:'OPPORTUNITY_CATALOG_RECONCILE_JOB',permission:'opportunity.catalog.reconcile',serviceActorCode:'F12_CATALOG_RECONCILER',jobType:'opportunity.catalog.reconcile'})
  ])}),{operationCatalog,permissionCatalog}) : null;
  return Object.freeze({ permissionCatalog, profileCatalog, operationCatalog, serviceOperationCatalog });
}

module.exports = {
  PROFILE_CODES, SCOPE_TYPES, createOperationCatalog, createPermissionCatalog,
  createProductionCatalogs, createProfileCatalog, exactRecord
};
