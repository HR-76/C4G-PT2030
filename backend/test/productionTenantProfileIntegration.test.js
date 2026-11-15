'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const profiles=require('../src/security/tenantApiProfile');
const {FUNCTIONAL_ROLES,PROFILE_CODE,tenantProfileMarker,validateFreshBaseline}=require('../scripts/productionBootstrap/tenant');
const {createMemberProjection}=require('../src/platformOnboarding/memberProjection');
const {createDeletionProjection}=require('../src/platformDirectory/deletionProjection');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const credentials={tenantId:id(2),credentialRef:'tenant-test',connectionVersion:1,host:'127.0.0.1',port:5432,database:'tenant_test',login:'tenant_api',password:'synthetic-password',ssl:false};
const snapshot={organizationId:id(1),tenantId:id(2),databaseRef:'tenant_test'};
const bindings=[{organizationId:id(1),credentials,snapshot}];
const member={operationId:id(3),organizationId:id(1),globalUserId:id(4),membershipId:id(5),input:{adminName:'Synthetic',adminEmail:'synthetic@example.invalid'}};

test('production bootstrap and runtime share the exact editorial capability profile',()=>{
 assert.equal(PROFILE_CODE,'production-editorial-v1');
 assert.deepEqual(FUNCTIONAL_ROLES,['c4g_opportunity_tenant_runtime','c4g_f4_metadata_executor','c4g_organization_profile_runtime']);
 assert.deepEqual(FUNCTIONAL_ROLES,profiles.apiFunctionalRoles({editorialEnabled:true}));
 assert.equal(profiles.requireTenantApiProfile().editorialEnabled,false);
 assert.equal(profiles.requireTenantApiProfile(PROFILE_CODE).editorialEnabled,true);
 for(const input of ['any',true,null,['c4g_tenant_runtime'],{editorialEnabled:true}])assert.throws(()=>profiles.requireTenantApiProfile(input),/TENANT_API_PROFILE_INVALID/);
});

test('fresh editorial baseline is exact and refuses privileged or extra parents',async()=>{
 const names=['c4g_tenant_api_capabilities',...FUNCTIONAL_ROLES];
 const rows=names.map(rolname=>({rolname,rolcanlogin:false,rolinherit:false,rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,configured:false}));
 const edge={granted:'c4g_f4_metadata_executor',member:'c4g_tenant_api_capabilities',set_option:true,inherit_option:false,admin_option:false};
 const client=extra=>({async query(sql){return {rows:sql.includes('pg_auth_members')?[edge,...extra]:rows};}});
 await validateFreshBaseline(client([]));
 await assert.rejects(validateFreshBaseline(client([{...edge,granted:'c4g_tenant_owner'}])),/BASELINE_INVALID/);
 await assert.rejects(validateFreshBaseline({async query(){return {rows:rows.map(row=>({...row,rolsuper:row.rolname==='c4g_organization_profile_runtime'}))};}}),/BASELINE_INVALID/);
});

test('editorial profile marker does not adopt a previous minimal installation',()=>{
 const config={installationId:id(9),target:{host:'localhost',port:5432,expectedSystemIdentifier:'123',centralDatabase:'central_test',tenantDatabase:'tenant_test',ssl:false},organization:{id:id(1)},tenant:{id:id(2),generationId:id(6),apiLogin:'tenant_api',credentialRef:'tenant-test'}};
 const {installationId,target,organization,tenant}=config;
 const old={installationId,host:target.host,port:target.port,expectedSystemIdentifier:target.expectedSystemIdentifier,centralDatabase:target.centralDatabase,tenantDatabase:target.tenantDatabase,ssl:target.ssl,organizationId:organization.id,tenantId:tenant.id,generationId:tenant.generationId,login:tenant.apiLogin,credentialRef:tenant.credentialRef};
 assert.notEqual(tenantProfileMarker(config),'C4G_PRODUCTION_TENANT_API:'+createHash('sha256').update(JSON.stringify(old)).digest('hex'));
});

test('projection profile selections fail before creating connections',()=>{
 for(const make of [createMemberProjection,createDeletionProjection])assert.throws(()=>make({bindings,tenantApiProfile:'foreign-role-profile',createPool(){assert.fail('no pool');}}),/TENANT_API_PROFILE_INVALID/);
});

for(const profile of [undefined,'production-editorial-v1'])test(`member and deletion projections use explicit ${profile||'minimal default'} without granting roles`,async t=>{
 const runtimeModule=require('../src/config/opportunityRuntime'),observed=[],statements=[],events=[];
 t.mock.method(runtimeModule,'createConfiguredOpportunityRuntime',options=>{
  observed.push(options);return {bindingVerifier:{async verify(){}},poolManager:{async closeAll(){events.push('runtime-closed');}}};
 });
 const client={async query(sql){statements.push(sql);return {rows:sql.includes('erase_account_identity')?[{person_id:id(5)}]:[]};},release(){events.push('released');}};
 const createPool=()=>({async connect(){return client;},async end(){events.push('pool-closed');}});
 const options={bindings,createPool,...(profile?{tenantApiProfile:profile}:{})};
 assert.equal((await createMemberProjection(options).ensure(member)).projected,true);
 assert.equal((await createDeletionProjection(options).anonymize({...member,requestId:id(7)})).anonymized,true);
 assert.equal(observed.length,2);assert.ok(observed.every(value=>value.editorialEnabled===(profile==='production-editorial-v1')));
 assert.ok(statements.every(sql=>!/^\s*(?:GRANT|ALTER ROLE|CREATE ROLE)/i.test(sql)));
 assert.equal(events.filter(x=>x==='pool-closed').length,2);assert.equal(events.filter(x=>x==='runtime-closed').length,2);
});
