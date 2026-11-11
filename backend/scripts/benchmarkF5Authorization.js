const { performance } = require('node:perf_hooks');
const { createAuditCoordinator } = require('../src/authorization/audit');
const { createAuthorizationService } = require('../src/authorization/authorizationService');
const { createMetricsPort } = require('../src/authorization/metrics');
const { createPolicyEngine } = require('../src/authorization/policyEngine');
const { actor, grant, membership, resource, snapshot, syntheticCatalogs } = require('../test/support/f5AuthorizationFixtures');

async function main({ iterations = 10000 } = {}) {
  const catalogs = syntheticCatalogs();
  const policyEngine = createPolicyEngine({ permissionCatalog: catalogs.permissionCatalog,
    profileCatalog: catalogs.profileCatalog, assurancePolicyVersion: 'c4g-assurance-v1',
    recentMfaRequirement: Object.freeze({ maxAgeSeconds: 300, mfa: true,
      acceptedAcr: Object.freeze(['c4g-loa2']), acceptedAmr: Object.freeze(['otp']), amrMode: 'all' }) });
  const service = createAuthorizationService({ operationCatalog: catalogs.operationCatalog,
    membershipPort: { async revalidate() { return membership(); } },
    authorizationDataPort: { async load() { return snapshot({ grants: Object.freeze([grant()]) }); } },
    resourcePort: { async load() { return resource(); } }, policyEngine,
    auditCoordinator: createAuditCoordinator({ port: { async accept() { return 'ACCEPTED'; } }, timeoutMs: 100 }),
    clock: { now: () => new Date('2030-01-15T12:00:00.000Z') }, metricsPort: createMetricsPort(() => {}) });
  const input = { operationCode: 'SYNTHETIC_READ', actor: actor(), resourceId: 'resource-alpha',
    assuranceEvidence: null, correlationId: 'benchmark-f5' };
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const result = await service.authorize(input);
    if (!result.allowed) throw new Error('F5 benchmark authorization unexpectedly denied.');
  }
  const elapsedMs = performance.now() - started;
  const report = Object.freeze({ iterations, ttl: 0, elapsedMs: Number(elapsedMs.toFixed(3)),
    operationsPerSecond: Number((iterations / (elapsedMs / 1000)).toFixed(2)) });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return report;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { main };
