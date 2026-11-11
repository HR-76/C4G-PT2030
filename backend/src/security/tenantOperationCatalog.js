const { types: { isProxy } } = require('node:util');
const { TENANT_CATALOG_VERSION } = require('./tenantMigrationManifest');

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const VERSION = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const ACCESS_MODES = new Set(['READ', 'WRITE']);
const WORKLOAD_CLASSES = new Set(['FUNCTIONAL', 'OPERATIONAL']);
const WORKLOADS = new Set(['API','WORKER']);
const COMPATIBILITY_STATES = new Set(['COMPATIBLE', 'READ_ONLY']);

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length
    && keys.every(key => descriptors[key] && descriptors[key].enumerable && 'value' in descriptors[key]);
}

function validCodeArray(value) {
  return Array.isArray(value) && Object.isFrozen(value) && value.length > 0
    && value.every(item => typeof item === 'string' && CODE.test(item))
    && new Set(value).size === value.length;
}

function validVersionArray(value) {
  return Array.isArray(value) && Object.isFrozen(value) && value.length > 0
    && value.every(item => typeof item === 'string' && VERSION.test(item))
    && new Set(value).size === value.length;
}

function validSchema(schema) {
  return exactKeys(schema, ['validate']) && Object.isFrozen(schema) && typeof schema.validate === 'function';
}

function createTenantOperationCatalog(configuration) {
  if (!exactKeys(configuration, ['catalogVersion', 'operations'])
      || !VERSION.test(configuration.catalogVersion)
      || !Array.isArray(configuration.operations) || !Object.isFrozen(configuration.operations)) {
    throw new TypeError('Tenant operation catalog configuration is invalid.');
  }
  const byCode = new Map();
  for (const entry of configuration.operations) {
    const keys = [
      'operationCode', 'ownerModule', 'accessMode', 'workload', 'workloadClass', 'queryModule',
      'compatibleSchemaVersions', 'requiredCapabilities', 'allowedCompatibilityStates',
      'readOnlyEligible', 'inputSchema', 'resultSchema', 'requiredPermission', 'limits', 'timeoutMs'
    ];
    if (!exactKeys(entry, keys) || !Object.isFrozen(entry)) {
      throw new TypeError('Tenant operation catalog entry has an invalid shape.');
    }
    if (!CODE.test(entry.operationCode) || byCode.has(entry.operationCode)
        || !CODE.test(entry.ownerModule) || !CODE.test(entry.requiredPermission)) {
      throw new TypeError('Tenant operation code or owner is invalid or duplicated.');
    }
    if (!ACCESS_MODES.has(entry.accessMode) || !WORKLOADS.has(entry.workload) || !WORKLOAD_CLASSES.has(entry.workloadClass)) {
      throw new TypeError('Tenant operation mode or workload class is invalid.');
    }
    if (!entry.queryModule || typeof entry.queryModule.execute !== 'function' || !Object.isFrozen(entry.queryModule)) {
      throw new TypeError('Tenant query module must be present and frozen.');
    }
    if (!validVersionArray(entry.compatibleSchemaVersions)
        || !validCodeArray(entry.requiredCapabilities)
        || !Array.isArray(entry.allowedCompatibilityStates) || !Object.isFrozen(entry.allowedCompatibilityStates)
        || entry.allowedCompatibilityStates.length === 0
        || entry.allowedCompatibilityStates.some(state => !COMPATIBILITY_STATES.has(state))
        || new Set(entry.allowedCompatibilityStates).size !== entry.allowedCompatibilityStates.length
        || typeof entry.readOnlyEligible !== 'boolean'
        || (entry.readOnlyEligible !== entry.allowedCompatibilityStates.includes('READ_ONLY'))
        || (entry.readOnlyEligible && entry.accessMode !== 'READ')) {
      throw new TypeError('Tenant operation compatibility contract is invalid.');
    }
    if (!validSchema(entry.inputSchema) || !validSchema(entry.resultSchema)
        || !exactKeys(entry.limits, ['maxPageSize', 'maxRows', 'maxBytes']) || !Object.isFrozen(entry.limits)
        || Object.values(entry.limits).some(value => !Number.isSafeInteger(value) || value < 1)
        || !Number.isSafeInteger(entry.timeoutMs) || entry.timeoutMs < 1) {
      throw new TypeError('Tenant operation validation or limits are invalid.');
    }
    const contract = Object.freeze({
      catalogVersion: configuration.catalogVersion,
      operationCode: entry.operationCode,
      ownerModule: entry.ownerModule,
      accessMode: entry.accessMode,
      workload: entry.workload,
      workloadClass: entry.workloadClass,
      queryModule: entry.queryModule,
      compatibleSchemaVersions: entry.compatibleSchemaVersions,
      requiredCapabilities: entry.requiredCapabilities,
      allowedCompatibilityStates: entry.allowedCompatibilityStates,
      readOnlyEligible: entry.readOnlyEligible,
      inputSchema: entry.inputSchema,
      resultSchema: entry.resultSchema,
      requiredPermission: entry.requiredPermission,
      limits: entry.limits,
      timeoutMs: entry.timeoutMs
    });
    byCode.set(contract.operationCode, contract);
  }
  return Object.freeze({
    catalogVersion: configuration.catalogVersion,
    resolveAdapter(adapter) {
      if (!exactKeys(adapter, ['operationCode', 'queryModule']) || !Object.isFrozen(adapter)) {
        throw new TypeError('Tenant operation adapter must be frozen and closed.');
      }
      const contract = byCode.get(adapter.operationCode);
      if (!contract || contract.queryModule !== adapter.queryModule) return null;
      return contract;
    },
    get size() { return byCode.size; }
  });
}

function createAuthorizedTenantOperationCatalog(configuration, authorizationOperationCatalog) {
  if (!authorizationOperationCatalog || typeof authorizationOperationCatalog.resolve !== 'function') {
    throw new TypeError('Authorization operation catalog is required.');
  }
  for (const entry of configuration.operations) {
    const authorization = authorizationOperationCatalog.resolve(entry.requiredPermission);
    if (!authorization || authorization.effect !== entry.accessMode) {
      throw new TypeError('Tenant operation authorization bridge is invalid.');
    }
  }
  return createTenantOperationCatalog(configuration);
}

function createProductionTenantOperationCatalog() {
  return createTenantOperationCatalog(Object.freeze({
    catalogVersion: TENANT_CATALOG_VERSION,
    operations: Object.freeze([])
  }));
}

module.exports = {
  createAuthorizedTenantOperationCatalog, createProductionTenantOperationCatalog, createTenantOperationCatalog
};
