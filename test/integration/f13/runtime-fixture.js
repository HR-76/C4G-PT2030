'use strict';
const { createTenantPoolManager } = require('../../../backend/src/security/tenantPoolManager');
const { createTenantCredentialProvider } = require('../../../backend/src/security/tenantCredentialProvider');
const { createTenantBindingVerifier } = require('../../../backend/src/security/tenantBindingVerifier');
const { preflightTenantClient } = require('../../../backend/src/security/tenantMigrationPreflight');
const { bindingDigest } = require('../../../backend/src/security/localTenantCredentialAdapter');

// Synthetic directory/membership ports; physical observations and transactions are PostgreSQL.
async function runtimeFixture({ pool, evidence, sessions, clock = { now: () => new Date() } }) {
  const client = await pool.connect();
  let physical;
  try { physical = (await client.query('SELECT current_database() AS database,session_user AS login')).rows[0]; }
  finally { client.release(); }
  const resolution = { credentialRef: 'f13-synthetic-api', tenantId: evidence.tenantId, workload: 'API', connectionVersion: 1, ...physical };
  let snapshot = { organizationId: evidence.tenantId, tenantId: evidence.tenantId, workload: 'API',
    deploymentMode: 'DATABASE_PER_ORGANIZATION', provisioningStatus: 'READY', connectionState: 'AVAILABLE',
    connectionVersion: 1, connectionRevision: 1, versionState: 'VALIDATED', databaseGenerationId: evidence.databaseGenerationId,
    databaseRef: physical.database, credentialRef: resolution.credentialRef, bindingDigest: bindingDigest(resolution),
    observedSystemIdentifier: evidence.systemIdentifier, regionCode: 'SYNTHETIC', residencyPolicyVersion: 'synthetic-v1', fence: 0,
    schema: { compatibilityState: 'COMPATIBLE', currentVersion: evidence.currentVersion, schemaFingerprint: evidence.schemaFingerprint,
      revision: 1, verifiedCapabilities: Object.fromEntries(evidence.capabilities.map(code => [code, true])) } };
  const scheduler = { setTimeout, clearTimeout };
  const manager = createTenantPoolManager({ poolFactory: async () => ({ connect: () => pool.connect(), end: async () => {} }), clock, scheduler, jitter: () => 0,
    policy: { globalLimit: 6, perTenantLimit: 5, operationalReserve: 1, globalQueueLimit: 20, perTenantQueueLimit: 15,
      operationalQueueReserve: 1, acquireTimeoutMs: 10000, leaseTimeoutMs: 30000, idleTimeoutMs: 30000,
      drainTimeoutMs: 10000, circuitFailureThreshold: 100, circuitResetMs: 1, backoffBaseMs: 1, maxBackoffMs: 1 } });
  const bindingVerifier = createTenantBindingVerifier({ async observe({ client: acquired }) {
    const observed = await preflightTenantClient(acquired, { tenantId: evidence.tenantId, databaseGenerationId: evidence.databaseGenerationId });
    const actual = (await acquired.query('SELECT current_database() AS database,session_user AS login')).rows[0];
    return { ...observed, schemaVersion: observed.currentVersion, bindingDigest: bindingDigest({ ...resolution, ...actual }) };
  } });
  return { get snapshot() { return snapshot; }, set snapshot(value) { snapshot = value; }, manager,
    dependencies: { poolManager: manager, bindingVerifier, clock, scheduler, maxAttempts: 1,
      membershipRepository: { async revalidateContext(context) { const member = sessions.memberships.get(context.membershipId);
        return member?.status === 'ACTIVE' && member.organizationId === context.organizationId && member.membershipVersion === context.membershipVersion; } },
      directoryRepository: { async resolveSnapshotByOrganization() { return structuredClone(snapshot); } },
      credentialProvider: createTenantCredentialProvider({ async resolve() { return { material: Object.freeze({ synthetic: true }), async dispose() {} }; } }),
      regionPolicy: { allows: () => true } } };
}
module.exports = { runtimeFixture };
