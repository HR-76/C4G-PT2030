'use strict';

const { createAuthorizedTenantOperationCatalog } = require('../security/tenantOperationCatalog');

const VERSION = 'f12-tenant-operations-v2';
const SCHEMA_VERSION = '004_f12_opportunity_catalog';
const LINEAGE_SCHEMA_VERSION = '005_f9_execution_lineage';
const RECEIPT_SCHEMA_VERSION = '034_f12_service_receipt';
const ORGANIZATIONAL_SCOPE_SCHEMA_VERSION = '006_f13_p1_organizational_scope';
const PROFILE_SCHEMA_VERSION = '007_f13_profile_catalogs_and_policies';
const AUTHORING_SCHEMA_VERSION='008_f13_profile_authoring_and_assertions';
const TIMEOUT_MS = 5000;
const RESULT_BYTES = 1024 * 1024;

const DEFINITIONS = Object.freeze([
  Object.freeze({ operationCode: 'OPPORTUNITY_PRIVATE_CREATE', ownerModule: 'F12_OPPORTUNITY_APPLICATION',
    moduleCode: 'F12_PRIVATE_CREATE_QUERY', accessMode: 'WRITE', workload: 'API', workloadClass: 'FUNCTIONAL',
    capabilities: Object.freeze(['F12_PRIVATE_CATALOG_WRITE', 'F7_AUDIT_LEDGER']),
    requiredPermission: 'OPPORTUNITY_PRIVATE_CREATE', limits: Object.freeze({ maxPageSize: 1, maxRows: 1, maxBytes: RESULT_BYTES }) }),
  Object.freeze({ operationCode: 'OPPORTUNITY_PRIVATE_GET', ownerModule: 'F12_OPPORTUNITY_APPLICATION',
    moduleCode: 'F12_PRIVATE_GET_QUERY', accessMode: 'READ', workload: 'API', workloadClass: 'FUNCTIONAL',
    capabilities: Object.freeze(['F12_PRIVATE_CATALOG_READ']), requiredPermission: 'OPPORTUNITY_READ',
    limits: Object.freeze({ maxPageSize: 1, maxRows: 1, maxBytes: RESULT_BYTES }) }),
  Object.freeze({ operationCode: 'OPPORTUNITY_PRIVATE_LIST', ownerModule: 'F12_OPPORTUNITY_APPLICATION',
    moduleCode: 'F12_PRIVATE_LIST_QUERY', accessMode: 'READ', workload: 'API', workloadClass: 'FUNCTIONAL',
    capabilities: Object.freeze(['F12_PRIVATE_CATALOG_READ']), requiredPermission: 'OPPORTUNITY_READ',
    limits: Object.freeze({ maxPageSize: 100, maxRows: 100, maxBytes: RESULT_BYTES }) }),
  Object.freeze({ operationCode: 'OPPORTUNITY_PRIVATE_UPDATE', ownerModule: 'F12_OPPORTUNITY_APPLICATION',
    moduleCode: 'F12_PRIVATE_UPDATE_QUERY', accessMode: 'WRITE', workload: 'API', workloadClass: 'FUNCTIONAL',
    capabilities: Object.freeze(['F12_PRIVATE_CATALOG_WRITE', 'F7_AUDIT_LEDGER']),
    requiredPermission: 'OPPORTUNITY_PRIVATE_UPDATE', limits: Object.freeze({ maxPageSize: 1, maxRows: 1, maxBytes: RESULT_BYTES }) }),
  Object.freeze({ operationCode: 'OPPORTUNITY_PRIVATE_ARCHIVE', ownerModule: 'F12_OPPORTUNITY_APPLICATION',
    moduleCode: 'F12_PRIVATE_ARCHIVE_QUERY', accessMode: 'WRITE', workload: 'API', workloadClass: 'FUNCTIONAL',
    capabilities: Object.freeze(['F12_PRIVATE_CATALOG_WRITE', 'F7_AUDIT_LEDGER']),
    requiredPermission: 'OPPORTUNITY_ARCHIVE', limits: Object.freeze({ maxPageSize: 1, maxRows: 1, maxBytes: RESULT_BYTES }) }),
  Object.freeze({ operationCode: 'OPPORTUNITY_PRIVATE_RESTORE', ownerModule: 'F12_OPPORTUNITY_APPLICATION',
    moduleCode: 'F12_PRIVATE_RESTORE_QUERY', accessMode: 'WRITE', workload: 'API', workloadClass: 'FUNCTIONAL',
    capabilities: Object.freeze(['F12_PRIVATE_CATALOG_WRITE', 'F7_AUDIT_LEDGER']),
    requiredPermission: 'OPPORTUNITY_RESTORE', limits: Object.freeze({ maxPageSize: 1, maxRows: 1, maxBytes: RESULT_BYTES }) }),
  Object.freeze({ operationCode: 'OPPORTUNITY_DUPLICATE_REVIEW', ownerModule: 'F12_OPPORTUNITY_APPLICATION',
    moduleCode: 'F12_DUPLICATE_REVIEW_QUERY', accessMode: 'WRITE', workload: 'API', workloadClass: 'FUNCTIONAL',
    capabilities: Object.freeze(['F12_PRIVATE_CATALOG_READ', 'F12_PRIVATE_CATALOG_WRITE', 'F12_DEDUPLICATION', 'F7_AUDIT_LEDGER']),
    requiredPermission: 'OPPORTUNITY_DUPLICATE_REVIEW', limits: Object.freeze({ maxPageSize: 1, maxRows: 1, maxBytes: RESULT_BYTES }) }),
  Object.freeze({ operationCode: 'OPPORTUNITY_DUPLICATE_SCAN_JOB', ownerModule: 'F12_OPPORTUNITY_WORKER',
    moduleCode: 'F12_DUPLICATE_SCAN_JOB_QUERY', accessMode: 'WRITE', workload: 'WORKER', workloadClass: 'OPERATIONAL',
    capabilities: Object.freeze(['F9_ASYNC_EXECUTION', 'F9_EXECUTION_LINEAGE', 'F7_AUDIT_LEDGER', 'F12_PRIVATE_CATALOG_READ', 'F12_PRIVATE_CATALOG_WRITE', 'F12_DEDUPLICATION']),
    requiredPermission: 'OPPORTUNITY_DUPLICATE_SCAN_JOB', limits: Object.freeze({ maxPageSize: 1, maxRows: 32, maxBytes: RESULT_BYTES }) }),
  Object.freeze({ operationCode: 'OPPORTUNITY_CATALOG_RECONCILE_JOB', ownerModule: 'F12_OPPORTUNITY_WORKER',
    moduleCode: 'F12_CATALOG_RECONCILE_JOB_QUERY', accessMode: 'WRITE', workload: 'WORKER', workloadClass: 'OPERATIONAL',
    capabilities: Object.freeze(['F9_ASYNC_EXECUTION', 'F9_EXECUTION_LINEAGE', 'F7_AUDIT_LEDGER', 'F12_PRIVATE_CATALOG_READ', 'F12_PRIVATE_CATALOG_WRITE', 'F12_DEDUPLICATION']),
    requiredPermission: 'OPPORTUNITY_CATALOG_RECONCILE_JOB', limits: Object.freeze({ maxPageSize: 1, maxRows: 32, maxBytes: RESULT_BYTES }) }),
  Object.freeze({ operationCode: 'OPPORTUNITY_DOCUMENT_BIND', ownerModule: 'F12_DOCUMENT_BINDING',
    moduleCode: 'F12_DOCUMENT_BIND_QUERY', accessMode: 'WRITE', workload: 'API', workloadClass: 'FUNCTIONAL',
    capabilities: Object.freeze(['F11_PRIVATE_DOCUMENT_STORAGE', 'F12_PRIVATE_CATALOG_READ', 'F12_PRIVATE_CATALOG_WRITE', 'F7_AUDIT_LEDGER']),
    requiredPermission: 'OPPORTUNITY_PRIVATE_UPDATE', limits: Object.freeze({ maxPageSize: 1, maxRows: 1, maxBytes: RESULT_BYTES }) })
]);

