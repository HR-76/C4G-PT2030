const { appendEvent, conflict, findMatchingEvent, inCentralTransaction } = require('./tenantRepositorySupport');
const {requireTenantWorkload}=require('./tenantWorkload');

function tenantRow(row) {
  return row && Object.freeze({ tenantId: row.tenant_id, organizationId: row.organization_id,
    deploymentMode: row.deployment_mode, revision: Number(row.revision) });
}

function resolutionSnapshot(row) {
  if (!row) return null;
  const verifiedCapabilities = row.verified_capabilities && Object.getPrototypeOf(row.verified_capabilities) === Object.prototype
    ? Object.freeze({ ...row.verified_capabilities }) : row.verified_capabilities;
  return Object.freeze({
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    workload: row.workload,
    deploymentMode: row.deployment_mode,
    provisioningStatus: row.provisioning_status,
    connectionVersion: row.current_connection_version === null ? null : Number(row.current_connection_version),
    connectionState: row.operational_state,
    connectionRevision: row.connection_revision === null ? null : Number(row.connection_revision),
    versionState: row.version_state,
    databaseGenerationId: row.database_generation_id,
    databaseRef: row.database_ref,
    credentialRef: row.credential_ref,
    fence: row.workload_fence === null || row.workload_fence === undefined ? null : Number(row.workload_fence),
    regionCode: row.region_code,
    residencyPolicyVersion: row.residency_policy_version,
    observedSystemIdentifier: row.observed_system_identifier,
    bindingDigest: row.binding_digest,
    schema: Object.freeze({
      compatibilityState: row.compatibility_state,
      currentVersion: row.current_version,
      minimumReadVersion: row.minimum_read_version,
      minimumWriteVersion: row.minimum_write_version,
      verifiedCapabilities,
      schemaFingerprint: verifiedCapabilities && typeof verifiedCapabilities.schemaFingerprint === 'string'
        ? verifiedCapabilities.schemaFingerprint : null,
      revision: row.schema_revision === null ? null : Number(row.schema_revision)
    })
  });
}

function createTenantDirectoryRepository(pool) {
  return Object.freeze({
    async createTenant({ organizationId, tenantId, deploymentMode = 'DATABASE_PER_ORGANIZATION', correlationId, idempotencyKey }) {
      const event={tenantId,organizationId,aggregateType:'TENANT',aggregateId:tenantId,actionCode:'TENANT_CREATED',toState:'CREATED',correlationId,idempotencyKey,intent:{organizationId,tenantId,deploymentMode}};
      return inCentralTransaction(pool, async client => {
        const org = await client.query('SELECT id FROM public.organization WHERE id=$1 FOR UPDATE', [organizationId]);
        if (org.rowCount !== 1) throw conflict();
        if(await findMatchingEvent(client,event)){const retry=await client.query('SELECT tenant_id,organization_id,deployment_mode,revision FROM public.tenant WHERE organization_id=$1',[organizationId]);if(retry.rowCount!==1||retry.rows[0].tenant_id!==tenantId||retry.rows[0].deployment_mode!==deploymentMode||Number(retry.rows[0].revision)!==1)throw conflict();return tenantRow(retry.rows[0]);}
        const existing = await client.query('SELECT tenant_id,organization_id,deployment_mode,revision FROM public.tenant WHERE organization_id=$1', [organizationId]);
        if (existing.rowCount) throw conflict();
        const inserted = await client.query(`INSERT INTO public.tenant(tenant_id,organization_id,deployment_mode) VALUES($1,$2,$3)
          RETURNING tenant_id,organization_id,deployment_mode,revision`, [tenantId, organizationId, deploymentMode]);
        await client.query(`INSERT INTO public.organization_connection(tenant_id) VALUES($1)`, [tenantId]);
        await client.query(`INSERT INTO public.tenant_schema_state(tenant_id) VALUES($1)`, [tenantId]);
        await appendEvent(client,event);
        return tenantRow(inserted.rows[0]);
      });
    },
    async getTenantByOrganization(organizationId) {
      const result = await pool.query('SELECT tenant_id,organization_id,deployment_mode,revision FROM public.tenant WHERE organization_id=$1', [organizationId]);
      return result.rowCount === 1 ? tenantRow(result.rows[0]) : null;
    },
    async getTenant(tenantId) {
      const result = await pool.query('SELECT tenant_id,organization_id,deployment_mode,revision FROM public.tenant WHERE tenant_id=$1', [tenantId]);
      return result.rowCount === 1 ? tenantRow(result.rows[0]) : null;
    },
    async resolveSnapshotByOrganization(organizationId,workload) {
      requireTenantWorkload(workload);
      const result = await pool.query(`SELECT o.id organization_id,t.tenant_id,t.deployment_mode,wb.provisioning_status,
        wb.workload,wb.current_connection_version,wb.lifecycle_status operational_state,wb.revision connection_revision,wb.fence workload_fence,
        v.version_state,v.database_generation_id,g.database_ref,wv.credential_ref,
        v.region_code,v.residency_policy_version,v.observed_system_identifier,wv.binding_digest,
        wb.compatibility_status compatibility_state,s.current_version,s.minimum_read_version,s.minimum_write_version,s.verified_capabilities,
        s.revision schema_revision,h.health_state,h.observed_at,h.expires_at
        FROM public.organization o LEFT JOIN public.tenant t ON t.organization_id=o.id
        LEFT JOIN public.organization_provisioning p ON p.organization_id=o.id
        LEFT JOIN public.tenant_workload_binding wb ON wb.tenant_id=t.tenant_id AND wb.workload=$2
        LEFT JOIN public.tenant_workload_connection_version wv ON wv.tenant_id=wb.tenant_id AND wv.workload=wb.workload AND wv.connection_version=wb.current_connection_version
        LEFT JOIN public.organization_connection_version v ON v.tenant_id=wv.tenant_id AND v.connection_version=wv.connection_version
        LEFT JOIN public.tenant_database_generation g ON g.tenant_id=v.tenant_id AND g.database_generation_id=v.database_generation_id
        LEFT JOIN public.tenant_schema_state s ON s.tenant_id=t.tenant_id
        LEFT JOIN public.tenant_health_observation h ON h.tenant_id=v.tenant_id AND h.connection_version=v.connection_version
        WHERE o.id=$1`, [organizationId,workload]);
      if (result.rowCount > 1) throw new Error('Tenant directory snapshot is ambiguous.');
      return resolutionSnapshot(result.rows[0]);
    }
  });
}
module.exports = { createTenantDirectoryRepository, resolutionSnapshot, tenantRow };
