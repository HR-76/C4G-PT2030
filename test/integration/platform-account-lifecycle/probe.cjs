'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const m=require('../../../backend/src/security/centralMigrationManifest'),runner=require('../../../backend/scripts/runCentralMigrations');
const pkg=require('../../../backend/src/security/platformAccountLifecycleMigrationPackage');
const schema=require('../../../backend/src/security/centralSchemaManifest'),authority=require('../../../backend/src/security/authoritySecurityManifest');
const {preflightCentral}=require('../../../backend/src/security/centralMigrationPreflight');
const {Pool}=require('../../../backend/node_modules/pg');
async function pins(pool){
 const result={upChecksum:m.migrationSql(pkg.entry.version,'up').checksum,schemaFingerprint:schema.schemaFingerprint(await schema.centralSchemaSnapshot(pool,{compactAuthority:true})),authoritySecurityFingerprint:authority.digest(await authority.authoritySecuritySnapshot(pool))};
 for(const [field,file,method] of [['catalogSecurityFingerprint','catalogSecurityManifest','catalogSecuritySnapshot'],['euWriterSecurityFingerprint','euWriterSecurityManifest','euWriterSecuritySnapshot'],['euRunReconciliationSecurityFingerprint','euRunReconciliationSecurityManifest','euRunReconciliationSecuritySnapshot'],['euLegacyPrearchiveSecurityFingerprint','euLegacyPrearchiveSecurityManifest','snapshot'],['productionSecurityFingerprint','productionCentralSecurity','snapshot']]){
  const module=require('../../../backend/src/security/'+file);result[field]=module.digest(await module[method](pool));
 }
 result.readFingerprint=await require('../../../backend/src/opportunities/catalogRead/dedicatedCredentials').normalReadFingerprint(pool);
 return result;
}
async function run({pool,base,port,mode}){
 const checks=[],check=async(name,work)=>{await work();checks.push({name,pass:true});console.log(JSON.stringify({name,pass:true}));};
 await pool.query('CREATE ROLE c4g_central_owner NOLOGIN; CREATE ROLE c4g_central_runtime NOLOGIN');
 await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL); INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
 await runner.applyCentralMigrationsWithManifest(pool,mode==='fresh'?m.platformAccountLifecycleManifest:m.productionCentralManifest,m.migrationSql);
 const ledger=()=>pool.query('SELECT * FROM public.c4g_schema_migration ORDER BY version').then(r=>r.rows);
 const beforeLedger=await ledger();
 if(mode!=='fresh'){
  await check('unchanged 057 denies invitation receipt and deletion protocol commands',async()=>{
   const c=await pool.connect();
   try{
    await c.query('SET SESSION AUTHORIZATION c4g_authority_runtime');
    const execute=require('../../../backend/src/security/authorityProtocolQueries').execute;
    await assert.rejects(execute(c,require('../../../backend/src/platformOnboarding/memberSql').emailDelivery,[randomUUID(),'{}',randomUUID()]),/AUTHORITY_QUERY_DENIED/);
    await assert.rejects(execute(c,require('../../../backend/src/platformDirectory/deletionSql').operation,[randomUUID()]),/AUTHORITY_QUERY_DENIED/);
   }finally{await c.query('RESET SESSION AUTHORIZATION');c.release();}
  });
 }
 if(mode==='calibrate'){
  await pool.query(m.migrationSql(pkg.entry.version,'up').sql);
  const observed=await pins(pool);fs.writeFileSync(path.join(base,'pins.json'),JSON.stringify(observed,null,2));console.log(JSON.stringify(observed));return;
 }
 if(mode==='upgrade'){
  const sentinel=randomUUID();
  await pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Preserved synthetic account',$2,'ACTIVE')",[sentinel,sentinel+'@example.invalid']);
  const beforeData=(await pool.query('SELECT * FROM public.global_user WHERE id=$1',[sentinel])).rows;
  await check('failed migration rolls back schema, ledger and existing data',async()=>{
   await assert.rejects(runner.applyCentralMigrationsWithManifest(pool,m.platformAccountLifecycleManifest,m.migrationSql,{requiredBaseVersion:pkg.CENTRAL_BASELINE,afterSql:async({entry})=>{if(entry.version===pkg.entry.version)throw Error('INJECTED_MIGRATION_FAILURE');}}),/INJECTED_MIGRATION_FAILURE/);
   assert.deepEqual(await ledger(),beforeLedger);await schema.assertCentralSchema(pool,pkg.CENTRAL_BASELINE);
   assert.deepEqual((await pool.query('SELECT * FROM public.global_user WHERE id=$1',[sentinel])).rows,beforeData);
  });
  await check('explicit checked installer upgrades 057 without changing prior records or provisioning logins',async()=>{
   const install=require('../../../backend/scripts/installPlatformAccountLifecycle').install;
   await assert.rejects(install(pool,{expectedDatabase:'staging',apply:true}),/PRODUCTION_TARGET_REQUIRED/);
   await assert.rejects(install(pool,{expectedDatabase:'wrong_target',apply:true}),/PRODUCTION_TARGET_MISMATCH/);
   assert.equal((await install(pool,{expectedDatabase:'postgres'})).apply,false);assert.deepEqual(await ledger(),beforeLedger);
   assert.deepEqual((await install(pool,{expectedDatabase:'postgres',apply:true})).applied,[pkg.entry.version]);
   assert.deepEqual((await ledger()).slice(0,-1),beforeLedger);
   assert.deepEqual((await pool.query('SELECT * FROM public.global_user WHERE id=$1',[sentinel])).rows,beforeData);
  });
 }
 await check('registered package replay is idempotent and all exact fingerprints match',async()=>{
  const before=await ledger();assert.deepEqual(await runner.applyRegisteredPlatformAccountLifecyclePackage(pool,pkg.PACKAGE_ID),[]);assert.deepEqual(await ledger(),before);
  assert.equal((await preflightCentral(pool)).currentVersion,pkg.entry.version);
  const observed=await pins(pool);for(const [key,value] of Object.entries(observed))assert.equal(value,pkg.entry[key],key);
  for(const field of ['productionSecurityFingerprint','readFingerprint','catalogSecurityFingerprint','euWriterSecurityFingerprint','euRunReconciliationSecurityFingerprint','euLegacyPrearchiveSecurityFingerprint'])assert.equal(observed[field],require('../../../backend/src/security/productionCentralMigrationPackage').entry[field],field+' must preserve 057 privileges');
  fs.writeFileSync(path.join(base,'pins.json'),JSON.stringify(observed,null,2));
 });
 const raws=[],caps={},connection={host:'127.0.0.1',port,database:'postgres'};
 try{
  const {ROLES,createRolePool}=require('../../../backend/src/security/productionCentralProfile');
  for(const [capability,role] of Object.entries(ROLES)){
   const login='lifecycle_'+capability;
   await pool.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
   await pool.query(`GRANT ${role} TO ${login} WITH INHERIT FALSE, SET TRUE, ADMIN FALSE`);
   await pool.query(`GRANT CONNECT ON DATABASE postgres TO ${login}`);
   const raw=new Pool({...connection,user:login});raws.push(raw);caps[capability]=createRolePool(raw,capability);
   await check(capability+': 058 preflight with unchanged limited capability and no direct account DML',async()=>{
    assert.equal((await preflightCentral(caps[capability])).currentVersion,pkg.entry.version);
    for(const sql of ['SELECT * FROM public.platform_user_deletion','DELETE FROM public.platform_user_deletion',"UPDATE public.global_user SET display_name='forbidden'",'SELECT * FROM public.application_session_store','CREATE TABLE public.forbidden(id int)'])await assert.rejects(caps[capability].query(sql),{code:'42501'});
    await assert.rejects(raw.query('SET ROLE c4g_authority_owner'),{code:'42501'});
   });
  }
  await pool.query('ALTER ROLE c4g_authority_runtime LOGIN');
  const raw=new Pool({...connection,user:'c4g_authority_runtime',max:3});raws.push(raw);
  const coordinator=require('../../../backend/src/security/authorityCoordinator').createAuthorityCoordinator({pool:raw,permitSecret:'isolated-account-lifecycle-proof-'.repeat(2),timeoutMs:30000});
  await check('authority login remains limited; direct reads, DML and owner escalation denied',async()=>{
   const attributes=(await raw.query("SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit FROM pg_roles WHERE rolname=current_user")).rows[0];assert.ok(Object.values(attributes).every(value=>value===false));
   for(const sql of ['SELECT * FROM public.platform_user_deletion','DELETE FROM public.platform_user_deletion',"UPDATE public.global_user SET display_name='forbidden'",'SET ROLE c4g_authority_owner'])await assert.rejects(raw.query(sql),{code:'42501'});
  });
  await check('058 catalog, production lifecycle readiness and metadata observation work under limited read',async()=>{
   assert.equal(await require('../../../backend/src/security/catalogReaderSchema').assertCatalogReaderSchema(caps.read),pkg.entry.version);
   await schema.assertCentralSchemaForVersions(caps.read,[pkg.entry.version]);
   await require('../../../backend/src/security/databaseReadiness').observeCentralDatabase(caps.read);
  });
  await check('dedicated catalog login admits 058 and retains derived-table privileges without account access',async()=>{
   await pool.query('CREATE ROLE lifecycle_catalog LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
   await pool.query('GRANT c4g_catalog_reader TO lifecycle_catalog WITH INHERIT FALSE, SET TRUE, ADMIN FALSE; GRANT CONNECT ON DATABASE postgres TO lifecycle_catalog');
   const reader=new Pool({...connection,user:'lifecycle_catalog'});raws.push(reader);
   const c=await reader.connect();
   try{
    const admission=await require('../../../backend/src/security/catalogReaderSchema').createReaderSchemaAdmission(c);
    assert.equal(admission.version,pkg.entry.version);
    await require('../../../backend/src/security/catalogReaderSecurity').assertReaderSession(c,admission);
    await c.query('BEGIN');await c.query('SET LOCAL ROLE c4g_catalog_reader');
    assert.ok((await c.query('SELECT count(*)::int n FROM opportunity_catalog.opportunity')).rows[0].n>=0);
    await assert.rejects(c.query('SELECT * FROM public.platform_user_deletion'),{code:'42501'});
   }finally{await c.query('ROLLBACK');c.release();}
  });
  const invitations=await require('./invitations.cjs').run({pool,coordinator,check,base,port});
  const deletion=await require('./deletion.cjs').run({pool,coordinator,check,base,port});
  await check('schema, ledger and authority permission drift are refused',async()=>{
   await pool.query('GRANT SELECT ON public.platform_user_deletion TO c4g_prod_read_role');
   await assert.rejects(caps.read.query('SELECT 1'),/SECURITY_DRIFT/);
   await pool.query('REVOKE SELECT ON public.platform_user_deletion FROM c4g_prod_read_role');
   await pool.query("ALTER FUNCTION authority_api.execute(text,text[],text) SET search_path TO public,pg_catalog");
   await assert.rejects(preflightCentral(pool),/drift/i);
   await pool.query('ALTER FUNCTION authority_api.execute(text,text[],text) SET search_path TO pg_catalog, public, pg_temp');
   await pool.query('UPDATE public.c4g_schema_migration SET checksum_sha256=$1 WHERE version=$2',['0'.repeat(64),pkg.entry.version]);
   await assert.rejects(preflightCentral(pool),/differs/);
   await pool.query('UPDATE public.c4g_schema_migration SET checksum_sha256=$1 WHERE version=$2',[pkg.entry.upChecksum,pkg.entry.version]);
   await preflightCentral(pool);
  });
  await check('actual tenant041 identity erasure preserves RLS and repeatability',()=>require('../user-deletion/tenant.cjs')({admin:pool,connection:{...connection,user:'c4g_f12_admin'},backend:path.resolve(__dirname,'../../../backend'),base}));
  fs.writeFileSync(path.join(base,'results.json'),JSON.stringify({pass:true,mode,checks,invitations,deletion,limits:['External identity, mail and OIDC ports are simulated. Tenant041 erasure separately exercised on real PostgreSQL.']},null,2));
 }finally{await Promise.all(raws.map(raw=>raw.end()));}
}
module.exports={run};
