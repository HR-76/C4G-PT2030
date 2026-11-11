'use strict';
const {isAuthorityCoordinator}=require('./authorityCoordinator');
const {resolutionSnapshot}=require('./tenantDirectoryRepository');
const {resolve}=require('./tenantDirectoryQueries');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Root-owned service capability, bounded by deployment configuration. Never mounted as HTTP.
// Functional callers must authorize membership/grants before discovery; this port grants neither.
function createTenantDirectoryReader({coordinator,organizations,workload}){
 if(!isAuthorityCoordinator(coordinator)||!['API','WORKER'].includes(workload)||!Array.isArray(organizations)||!organizations.length||organizations.length>100||organizations.some(id=>typeof id!=='string'||!UUID.test(id))||new Set(organizations.map(id=>id.toLowerCase())).size!==organizations.length)throw Error('TENANT_DIRECTORY_CONFIGURATION_INVALID');
 const allowed=new Set(organizations.map(id=>id.toLowerCase()));
 return Object.freeze({async resolveSnapshotByOrganization(organizationId,requestedWorkload){
  if(!UUID.test(organizationId||'')||!allowed.has(organizationId.toLowerCase())||requestedWorkload!==workload)throw Error('TENANT_DIRECTORY_SCOPE_DENIED');
  // No cache: commit-time revalidation sees directory changes through the same contract.
  const result=await coordinator.pool.query(resolve,[organizationId,workload]);
  if(!Array.isArray(result?.rows)||result.rowCount!==result.rows.length||result.rows.length>1)throw Error('TENANT_DIRECTORY_RESULT_INVALID');
  const row=result.rows[0];if(row&&(row.organization_id!==organizationId.toLowerCase()||row.workload!==workload))throw Error('TENANT_DIRECTORY_RESULT_INVALID');
  return resolutionSnapshot(row);
 }});
}
module.exports={createTenantDirectoryReader};
