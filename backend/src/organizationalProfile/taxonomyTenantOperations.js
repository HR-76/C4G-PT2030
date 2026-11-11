'use strict';
const { createAuthorizedTenantOperationCatalog } = require('../security/tenantOperationCatalog');
const { OPS } = require('./taxonomyService');

// Root-internal modules: callers receive neither adapters nor prepared clients.
function createTaxonomyTenantOperations({ execute, beforeCommit, authorityGuard, inputs, authorizationOperationCatalog }) {
  const adapters = {};
  const inputSchema = Object.freeze({ validate: value => inputs.has(value) });
  const resultSchema = Object.freeze({ validate: value => value !== undefined });
  const operations = Object.freeze(Object.entries(OPS).map(([method, operationCode]) => {
    const queryModule = Object.freeze({ moduleCode: `${operationCode}_QUERY`,
      execute: ({ client, input }) => execute(client, method, inputs.get(input)),
      beforeCommit: ({ client, input }) => beforeCommit(client, inputs.get(input)),
      authorityGuard:Object.freeze({
        assert:({client,input})=>authorityGuard.assert(client,inputs.get(input)),
        complete:({input,outcome})=>authorityGuard.complete(inputs.get(input),outcome)
      }) });
    adapters[method] = Object.freeze({ operationCode, queryModule });
    return Object.freeze({ operationCode, ownerModule: 'F13_TAXONOMY',
      accessMode: method === 'readRelease' ? 'READ' : 'WRITE', workload: 'API', workloadClass: 'FUNCTIONAL',
      queryModule, compatibleSchemaVersions: Object.freeze(['007_f13_profile_catalogs_and_policies','008_f13_profile_authoring_and_assertions','009_f13_competencies_and_experience','010_f13_financial_capacity','011_f13_operational_capacity','012_f13_territories_and_populations','014_f4_runtime_metadata_access','015_f12_opportunity_xlsx_import','016_f13_editorial_baseline_publication','017_opportunity_evidenced_criteria','018_f13_pq1_publication','019_f13_pq1_activation','020_f14_pq1_decisions','021_application_first_slice','022_application_team_tasks']),
      requiredCapabilities: Object.freeze(['F13_PROFILE_CATALOG_FOUNDATION', 'F7_AUDIT_LEDGER']),
      allowedCompatibilityStates: Object.freeze(['COMPATIBLE']), readOnlyEligible: false,
      inputSchema, resultSchema, requiredPermission: operationCode,
      limits: Object.freeze({ maxPageSize: 100, maxRows: 1000, maxBytes: 1048576 }), timeoutMs: 10000 });
  }));
  const catalog = createAuthorizedTenantOperationCatalog(Object.freeze({ catalogVersion: 'f13-taxonomy-tenant-v1', operations }), authorizationOperationCatalog);
  return Object.freeze({ catalog, adapters: Object.freeze(adapters) });
}
module.exports = { createTaxonomyTenantOperations };
