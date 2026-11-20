'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {installTenant,provisionTenantApiProfile,tenantProfileMarker,verifyTenantConnection,validateFreshBaseline}=require('../scripts/productionBootstrap/tenant');
const {accountIdentityErasureManifest}=require('../src/security/tenantMigrationManifest');
const config={installationId:'11111111-1111-4111-8111-111111111111',target:{host:'127.0.0.1',port:55432,expectedSystemIdentifier:'123456789',centralDatabase:'production_central',tenantDatabase:'production_tenant',ssl:false},organization:{id:'22222222-2222-4222-8222-222222222222'},tenant:{id:'33333333-3333-4333-8333-333333333333',generationId:'44444444-4444-4444-8444-444444444444',apiLogin:'production_tenant_api',credentialRef:'production-api-1',regionCode:'EU',residencyPolicyVersion:'production-v1'}};
const evidence={tenantId:config.tenant.id,databaseGenerationId:config.tenant.generationId,currentVersion:accountIdentityErasureManifest.at(-1).version,schemaFingerprint:accountIdentityErasureManifest.at(-1).schemaFingerprint,systemIdentifier:'123456789',capabilities:accountIdentityErasureManifest.at(-1).capabilities};
function installation(markerExists=false){
 const calls=[];
 const tenantPool={async query(sql){calls.push(sql);return {rows:[{marker_exists:markerExists,ledger_exists:markerExists,has_user_objects:markerExists,database:config.target.tenantDatabase,system_identifier:config.target.expectedSystemIdentifier}]};}};
 const deps={nativePool:pool=>pool,createRunner(options){calls.push({runner:options});return {async migrate(input){calls.push({migration:input});return {evidence};}};},async preflight(){calls.push('preflight');return evidence;},async ensureAudit(){calls.push('audit');},async provisionProfile(){calls.push('profile');},async verifyConnection(input){calls.push({verified:input});}};
 return {calls,tenantPool,deps};
}
test('fresh tenant installs the complete registered chain and returns only observed F4 identity',async()=>{
 const h=installation();
 const result=await installTenant({adminPool:{},tenantPool:h.tenantPool,config,credentials:{tenantApi:'a'.repeat(32)}},h.deps);
 assert.equal(h.calls.find(x=>x.runner).runner.entries,accountIdentityErasureManifest);
 assert.equal(h.calls.find(x=>x.migration).migration.tenantId,config.tenant.id);
 assert(h.calls.some(x=>typeof x==='string'&&x.startsWith('REVOKE ALL ON SCHEMA')));
 assert.equal(result.snapshot.observedSystemIdentifier,evidence.systemIdentifier);
 assert.equal(result.snapshot.schema.currentVersion,evidence.currentVersion);
 assert.equal(result.snapshot.schema.verifiedCapabilities.ACCOUNT_IDENTITY_ERASURE,true);
 assert.equal(result.tenantCredentials.password,'a'.repeat(32));
 assert(!JSON.stringify(result.snapshot).includes('a'.repeat(32)));
 assert(h.calls.indexOf('profile')<h.calls.findIndex(x=>x.verified));
});
test('replay does not normalize database ACLs before validating existing state',async()=>{
 const h=installation(true);
 await installTenant({adminPool:{},tenantPool:h.tenantPool,config,credentials:{tenantApi:'b'.repeat(32)}},h.deps);
 assert(!h.calls.some(x=>typeof x==='string'&&/^(REVOKE|GRANT|ALTER)/.test(x)));
});
test('failed limited-login verification never returns a publishable snapshot',async()=>{
 const h=installation();h.deps.verifyConnection=async()=>{throw Error('TENANT_LOGIN_AUTHENTICATION_FAILED');};
 await assert.rejects(installTenant({adminPool:{},tenantPool:h.tenantPool,config,credentials:{tenantApi:'c'.repeat(32)}},h.deps),/TENANT_LOGIN_AUTHENTICATION_FAILED/);
});
test('profile ownership binds installation, database, generation and login',()=>{
 const original=tenantProfileMarker(config);
 for(const changed of [{...config,installationId:'different'},{...config,target:{...config.target,tenantDatabase:'other'}},{...config,tenant:{...config.tenant,generationId:'different'}},{...config,tenant:{...config.tenant,apiLogin:'other_api'}}])assert.notEqual(tenantProfileMarker(changed),original);
 assert(!original.includes('password'));
});
function profileHarness(existing){
 const calls=[];
 const c={async query(sql){calls.push(sql);if(sql.includes('AS acquired'))return {rows:[{acquired:true}]};if(sql.includes('AS ownership'))return {rows:existing?[existing]:[]};if(sql.includes('AS unsafe'))return {rows:[{unsafe:false}]};if(sql.includes('AS login_connect'))return {rows:[{database:config.target.tenantDatabase,login_connect:true,public_connect:false},{database:config.target.centralDatabase,login_connect:false,public_connect:false}]};return {rows:[]};},release(){calls.push('release');}};
 return {calls,pool:{connect:async()=>c},deps:{async validateRoleChain(){},async validateFreshBaseline(){},async verifyPassword(){}}};
}
test('profile replay checks ownership and grants without rotating a password',async()=>{
 const h=profileHarness({ownership:tenantProfileMarker(config)});
 await provisionTenantApiProfile({pool:h.pool,config,password:'d'.repeat(32)},h.deps);
 assert(!h.calls.some(sql=>/CREATE ROLE|ALTER ROLE|COMMENT ON ROLE|GRANT /.test(sql)));
 assert(h.calls.includes('COMMIT'));
});
test('an existing unowned login is refused and never adopted',async()=>{
 const h=profileHarness({ownership:'foreign-installation'});
 await assert.rejects(provisionTenantApiProfile({pool:h.pool,config,password:'e'.repeat(32)},h.deps),/TENANT_PROFILE_OWNERSHIP_CONFLICT/);
 assert(h.calls.includes('ROLLBACK'));
 assert(!h.calls.some(sql=>/CREATE ROLE|ALTER ROLE|COMMENT ON ROLE|GRANT /.test(sql)));
});
test('password mismatch refuses replay even when the server accepts trust authentication',async()=>{
 const h=profileHarness({ownership:tenantProfileMarker(config)});
 h.deps.verifyPassword=async()=>{throw Error('PRODUCTION_CREDENTIAL_MISMATCH');};
 await assert.rejects(provisionTenantApiProfile({pool:h.pool,config,password:'changed'.repeat(5)},h.deps),/PRODUCTION_CREDENTIAL_MISMATCH/);
 assert(h.calls.includes('ROLLBACK'));
 assert(!h.calls.some(sql=>/ALTER ROLE|CREATE ROLE/.test(sql)));
});
test('wrong physical system identity cannot produce an F4 snapshot',async()=>{
 const h=installation(true);h.deps.preflight=async()=>({...evidence,systemIdentifier:'999'});
 await assert.rejects(installTenant({tenantPool:h.tenantPool,config,credentials:{tenantApi:'f'.repeat(32)}},h.deps),/PRODUCTION_TENANT_EVIDENCE_MISMATCH/);
 assert(!h.calls.some(x=>x.verified));
});
test('wrong physical destination is refused before migration or ACL changes',async()=>{
 const h=installation();h.tenantPool.query=async()=>({rows:[{database:'unrelated',system_identifier:'999'}]});
 await assert.rejects(installTenant({tenantPool:h.tenantPool,config,credentials:{tenantApi:'f'.repeat(32)}},h.deps),/PRODUCTION_TENANT_TARGET_MISMATCH/);
 assert.deepEqual(h.calls,[]);
});
test('an unmarked nonempty tenant is refused before ACL changes',async()=>{
 const h=installation();h.tenantPool.query=async()=>({rows:[{database:config.target.tenantDatabase,system_identifier:config.target.expectedSystemIdentifier,marker_exists:false,ledger_exists:false,has_user_objects:true}]});
 await assert.rejects(installTenant({tenantPool:h.tenantPool,config,credentials:{tenantApi:'f'.repeat(32)}},h.deps),/PRODUCTION_TENANT_BASELINE_INVALID/);
 assert.deepEqual(h.calls,[]);
});
test('fresh profile refuses drift instead of inheriting an elevated or unexpected baseline',async()=>{
 const good=['c4g_tenant_api_capabilities','c4g_opportunity_tenant_runtime','c4g_f4_metadata_executor'].map(rolname=>({rolname,rolcanlogin:false,rolinherit:false,rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,configured:false}));
 await assert.rejects(validateFreshBaseline({async query(){return {rows:good.map(row=>({...row,rolsuper:true}))};}}),/BASELINE_INVALID/);
 await assert.rejects(validateFreshBaseline({async query(sql){return {rows:sql.includes('pg_auth_members')?[]:good};}}),/BASELINE_INVALID/);
});
test('limited connection retains explicit TLS configuration and sanitizes failures while closing resources',async()=>{
 const events=[],ssl={rejectUnauthorized:true,ca:'synthetic CA'};
 const client={release(){events.push('release');}};
 class CandidatePool{constructor(options){assert.equal(options.ssl,ssl);}async connect(){return client;}async end(){events.push('end');}}
 const runtime={bindingVerifier:{async verify(){throw Error('postgresql://secret:password@host');}},poolManager:{async closeAll(){events.push('closeAll');}}};
 await assert.rejects(verifyTenantConnection({config:{...config,target:{...config.target,ssl}},snapshot:{},tenantCredentials:{}},{PoolClass:CandidatePool,createRuntime:()=>runtime}),error=>error.message==='PRODUCTION_TENANT_LIMITED_CONNECTION_FAILED');
 assert.deepEqual(events,['release','end','closeAll']);
});
