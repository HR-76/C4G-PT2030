'use strict';

// Only the owned native-PostgreSQL launcher may supply configuration on stdin.

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');

const {randomUUID}=require('node:crypto');

const {Pool}=require('../../../backend/node_modules/pg');

const {buildProjection,emptyExtension,stableId}=require('../../../backend/src/opportunities/catalogRead/model');

const {contentDigestV2}=require('../../../backend/src/opportunities/v2/digests');

const root=path.resolve(__dirname,'../../..');

const report={status:'RUNNING',checks:[],isolated:true,sourceConnections:false,applicationDatabaseAccess:false};

let phase='START';

const check=async(name,fn)=>{phase=name;console.log('PHASE '+name);await fn();report.checks.push({name,status:'PASS'});};

async function main(){

 assert.deepEqual(process.argv.slice(2),['--isolated']);

 const config=JSON.parse(fs.readFileSync(0,'utf8'));

 assert.equal(config.host,'127.0.0.1');assert(config.port>1024&&config.port!==5432);assert.match(config.database,/^gcni_catalog_[a-f0-9]{12}$/);

 const settings={host:config.host,port:config.port,user:config.user,password:config.password,database:'postgres',connectionTimeoutMillis:5000,query_timeout:30000,options:'-c timezone=UTC -c statement_timeout=25000 -c lock_timeout=5000'};

 const admin=new Pool({...settings,max:1});let pool;let provider;

 try{

  await check('OWNED_POSTGRES18_CLUSTER',async()=>{

   const r=(await admin.query("SELECT current_setting('data_directory') AS dir, current_setting('server_version') AS version")).rows[0];

   assert.equal(path.resolve(r.dir).toLowerCase(),path.resolve(config.dataDirectory).toLowerCase());assert.match(r.version,/^18\./);report.postgres=r.version;

   const owner=JSON.parse(fs.readFileSync(path.join(path.dirname(config.dataDirectory),'owner.json'),'utf8'));assert.equal(owner.gateId,config.gateId);

   await admin.query('CREATE DATABASE '+config.database+" ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0");

   pool=new Pool({...settings,database:config.database,max:5});

  });

  await check('REAL_CENTRAL_BASELINE_AND_V2_CANDIDATE',async()=>{

   for(const role of ['c4g_central_owner','c4g_central_runtime','c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime'])await pool.query(`CREATE ROLE ${role} NOLOGIN ${role.startsWith('c4g_central_')?'INHERIT':'NOINHERIT'} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);

   await pool.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');

   await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");

   const m=require('../../../backend/src/security/centralMigrationManifest');

   const entries=m.prearchiveManifest;

   await require('../../../backend/scripts/runCentralMigrations').applyCentralMigrationsWithManifest(pool,entries,m.migrationSql);

   report.baseline=entries.at(-1).version;report.baselineMode='full';



  });

  await check('ISOLATED_SOURCE_CONTROL_QUIESCED',async()=>{for(const state of ['SUSPEND_REQUESTED','QUIESCED'])await pool.query('UPDATE opportunity_catalog.eu_source_control_v2 SET state=$1,fence=fence+1,changed_by=$2,changed_at=clock_timestamp()',[state,randomUUID()]);});


 const m=require('../../../backend/src/security/centralMigrationManifest');
 const runner=require('../../../backend/scripts/runCentralMigrations');
 const preflight=require('../../../backend/src/security/centralMigrationPreflight').preflightCentral;
 await check('NORMAL_045_ADMITTED',async()=>assert.equal((await preflight(pool)).currentVersion,m.prearchiveManifest.at(-1).version));
 await check('EXPLICIT_PACKAGE_ID_REQUIRED',async()=>assert.rejects(()=>runner.applyRegisteredCatalogReadPackage(pool,'other')));

 await check('FAILED_INSTALL_ROLLS_BACK_TO_045',async()=>{
 await assert.rejects(()=>runner.applyCentralMigrationsWithManifest(pool,m.knownManifest,m.migrationSql,{requiredBaseVersion:m.prearchiveManifest.at(-1).version,afterSql:async({entry})=>{if(entry.version.startsWith('047'))throw Error('INJECTED_FAILURE');}}),/INJECTED_FAILURE/);
 assert.equal((await preflight(pool)).currentVersion,m.prearchiveManifest.at(-1).version);
 assert.equal((await pool.query("SELECT to_regnamespace('catalog_read') IS NULL AS absent")).rows[0].absent,true);
 });
 await check('ATOMIC_048_INSTALL',async()=>assert.equal((await runner.applyRegisteredCatalogReadPackage(pool,'catalog-read-v1')).length,3));
 await check('NORMAL_048_ADMITTED',async()=>assert.equal((await preflight(pool)).currentVersion,m.knownManifest.at(-1).version));

 await check('LIMITED_AUTHORITY_NORMAL_ADMISSION_048',async()=>{
 const c=await pool.connect();try{
 await c.query('SET SESSION AUTHORIZATION c4g_authority_runtime');
 assert.equal((await require('../../../backend/src/security/authoritySecurityManifest').assertAuthorityAdmission(c)).currentVersion,m.knownManifest.at(-1).version);
 }finally{await c.query('RESET SESSION AUTHORIZATION');c.release();}
 });
 await check('LEGACY_CATALOG_READER_ACCEPTS_048',async()=>{const c=await pool.connect();try{assert.equal(await require('../../../backend/src/security/catalogReaderSchema').assertCatalogReaderSchema(c),m.knownManifest.at(-1).version);}finally{c.release();}});
 await check('REPLAY_IDEMPOTENT',async()=>assert.deepEqual(await runner.applyRegisteredCatalogReadPackage(pool,'catalog-read-v1'),[]));
 const mutate=async(sql)=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query(sql);
 // The normal preflight owns its transaction; use a transaction-local facade only
 // for fault injection so each test rolls back its mutation afterwards.
 const facade={connect:async()=>({query:(q,...v)=>['BEGIN TRANSACTION READ ONLY','COMMIT','ROLLBACK'].includes(q)?Promise.resolve({rows:[]}):c.query(q,...v),release(){}})};
 await assert.rejects(()=>preflight(facade));await c.query('ROLLBACK');}finally{c.release();}};
 await check('PARTIAL_047_REFUSED',()=>mutate("DELETE FROM public.c4g_schema_migration WHERE version LIKE '048_%'"));
 await check('PARTIAL_046_REFUSED',()=>mutate("DELETE FROM public.c4g_schema_migration WHERE version LIKE '047_%' OR version LIKE '048_%'"));
 await check('CHECKSUM_DRIFT_REFUSED',()=>mutate("UPDATE public.c4g_schema_migration SET checksum_sha256='bad' WHERE version LIKE '048_%'"));
 await check('GAP_REFUSED',()=>mutate("DELETE FROM public.c4g_schema_migration WHERE version LIKE '046_%'"));
 await check('READ_SCHEMA_DRIFT_REFUSED',()=>mutate('CREATE TABLE catalog_read.unexpected(id integer)'));
 await check('PUBLIC_PRIVILEGE_REFUSED',()=>mutate('GRANT USAGE ON SCHEMA catalog_read TO PUBLIC'));
 await check('AUTHORITY_PRIVILEGE_REFUSED',()=>mutate('ALTER ROLE c4g_authority_runtime SUPERUSER'));
 await check('FRESH_ADMISSION_AFTER_ROLLBACK',async()=>assert.equal((await preflight(pool)).currentVersion,m.knownManifest.at(-1).version));
 await check('SOURCES_REMAIN_QUIESCED',async()=>assert.deepEqual((await pool.query('SELECT DISTINCT state FROM opportunity_catalog.eu_source_control_v2')).rows,[{state:'QUIESCED'}]));

 const target={host:config.host,port:config.port,database:config.database};
 const {prepareDedicatedCredentials}=require('./prepare-dedicated-credentials.cjs');
 const {PROFILE}=require('../../../backend/src/opportunities/catalogRead/dedicatedCredentials');
 const providerModule=require('../../../backend/src/opportunities/catalogRead/isolatedDurableProvider');
 const policySql=fs.readFileSync(path.join(__dirname,'../catalog-controls/schema.sql'),'utf8');
 await check('DURABLE_POLICY_INSTALLED_OFF',async()=>{
  assert.equal(require('node:crypto').createHash('sha256').update(policySql.replace(/\r\n/g,'\n')).digest('hex'),'a2cc6b4ae5b1b5af7e65a5e23917c9ee0e3cb32a0435b156712be3d7b3b10ede');
  await pool.query(policySql);assert.equal((await pool.query('SELECT policy FROM gcni_catalog_control_rehearsal.state')).rows[0].policy.mode,'OFF');
 });
 let credentials;
 await check('DEDICATED_SCRAM_CREDENTIALS',async()=>{
  credentials=await prepareDedicatedCredentials({isolated:true,pool,target,dataDirectory:config.dataDirectory,gateId:config.gateId});
  const rows=(await pool.query("SELECT rolname,rolpassword LIKE 'SCRAM-SHA-256$%' AS scram FROM pg_authid WHERE rolname=ANY($1::text[])",[Object.values(PROFILE).map(p=>p.login)])).rows;
  assert.equal(rows.length,3);assert(rows.every(r=>r.scram));assert.equal(new Set(Object.values(credentials)).size,3);
 });

 await check('SEPARATE_PROCESS_CONFIRMS_DURABLE_OFF',async()=>{
  const child=require('node:child_process').spawn(process.execPath,[path.join(__dirname,'durable-provider-worker.cjs')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='';child.stdout.on('data',b=>{output+=b;});child.stderr.resume();
  const completed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('WORKER_FAILED '+output)));});
  child.stdin.end(JSON.stringify({isolated:true,target,credentials,key:require('node:crypto').randomBytes(32).toString('hex'),policyVersion:'isolated-provider-v1'}));
  await completed;assert.deepEqual(JSON.parse(output),{ready:true,mode:'disabled'});
 });
 await check('CREDENTIAL_REPROVISION_REFUSED',()=>assert.rejects(()=>prepareDedicatedCredentials({isolated:true,pool,target,dataDirectory:config.dataDirectory,gateId:config.gateId}),/ALREADY_EXIST/));
 await check('NORMAL_048_WITH_DEDICATED_CREDENTIALS',async()=>assert.equal((await preflight(pool)).currentVersion,m.knownManifest.at(-1).version));

 await check('NORMAL_LIMITED_AUTHORITY_WITH_DEDICATED_CREDENTIALS',async()=>{
  const c=await pool.connect();try{await c.query('SET SESSION AUTHORIZATION c4g_authority_runtime');assert.equal((await require('../../../backend/src/security/authoritySecurityManifest').assertAuthorityAdmission(c)).currentVersion,m.knownManifest.at(-1).version);}finally{await c.query('RESET SESSION AUTHORIZATION');c.release();}
 });
 const factory=providerModule.createIsolatedDurableReaderProvider({isolated:true,target,credentials,Pool,express:require('../../../backend/node_modules/express'),key:require('node:crypto').randomBytes(32),policyVersion:'isolated-provider-v1'});
 await check('DISABLED_CONNECTION_DOES_NOT_INSTANTIATE_PROVIDER',async()=>{
  let calls=0;const connection=require('../../../backend/src/opportunities/catalogRead/functionalConnection').createCatalogReadConnection({mode:'disabled',createRuntime(){calls++;return factory();}});
  assert.equal(await connection.ready(),true);assert.equal(calls,0);await connection.close();
 });
 await check('PROVIDER_PREPARED_OFF_WITHOUT_OPERATOR',async()=>{provider=factory();assert.equal(await provider.ready(),true);assert.equal(provider.mode,'disabled');assert.equal(provider.operator,undefined);assert.equal(provider.enable,undefined);});
 await check('PROVIDER_HTTP_DOES_NOT_EXPOSE_DATA',async()=>{
  let status,body,cache;provider.router({session:{auth:{user:{id:randomUUID()}}}},{status(v){status=v;return this;},set(k,v){cache=v;return this;},json(v){body=v;}});
  assert.equal(status,503);assert.equal(cache,'private, no-store');assert.deepEqual(body,{error:{code:'CATALOG_UNAVAILABLE'}});
 });
 await check('RESTART_PRESERVES_DURABLE_OFF',async()=>{await provider.close();await assert.rejects(()=>provider.ready(),/CLOSED/);provider=factory();assert.equal(await provider.ready(),true);assert.equal((await pool.query('SELECT policy FROM gcni_catalog_control_rehearsal.state')).rows[0].policy.mode,'OFF');});
 const denied=async(kind,sql)=>{const c=new Pool({...settings,database:config.database,user:PROFILE[kind].login,password:credentials[kind],max:1});try{await assert.rejects(()=>c.query(sql),e=>e.code==='42501');}finally{await c.end();}};
 await check('CATALOG_CANNOT_READ_PRIVATE_SESSIONS',()=>denied('catalog','SELECT * FROM public.application_session'));
 await check('AUTHORITY_CANNOT_READ_CATALOG',()=>denied('authority','SELECT * FROM catalog_read.generation'));
 await check('POLICY_CANNOT_ACTIVATE_OR_WRITE',()=>denied('policy',"SET ROLE gcni_control_reader; SELECT gcni_catalog_control_rehearsal.transition(0,'{}'::jsonb)"));
 const drift=async(change,restore)=>{await pool.query(change);try{await assert.rejects(()=>provider.ready(),/NOT_READY/);}finally{await pool.query(restore);}assert.equal(await provider.ready(),true);};
 await check('REVOKED_READER_MEMBERSHIP_REFUSED',()=>drift('REVOKE c4g_catalog_projection_reader FROM gcni_catalog_reader','GRANT c4g_catalog_projection_reader TO gcni_catalog_reader WITH ADMIN FALSE, INHERIT FALSE, SET TRUE'));
 await check('EXCESS_AUTHORITY_ROLE_REFUSED',()=>drift('GRANT gcni_control_reader TO gcni_catalog_authority','REVOKE gcni_control_reader FROM gcni_catalog_authority'));
 await check('SUPERUSER_READER_REFUSED',()=>drift('ALTER ROLE gcni_catalog_reader SUPERUSER','ALTER ROLE gcni_catalog_reader NOSUPERUSER'));
 await check('DIRECT_TABLE_GRANT_REFUSED',()=>drift('GRANT SELECT ON public.application_session TO gcni_catalog_authority','REVOKE SELECT ON public.application_session FROM gcni_catalog_authority'));
 await check('POLICY_STORAGE_FAILURE_REFUSED',()=>drift('REVOKE SELECT ON gcni_catalog_control_rehearsal.state FROM gcni_control_reader','GRANT SELECT ON gcni_catalog_control_rehearsal.state TO gcni_control_reader'));

 await check('MISSING_POLICY_STATE_REFUSED',()=>drift('DELETE FROM gcni_catalog_control_rehearsal.state',"INSERT INTO gcni_catalog_control_rehearsal.state SELECT true,policy FROM gcni_catalog_control_rehearsal.history WHERE revision=0"));
 await check('POLICY_WRITE_CAPABILITY_REFUSED',()=>drift('GRANT EXECUTE ON FUNCTION gcni_catalog_control_rehearsal.transition(bigint,jsonb) TO gcni_control_reader','REVOKE EXECUTE ON FUNCTION gcni_catalog_control_rehearsal.transition(bigint,jsonb) FROM gcni_control_reader'));
 await check('EXPIRED_CREDENTIAL_REFUSED',()=>drift("ALTER ROLE gcni_catalog_authority VALID UNTIL '2000-01-01'","ALTER ROLE gcni_catalog_authority VALID UNTIL 'infinity'"));
 await check('INCOMPLETE_CREDENTIAL_PAIR_REFUSED',()=>mutate('ALTER ROLE gcni_catalog_authority RENAME TO gcni_missing_authority'));
 await check('NORMAL_ADMISSION_RECHECKS_CREDENTIAL_PRIVILEGES',()=>mutate('ALTER ROLE gcni_catalog_reader SUPERUSER'));
 await check('NORMAL_ADMISSION_REFUSES_EXTRA_MEMBERSHIP',()=>mutate('GRANT gcni_control_operator TO gcni_catalog_authority'));
 await check('FINAL_OFF_AND_SOURCES_QUIESCED',async()=>{assert.equal(await provider.ready(),true);assert.equal((await pool.query('SELECT policy FROM gcni_catalog_control_rehearsal.state')).rows[0].policy.mode,'OFF');assert.deepEqual((await pool.query('SELECT DISTINCT state FROM opportunity_catalog.eu_source_control_v2')).rows,[{state:'QUIESCED'}]);});
 await check('PROVIDER_CLOSE_IDEMPOTENT',async()=>{await provider.close();await provider.close();await assert.rejects(()=>provider.ready(),/CLOSED/);});
 report.credentials='three distinct ephemeral SCRAM secrets, not persisted';report.activation='disabled';report.policy='OFF';
 report.status='PASS';

 }catch(error){report.status='FAIL';report.phase=phase;report.error={code:error.code||'GATE_FAILED',message:String(error.message).slice(0,1200),measured:error.measured};}

 finally{if(provider)await provider.close().catch(()=>{});await Promise.allSettled([pool,admin].filter(Boolean).map(p=>p.end()));}

 console.log(JSON.stringify(report));if(report.status!=='PASS')process.exitCode=1;

}

main().catch(e=>{console.log(JSON.stringify({status:'FAIL',phase,error:{code:e.code||'START_FAILED',message:String(e.message).slice(0,1000)}}));process.exitCode=1;});

