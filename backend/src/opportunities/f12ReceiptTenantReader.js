'use strict';

const { sameSnapshot } = require('../security/tenantLeaseContracts');

const workload = 'API';
const requiredCapabilities = Object.freeze(['F9_EXECUTION_LINEAGE', 'F12_PRIVATE_CATALOG_READ', 'F12_SERVICE_RECEIPTS']);

function createF12ReceiptTenantReader({ directoryRepository, credentialProvider, poolManager, bindingVerifier, regionPolicy }) {
  return async function withVerifiedTenant(guard, read) {
    const correlationId = guard.transaction_id;
    const resolve = () => directoryRepository.resolveSnapshotByOrganization(guard.organization_id, workload);
    const snapshot = await resolve();
    if (!snapshot?.schema || snapshot.organizationId !== guard.organization_id
        || snapshot.workload !== workload || snapshot.tenantId !== guard.tenant_id
        || snapshot.databaseGenerationId !== guard.database_generation_id
        || snapshot.connectionState !== 'AVAILABLE' || snapshot.versionState !== 'VALIDATED'
        || snapshot.provisioningStatus !== 'READY' || !['COMPATIBLE', 'READ_ONLY'].includes(snapshot.schema.compatibilityState)
        || !regionPolicy.allows(snapshot.regionCode, snapshot.residencyPolicyVersion)) {
      throw new Error('F12_RECEIPT_TENANT_BINDING_UNAVAILABLE');
    }
    const { tenantId, connectionVersion, credentialRef } = snapshot;
    const credentialLease = await credentialProvider.resolve({ tenantId, workload, connectionVersion, credentialRef, correlationId });
    const allocation = await poolManager.acquire({
      tenantId, workload, connectionVersion, credentialLease, workloadClass: 'OPERATIONAL', correlationId
    });
    const { client } = allocation;
    let failure;
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
      await client.query("SET LOCAL statement_timeout = '5s'");
      const verify = async () => {
        const current = await resolve();
        if (!current?.schema || !sameSnapshot(snapshot, current)) throw new Error('F12_RECEIPT_TENANT_BINDING_CHANGED');
        const result = await bindingVerifier.verify({ client, snapshot, requiredCapabilities, correlationId });
        if (result?.verified !== true) throw new Error('F12_RECEIPT_TENANT_BINDING_UNAVAILABLE');
      };
      await verify();
      await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
      const outcome = await read(client);
      await client.query('RESET ROLE');
      await verify();
      await client.query('COMMIT');
      return outcome;
    } catch (error) {
      failure = error;
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      await allocation.release({ discard: Boolean(failure), cause: failure });
    }
  };
}

module.exports = { createF12ReceiptTenantReader };
