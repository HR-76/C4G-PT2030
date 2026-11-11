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

 const admin=new Pool({...settings,max:1});let pool;

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
 report.status='PASS';

 }catch(error){report.status='FAIL';report.phase=phase;report.error={code:error.code||'GATE_FAILED',message:String(error.message).slice(0,1200),measured:error.measured};}

 finally{await Promise.allSettled([pool,admin].filter(Boolean).map(p=>p.end()));}

 console.log(JSON.stringify(report));if(report.status!=='PASS')process.exitCode=1;

}

main().catch(e=>{console.log(JSON.stringify({status:'FAIL',phase,error:{code:e.code||'START_FAILED',message:String(e.message).slice(0,1000)}}));process.exitCode=1;});

