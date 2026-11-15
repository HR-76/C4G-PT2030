'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID,randomBytes}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const installer=require('../../../backend/scripts/installProductionPlatform');
async function run({pool,base,port,password,mode='full'}){
 const checks=[],check=async(name,work)=>{await work();checks.push({name,pass:true});console.log(JSON.stringify({name,pass:true}));};
 const config={version:1,installationId:randomUUID(),target:{host:'127.0.0.1',port,expectedSystemIdentifier:(await pool.query('SELECT (pg_control_system()).system_identifier::text AS id')).rows[0].id,
  centralDatabase:'c4g_central_production',tenantDatabase:'c4g_tenant_production',ssl:false},
  organization:{id:randomUUID(),name:'Disposable entity',legalName:'Disposable entity legal',slug:'disposable-entity',type:'OTHER',currency:'EUR',dataResidencyCode:'EU'},
  tenant:{id:randomUUID(),generationId:randomUUID(),apiLogin:'prod_tenant_api',credentialRef:'production-api-v1',regionCode:'EU',residencyPolicyVersion:'production-eu-v1'},
  administrator:{globalUserId:randomUUID(),membershipId:randomUUID(),issuer:'https://login.example.invalid/realms/c4g-production',subject:randomUUID(),name:'Disposable Administrator',email:'admin@example.invalid',organizationProfile:'ORG_ADMIN'}};
 const secret=()=>randomBytes(32).toString('hex'),credentials={central:Object.fromEntries(['read','commands','authoring','logs','retention','catalog','authority'].map(k=>[k,secret()])),tenantApi:secret(),permitSecret:secret()};
 const {runtimeConfig,runtimeCredentials}=require('./runtime-inputs.cjs').fixture(config);let preparedRuntime;
 const options={adminPool:pool,config,credentials,runtimeConfig,runtimeCredentials,onRuntimeArtifacts:artifacts=>{preparedRuntime=artifacts;},apply:true,allowInsecureLoopback:true,identityToken:'synthetic-read-only-keycloak-token',
  fetchImpl:async()=>({ok:true,json:async()=>({id:config.administrator.subject,email:config.administrator.email,enabled:true,emailVerified:true,requiredActions:[]})})};
 const state=async()=>({db:(await pool.query('SELECT datname,datacl::text FROM pg_database ORDER BY datname')).rows,roles:(await pool.query('SELECT rolname,rolsuper,rolcanlogin FROM pg_roles ORDER BY rolname')).rows});
 await check('default plan performs no mutations',async()=>{const before=await state();const result=await installer.install({...options,apply:false,credentials:undefined,identityToken:undefined});assert.equal(result.apply,false);assert.deepEqual(await state(),before);});
 await check('wrong physical identity and staging config fail before mutations',async()=>{const before=await state();await assert.rejects(installer.install({...options,config:{...config,target:{...config.target,expectedSystemIdentifier:'1'}}}),/SYSTEM_IDENTIFIER_MISMATCH/);await assert.rejects(installer.install({...options,config:{...config,target:{...config.target,centralDatabase:'staging'}}}),/CONFIG_INVALID/);assert.deepEqual(await state(),before);});
 await check('unverified provider identity fails before any database creation',async()=>{const before=await state();await assert.rejects(installer.install({...options,fetchImpl:async()=>({ok:true,json:async()=>({id:'wrong'})})}),/ADMINISTRATOR_UNVERIFIED/);assert.deepEqual(await state(),before);});
 await check('shared instance and foreign roles are refused',async()=>{await pool.query('CREATE DATABASE foreign_application');try{await assert.rejects(installer.install({...options,apply:false}),/DEDICATED_INSTANCE_REQUIRED/);}finally{await pool.query('DROP DATABASE foreign_application');}await pool.query('CREATE ROLE foreign_login LOGIN');try{await assert.rejects(installer.install({...options,apply:false}),/FOREIGN_ROLES_PRESENT/);}finally{await pool.query('DROP ROLE foreign_login');}});
 for(const phase of (mode==='fresh'?[]:['databases-ready','central-migrated','central-profiles-ready','tenant-ready','identity-seeded','directory-published','administrator-projected','identity-active'])){
  await check('retains resources and demotes technical owner after '+phase,async()=>{
   await assert.rejects(installer.install({...options,onPhase:async current=>{if(current===phase)throw Error('INJECTED_PHASE_FAILURE');}}),/INJECTED_PHASE_FAILURE/);
   const technical=(await pool.query("SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='c4g_f12_admin'")).rows[0];
   if(technical)assert.ok(Object.values(technical).every(value=>value===false));
  });
  if(phase==='databases-ready')await check('migration failure rolls back full Central chain and demotes its owner',async()=>{
   await assert.rejects(installer.install({...options,afterMigrationSql:async({entry})=>{if(entry.version==='057_production_central_permissions')throw Error('INJECTED_MIGRATION_FAILURE');}}),/INJECTED_MIGRATION_FAILURE/);
   assert.equal((await pool.query("SELECT rolname FROM pg_roles WHERE rolname='c4g_prod_read_role'")).rowCount,0);
   assert.equal((await pool.query("SELECT rolsuper FROM pg_roles WHERE rolname='c4g_f12_admin'")).rows[0].rolsuper,false);
  });
 }
 let receipt;
 await check('complete installation succeeds after all durable phase interruptions',async()=>{receipt=await installer.install(options);assert.equal(receipt.centralVersion,'058_platform_account_lifecycle');assert.equal(receipt.tenantVersion,'041_account_identity_erasure');assert.equal(receipt.mfa,'OPTIONAL');});
 const admin={host:'127.0.0.1',port,user:'bootstrap_admin',password,options:'-c timezone=UTC'};
 const central=new Pool({...admin,database:config.target.centralDatabase}),tenant=new Pool({...admin,database:config.target.tenantDatabase});
 try{
  await check('replay preserves data and password verifiers without duplicate admin or membership',async()=>{
   const passwords=()=>pool.query("SELECT rolname,rolpassword FROM pg_authid WHERE rolpassword IS NOT NULL ORDER BY rolname").then(r=>r.rows);
   const before=await passwords(),users=(await central.query('SELECT * FROM public.global_user')).rows;
   assert.deepEqual(await installer.install(options),receipt);assert.deepEqual(await passwords(),before);assert.deepEqual((await central.query('SELECT * FROM public.global_user')).rows,users);
   assert.equal((await central.query('SELECT count(*)::int AS n FROM public.organization_membership')).rows[0].n,1);
  });
  await check('changed immutable config or secret is refused without replacement',async()=>{
   await assert.rejects(installer.install({...options,runtimeConfig:null,runtimeCredentials:null}),/PRODUCTION_RUNTIME_CONFIGURATION_REQUIRED/);
   await assert.rejects(installer.install({...options,config:{...config,organization:{...config.organization,name:'Changed'}}}),/OWNERSHIP_MISMATCH/);
   await assert.rejects(installer.install({...options,credentials:{...credentials,central:{...credentials.central,read:secret()}}}),/CREDENTIAL_MISMATCH/);
   await assert.rejects(installer.install({...options,credentials:{...credentials,permitSecret:secret()}}),/CREDENTIAL_MISMATCH/);
   await assert.rejects(installer.install({...options,runtimeCredentials:{...runtimeCredentials,memberOwnershipKey:secret()}}),/CREDENTIAL_MISMATCH/);
   await assert.rejects(installer.install({...options,runtimeConfig:{...runtimeConfig,app:{...runtimeConfig.app,uiKeyId:'changed'}}}),/RUNTIME_INTENT_CONFLICT/);
  });
  await check('stale technical elevation is repaired on safe replay',async()=>{
   await pool.query('ALTER ROLE c4g_f12_admin SUPERUSER');
   await installer.install(options);
   assert.equal((await pool.query("SELECT rolsuper FROM pg_roles WHERE rolname='c4g_f12_admin'")).rows[0].rolsuper,false);
  });
  await check('058 and 041 pinned preflights remain exact after activation',async()=>{
   assert.equal((await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(central)).currentVersion,receipt.centralVersion);
   assert.equal((await require('../../../backend/src/security/tenantMigrationPreflight').preflightTenant(tenant,{tenantId:config.tenant.id,databaseGenerationId:config.tenant.generationId},require('../../../backend/src/security/tenantMigrationManifest').accountIdentityErasureManifest,{timeoutMs:30000})).currentVersion,receipt.tenantVersion);
  });
  await check('all service identities are limited and confined to their database',async()=>{
   for(const [key,login] of Object.entries(receipt.logins)){
    const database=key==='tenantApi'?config.target.tenantDatabase:config.target.centralDatabase;
    const raw=new Pool({host:'127.0.0.1',port,database,user:login,password:key==='tenantApi'?credentials.tenantApi:key==='billingMail'?runtimeCredentials.billingDatabasePassword:credentials.central[key]});
    try{
     const attrs=(await raw.query('SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,rolinherit FROM pg_roles WHERE rolname=current_user')).rows[0];assert.ok(Object.values(attrs).every(x=>x===false));
     const connects=(await raw.query("SELECT datname FROM pg_database WHERE datallowconn AND has_database_privilege(current_user,oid,'CONNECT') ORDER BY datname")).rows.map(r=>r.datname);assert.deepEqual(connects,[database]);
     await assert.rejects(raw.query('SET ROLE c4g_f12_admin'),{code:'42501'});
    }finally{await raw.end();}
   }
  });
  await check('limited tenant login enforces organization RLS and rejects Central connection',async()=>{
   const raw=new Pool({host:'127.0.0.1',port,database:config.target.tenantDatabase,user:config.tenant.apiLogin,password:credentials.tenantApi});
   const client=await raw.connect();
   try{
    await client.query('BEGIN');await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');await client.query("SELECT set_config('app.organization_id',$1,true)",[config.organization.id]);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM organizational_scope.person')).rows[0].n,1);
    await client.query("SELECT set_config('app.organization_id',$1,true)",[randomUUID()]);assert.equal((await client.query('SELECT count(*)::int AS n FROM organizational_scope.person')).rows[0].n,0);
    await client.query('ROLLBACK');await assert.rejects(client.query('SELECT * FROM c4g_system.tenant_identity'),{code:'42501'});
   }finally{await client.query('ROLLBACK');client.release();await raw.end();}
   const wrong=new Pool({host:'127.0.0.1',port,database:config.target.centralDatabase,user:config.tenant.apiLogin,password:credentials.tenantApi});
   try{await assert.rejects(wrong.query('SELECT 1'),{code:'42501'});}finally{await wrong.end();}
  });
  await check('billing mail login can only claim and finish deliveries without table access or role escalation',async()=>{
   const login=receipt.logins.billingMail;assert.equal(login,'c4g_prod_billing_mail');
   const raw=new Pool({host:'127.0.0.1',port,database:config.target.centralDatabase,user:login,password:runtimeCredentials.billingDatabasePassword});
   try{
    assert.equal((await raw.query('SELECT public.billing_validation_email_claim() AS delivery')).rows[0].delivery,null);
    assert.equal((await raw.query('SELECT public.billing_validation_email_finish($1,$2,true) AS accepted',[randomUUID(),randomUUID()])).rows[0].accepted,false);
    await assert.rejects(raw.query('SELECT * FROM public.billing_account_validation_email'),{code:'42501'});
    await assert.rejects(raw.query('SELECT * FROM public.global_user'),{code:'42501'});
    await assert.rejects(raw.query('SET ROLE c4g_billing_validation_worker'),{code:'42501'});
    await assert.rejects(raw.query('CREATE TABLE public.worker_escalation(id integer)'),{code:'42501'});
   }finally{await raw.end();}
   await central.query('GRANT SELECT ON public.global_user TO c4g_prod_billing_mail');
   try{
    await assert.rejects(require('../../../backend/scripts/productionBootstrap/billing').validateBillingProfile({config,password:runtimeCredentials.billingDatabasePassword,Pool}),/PRODUCTION_BILLING_PRIVILEGE_DRIFT/);
    await assert.rejects(installer.install(options),/drift/i);
   }
   finally{await central.query('REVOKE SELECT ON public.global_user FROM c4g_prod_billing_mail');}
  });
  await check('privilege drift fails closed and does not repair or elevate the login',async()=>{
   await central.query('ALTER ROLE c4g_prod_api_read CREATEDB');
   try{await assert.rejects(installer.install(options),/DRIFT/);assert.equal((await pool.query("SELECT rolcreatedb FROM pg_roles WHERE rolname='c4g_prod_api_read'")).rows[0].rolcreatedb,true);}
   finally{await central.query('ALTER ROLE c4g_prod_api_read NOCREATEDB');}
  });
  await check('public receipt contains no secrets; private artifacts are explicit and conflict-safe',async()=>{
   const text=JSON.stringify(receipt);for(const value of [...Object.values(credentials.central),credentials.tenantApi,credentials.permitSecret,...Object.values(runtimeCredentials)])assert.equal(text.includes(value),false);
   const artifacts=installer.runtimeArtifacts(config,credentials,receipt),dir=path.join(base,'private-output');installer.writeArtifacts(dir,artifacts);installer.writeArtifacts(dir,artifacts);
   assert.throws(()=>installer.writeArtifacts(dir,{'central-runtime.env':'different'}),/OUTPUT_CONFLICT/);
   for(const name of Object.keys(artifacts))fs.unlinkSync(path.join(dir,name));fs.rmdirSync(dir);
  });
  await check('private runtime bundle uses observed F4 binding and keeps provider secrets outside API environment',async()=>{
   assert.ok(preparedRuntime);
   const worker=JSON.parse(preparedRuntime['member-worker.json']),http=JSON.parse(preparedRuntime['member-http.json']);
   assert.equal(worker.tenantApiProfile,'production-editorial-v1');assert.equal(worker.bindings[0].snapshot.organizationId,config.organization.id);
   assert.equal(worker.bindings[0].snapshot.observedSystemIdentifier,config.target.expectedSystemIdentifier);
   assert.equal(http.issuer,config.administrator.issuer);
   assert.match(preparedRuntime['api-features.env'],/MEMBER_ONBOARDING_RUNTIME=central/);
   assert.match(preparedRuntime['api-features.env'],/USER_DELETION_RUNTIME=central/);
   assert.match(preparedRuntime['api-features.env'],/BILLING_VALIDATION_RUNTIME=central/);
   assert.match(preparedRuntime['api-features.env'],/"mfa":false/);
   for(const value of [runtimeCredentials.memberClientSecret,runtimeCredentials.memberResendApiKey,runtimeCredentials.billingResendApiKey,runtimeCredentials.billingDatabasePassword])assert.equal(preparedRuntime['api-features.env'].includes(value),false);
   assert.ok(preparedRuntime['billing-mail.env'].includes(encodeURIComponent(runtimeCredentials.billingDatabasePassword)));
  });
  await require('./permissions-checks.cjs').run({central,tenant,config,credentials,connection:admin,check});
  await require('./identity-checks.cjs').run({central,tenant,config,credentials,connection:admin,check});
  await require('./editorial-lifecycle.cjs').run({central,tenant,config,credentials,connection:admin,check});
 }finally{await central.end();await tenant.end();}
 fs.writeFileSync(path.join(base,'results.json'),JSON.stringify({postgres:'18',mode,checks,total:checks.length,receipt},null,2));
}
module.exports={run};
