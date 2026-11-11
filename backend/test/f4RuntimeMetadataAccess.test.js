'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createLocalTenantIdentityProvisioner}=require('../src/security/localTenantIdentityProvisioner');
test('F4 metadata owner/executor cannot become logins, owner grants or worker capabilities; zero SQL',async()=>{
  let queries=0;const provisioner=await createLocalTenantIdentityProvisioner({query(){queries++;throw new Error('SQL_FORBIDDEN');}});
  const base={apiLogin:'synthetic_api',workerLogin:'synthetic_worker',apiPassword:'synthetic-password-long-enough',workerPassword:'synthetic-worker-password-long',apiRoles:[],workerRoles:[]};
  for(const change of [{apiLogin:'c4g_f4_metadata_owner'},{workerLogin:'c4g_f4_metadata_executor'},
    {apiRoles:['c4g_f4_metadata_owner']},{workerRoles:['c4g_f4_metadata_executor']}]){
    await assert.rejects(()=>provisioner.reconcile({...base,...change}),/METADATA_ROLES_MUST_REMAIN_NOLOGIN|UNSAFE_WORKLOAD_MEMBERSHIP/);
    assert.equal(queries,0);
  }
});
