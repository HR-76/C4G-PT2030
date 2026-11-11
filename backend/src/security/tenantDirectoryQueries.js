'use strict';
// Infrastructure discovery only. No credentials, arbitrary SQL, enumeration or authority grant.
const resolve = `SELECT o.id organization_id,t.tenant_id,t.deployment_mode,wb.provisioning_status,
 wb.workload,wb.current_connection_version,wb.lifecycle_status operational_state,wb.revision connection_revision,wb.fence workload_fence,
 v.version_state,v.database_generation_id,g.database_ref,wv.credential_ref,
 v.region_code,v.residency_policy_version,v.observed_system_identifier,wv.binding_digest,
 wb.compatibility_status compatibility_state,s.current_version,s.minimum_read_version,s.minimum_write_version,s.verified_capabilities,s.revision schema_revision
 FROM public.organization o JOIN public.tenant t ON t.organization_id=o.id
 JOIN public.tenant_workload_binding wb ON wb.tenant_id=t.tenant_id AND wb.workload=$2
 JOIN public.tenant_workload_connection_version wv ON wv.tenant_id=wb.tenant_id AND wv.workload=wb.workload AND wv.connection_version=wb.current_connection_version
 JOIN public.organization_connection_version v ON v.tenant_id=wv.tenant_id AND v.connection_version=wv.connection_version
 JOIN public.tenant_database_generation g ON g.tenant_id=v.tenant_id AND g.database_generation_id=v.database_generation_id
 JOIN public.tenant_schema_state s ON s.tenant_id=t.tenant_id
 WHERE o.id=$1 AND o.status='ACTIVE' AND $2 IN ('API','WORKER')
 AND t.deployment_mode='DATABASE_PER_ORGANIZATION' AND wb.lifecycle_status='AVAILABLE'
 AND wb.provisioning_status='READY' AND wb.compatibility_status IN ('COMPATIBLE','READ_ONLY')
 AND wv.lifecycle_status='AVAILABLE' AND wv.provisioning_status='READY'
 AND wv.compatibility_status IN ('COMPATIBLE','READ_ONLY') AND v.version_state='VALIDATED'
 AND wb.credential_ref=wv.credential_ref AND wb.binding_digest=wv.binding_digest AND wb.fence=wv.fence AND g.retired_at IS NULL
 LIMIT 2`.replace(/\s+/g,' ').trim();
module.exports=Object.freeze({resolve});