function exactHandlers(handlers) {
  return handlers && Object.getPrototypeOf(handlers) === Object.prototype
    && Reflect.ownKeys(handlers).length === DEFINITIONS.length
    && DEFINITIONS.every(definition => typeof handlers[definition.operationCode] === 'function');
}

const inputSchema = Object.freeze({ validate(value) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8') <= 32768; } catch { return false; }
} });
const resultSchema = Object.freeze({ validate(value) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return false;
  try { JSON.stringify(value); return true; } catch { return false; }
} });

function createF12TenantOperations({ handlers, authorizationOperationCatalog, serviceReceiptsEnabled = false }) {
  if (!exactHandlers(handlers)) throw new TypeError('F12 tenant operation handlers are incomplete or open.');
  const modules = Object.freeze(Object.fromEntries(DEFINITIONS.map(definition => [definition.operationCode,
    Object.freeze({ moduleCode: definition.moduleCode, execute: handlers[definition.operationCode],
      ...(serviceReceiptsEnabled && definition.operationCode.endsWith('_JOB') && {
        beforeCommit: ({ client }) => client.query('RESET ROLE')
      }) })
  ])));
  const operations = Object.freeze(DEFINITIONS.map(definition => Object.freeze({
    operationCode: definition.operationCode,
    ownerModule: definition.ownerModule,
    accessMode: definition.accessMode,
    workload: definition.workload,
    workloadClass: definition.workloadClass,
    queryModule: modules[definition.operationCode],
    compatibleSchemaVersions: Object.freeze(serviceReceiptsEnabled && definition.operationCode.endsWith('_JOB')
      ? [RECEIPT_SCHEMA_VERSION] : definition.operationCode.endsWith('_JOB')
      ? [LINEAGE_SCHEMA_VERSION, ORGANIZATIONAL_SCOPE_SCHEMA_VERSION, PROFILE_SCHEMA_VERSION,AUTHORING_SCHEMA_VERSION,'009_f13_competencies_and_experience','010_f13_financial_capacity','011_f13_operational_capacity','012_f13_territories_and_populations','014_f4_runtime_metadata_access','015_f12_opportunity_xlsx_import','016_f13_editorial_baseline_publication','017_opportunity_evidenced_criteria','018_f13_pq1_publication','019_f13_pq1_activation','020_f14_pq1_decisions','021_application_first_slice','022_application_team_tasks','033_organizational_opportunity_interests']
      : [SCHEMA_VERSION, LINEAGE_SCHEMA_VERSION, ORGANIZATIONAL_SCOPE_SCHEMA_VERSION, PROFILE_SCHEMA_VERSION,AUTHORING_SCHEMA_VERSION,'009_f13_competencies_and_experience','010_f13_financial_capacity','011_f13_operational_capacity','012_f13_territories_and_populations','014_f4_runtime_metadata_access','015_f12_opportunity_xlsx_import','016_f13_editorial_baseline_publication','017_opportunity_evidenced_criteria','018_f13_pq1_publication','019_f13_pq1_activation','020_f14_pq1_decisions','021_application_first_slice','022_application_team_tasks']),
    requiredCapabilities: serviceReceiptsEnabled && definition.operationCode.endsWith('_JOB')
      ? Object.freeze([...definition.capabilities, 'F12_SERVICE_RECEIPTS']) : definition.capabilities,
    allowedCompatibilityStates: Object.freeze(['COMPATIBLE']),
    readOnlyEligible: false,
    inputSchema,
    resultSchema,
    requiredPermission: definition.requiredPermission,
    limits: definition.limits,
    timeoutMs: TIMEOUT_MS
  })));
  const catalog = createAuthorizedTenantOperationCatalog(Object.freeze({ catalogVersion: VERSION, operations }),
    authorizationOperationCatalog);
  const adapters = Object.freeze(Object.fromEntries(DEFINITIONS.map(definition => [definition.operationCode,
    Object.freeze({ operationCode: definition.operationCode, queryModule: modules[definition.operationCode] })
  ])));
  return Object.freeze({ catalog, adapters, modules, version: VERSION });
}

module.exports = { DEFINITIONS, LINEAGE_SCHEMA_VERSION, ORGANIZATIONAL_SCOPE_SCHEMA_VERSION, PROFILE_SCHEMA_VERSION, SCHEMA_VERSION, TIMEOUT_MS, VERSION, createF12TenantOperations };
