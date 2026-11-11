'use strict';
const { createAuthorizedTenantOperationCatalog } = require('../security/tenantOperationCatalog');
const { OPS } = require('./editorialService');
function createEditorialTenantOperations({ execute, beforeCommit, authorityGuard, inputs, authorizationOperationCatalog }) {
  const adapters = {};
  const operations = [...new Set(Object.values(OPS))].map(operationCode => {
    const read = operationCode === 'F13_PROFILE_READ';
    const queryModule = Object.freeze({ moduleCode: `${operationCode}_EDITORIAL_QUERY`, requiresAuditWrite: true,
      execute: ({ client, input }) => { const state = inputs.get(input); return execute(client, state.method, state); },
      beforeCommit: ({ client, input }) => beforeCommit(client, inputs.get(input)),
      authorityGuard: Object.freeze({ assert: ({ client, input }) => authorityGuard.assert(client, inputs.get(input)),
        complete: ({ input, outcome }) => authorityGuard.complete(inputs.get(input), outcome) }) });
    for (const [method, code] of Object.entries(OPS)) if (code === operationCode) adapters[method] = Object.freeze({ operationCode, queryModule });
    return Object.freeze({ operationCode, ownerModule: 'F13_EDITORIAL_BASELINE', accessMode: read ? 'READ' : 'WRITE',
      workload: 'API', workloadClass: 'FUNCTIONAL', queryModule,
      compatibleSchemaVersions: Object.freeze(['016_f13_editorial_baseline_publication','017_opportunity_evidenced_criteria','018_f13_pq1_publication','019_f13_pq1_activation','020_f14_pq1_decisions','021_application_first_slice','022_application_team_tasks']),
      requiredCapabilities: Object.freeze(['F13_EDITORIAL_BASELINE_PUBLICATION', 'F7_AUDIT_LEDGER']),
      allowedCompatibilityStates: Object.freeze(['COMPATIBLE']), readOnlyEligible: false,
      inputSchema: Object.freeze({ validate: value => inputs.has(value) }), resultSchema: Object.freeze({ validate: value => value !== undefined }),
      requiredPermission: operationCode, limits: Object.freeze({ maxPageSize: 100, maxRows: 10000, maxBytes: 1048576 }), timeoutMs: 10000 });
  });
  return Object.freeze({ adapters: Object.freeze(adapters), catalog: createAuthorizedTenantOperationCatalog(
    Object.freeze({ catalogVersion: 'f13-editorial-tenant-v1', operations: Object.freeze(operations) }), authorizationOperationCatalog) });
}
module.exports = { createEditorialTenantOperations };
