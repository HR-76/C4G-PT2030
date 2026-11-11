'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID,randomBytes}=require('node:crypto');
const {createCredentialRegistry}=require('../src/entityAdmission/credentialRegistry'),{createEncryptedJournal}=require('../src/platformOnboarding/encryptedJournal');
test('central catalog preflight retains funding tables through the admission migrations',async()=>{
 let version='021_platform_members';const pool={async query(sql){
  if(sql==='SHOW server_version_num')return {rows:[{server_version_num:'170000'}]};
  if(sql.includes('c4g_schema_migration'))return {rows:[{version}]};
  if(sql.includes('AS table_name'))return {rows:['duplicate_candidate','idempotency_record','opportunity','provenance','revision','funding_run','funding_run_item','funding_identity','funding_observation'].sort().map(table_name=>({table_name}))};
  if(sql.includes('pg_roles'))return {rows:[{rolname:'owner'},{rolname:'migrator'},{rolname:'runtime'}]};
  if(sql.includes('pg_get_constraintdef'))return {rows:[{definition:'OPPORTUNITY_CREATED OPPORTUNITY_RECONCILIATION_REQUIRED'}]};
  throw Error('UNEXPECTED_QUERY');
 }};
 for(version of ['021_platform_members','022_entity_admission','023_entity_registration_draft','024_organization_registration','025_entity_admission_completion'])assert.equal((await require('../src/opportunities/preflight').opportunityPreflight(pool,'central')).ready,true);
 version='026_unknown';await assert.rejects(()=>require('../src/opportunities/preflight').opportunityPreflight(pool,'central'));
});
test('published credentials survive restart, remain encrypted and resolve only the exact current API binding',async()=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'c4g-registry-')),key=randomBytes(32).toString('hex');
 try{
  const binding={operationId:randomUUID(),organizationId:randomUUID(),globalUserId:randomUUID(),membershipId:randomUUID()},api={tenantId:binding.organizationId,credentialRef:'api',connectionVersion:1,database:'test',login:'api',password:randomBytes(16).toString('hex')},worker={...api,credentialRef:'worker',login:'worker',password:randomBytes(16).toString('hex')};
  let replaced=false,probes=0;
  const directory={resolveSnapshotByOrganization:async(org,workload)=>({...workload==='API'?api:worker,databaseRef:'test',connectionVersion:replaced?2:1})};
  const create=()=>createCredentialRegistry({journal:createEncryptedJournal({directory:folder,key}),directory,probe:async()=>{probes++}});
  await create().publish(binding,api,worker);assert.equal(probes,2);
  assert(!(await fs.readFile(path.join(folder,binding.organizationId+'.enc'),'utf8')).includes(api.password));
  const registry=create();assert.deepEqual(await registry.resolve({...api,workload:'API'}),api);
  for(const override of [{workload:'WORKER'},{credentialRef:'worker'},{connectionVersion:2},{tenantId:randomUUID()}])await assert.rejects(()=>registry.resolve({...api,workload:'API',...override}));
  replaced=true;await assert.rejects(()=>registry.resolve({...api,workload:'API'}));
 }finally{await fs.rm(folder,{recursive:true,force:true});}
});
test('failed physical verification never publishes credentials',async()=>{
 let saved=false;const binding={operationId:randomUUID(),organizationId:randomUUID(),globalUserId:randomUUID(),membershipId:randomUUID()},api={tenantId:binding.organizationId,database:'a',credentialRef:'api',connectionVersion:1,login:'a'},worker={...api,credentialRef:'worker',login:'b'};
 const registry=createCredentialRegistry({journal:{reserve:async()=>{saved=true}},directory:{resolveSnapshotByOrganization:async(o,w)=>({...w==='API'?api:worker,databaseRef:'a'})},probe:async()=>{throw Error('PHYSICAL_MISMATCH')}});
 await assert.rejects(()=>registry.publish(binding,api,worker));assert.equal(saved,false);
});
test('runtime dynamic adapter rejects mismatched credentials and worker requests',async()=>{
 const known={tenantId:randomUUID(),credentialRef:'known',connectionVersion:1,host:'localhost',port:5432,database:'known',login:'limited',password:'synthetic',ssl:false},dynamic={...known,tenantId:randomUUID(),credentialRef:'new'};
 let bad=false,calls=0;
 const runtime=require('../src/config/opportunityRuntime').createConfiguredOpportunityRuntime({centralPool:{},env:{OPPORTUNITY_API_CREDENTIALS_JSON:JSON.stringify([known]),OPPORTUNITY_ALLOWED_RESIDENCY_JSON:JSON.stringify([{regionCode:'LOCAL',policyVersion:'local-development-v1'}])},credentialResolver:async()=>{calls++;return bad?known:dynamic}});
 try{const request={tenantId:dynamic.tenantId,credentialRef:dynamic.credentialRef,connectionVersion:1,workload:'API'};
  assert.equal((await runtime.credentialProvider.resolve(request)).material.tenantId,dynamic.tenantId);assert.equal(calls,1);
  bad=true;await assert.rejects(()=>runtime.credentialProvider.resolve(request));await assert.rejects(()=>runtime.credentialProvider.resolve({...request,workload:'WORKER'}));
 }finally{await runtime.poolManager.closeAll();}
});
