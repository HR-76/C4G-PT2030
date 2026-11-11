const WORKLOADS=Object.freeze(['API','WORKER']);
function requireTenantWorkload(value){if(!WORKLOADS.includes(value))throw new TypeError('Tenant workload is invalid.');return value;}
function workloadKey(tenantId,workload,connectionVersion=null){requireTenantWorkload(workload);if(typeof tenantId!=='string'||!tenantId)throw new TypeError('Tenant identity is invalid.');return connectionVersion===null?`${tenantId}:${workload}`:`${tenantId}:${workload}:${connectionVersion}`;}
module.exports={WORKLOADS,requireTenantWorkload,workloadKey};
