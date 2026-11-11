'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {createHash}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const root=path.resolve(__dirname,'../../..');
const security=path.join(root,'backend/src/security');
const review=path.join(root,'context/reviews/authority-metadata-dedup');
const schema=require(path.join(security,'centralSchemaManifest'));
const authority=require(path.join(security,'authoritySecurityManifest'));
const catalog=require(path.join(security,'catalogSecurityManifest'));
const {manifest,migrationSql}=require(path.join(security,'centralMigrationManifest'));
const migrations=require('../../../backend/scripts/runCentralMigrations');
const {createAuthorityCoordinator}=require(path.join(security,'authorityCoordinator'));
const reportName=process.env.AUTHORITY_METADATA_REPORT||'authority-metadata-dedup';
if(!/^[a-z0-9-]+$/.test(reportName))throw Error('PROOF_REPORT_INVALID');
const out=path.join(root,'context/reviews',reportName,'postgres-proof.json');
const report={startedAt:new Date().toISOString(),status:'RUNNING',checks:[],versions:[],drifts:[],postLock:[],cleanupErrors:[],
 limits:['Exclusive disposable PostgreSQL 17; synthetic schema only.','No HTTP/OIDC claim: the existing HTTP revocation gate is executed separately.','Mutations and grants below apply only to the owned disposable fixture.']};
let stage='target';
const checkpoint=()=>{fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');};
const check=name=>{report.checks.push(name);console.log('PASS '+name);checkpoint();};
const code=error=>error?.code||error?.name||'UNKNOWN';
const digest=text=>createHash('sha256').update(text).digest('hex');

// Compile the archived sources with their original relative dependencies. These
// private Module instances never replace application modules in require.cache.
function baselineModules(){
 const originals=new Map(['centralSchemaManifest','authoritySecurityManifest'].map(name=>{
  const file=path.join(review,name+'.before.txt'),text=fs.readFileSync(file,'utf8');
  return [name,{text,hash:digest(text)}];
 }));
 const cache=new Map();
 function load(name){
  if(cache.has(name))return cache.get(name).exports;
  const filename=path.join(security,name+'.js'),m=new Module(filename,module),local=Module.createRequire(filename);
  m.filename=filename;m.paths=Module._nodeModulePaths(security);cache.set(name,m);
  m.require=specifier=>{
   const resolved=local.resolve(specifier),base=path.basename(resolved,'.js');
   if(path.dirname(resolved)===security&&(originals.has(base)||base==='centralMigrationPreflight'))return load(base);
   return local(specifier);
  };
  m._compile(originals.get(name)?.text||fs.readFileSync(filename,'utf8'),filename);
  return m.exports;
 }
 return {schema:load('centralSchemaManifest'),authority:load('authoritySecurityManifest'),
  hashes:Object.fromEntries([...originals].map(([name,value])=>[name,value.hash]))};
}

function countSecurityQueries(client){
 let calls=0;
 return {client:{query(...args){if(args[0]===authority.SQL)calls++;return client.query(...args);}},count:()=>calls};
}

async function assertEquivalent(client,entry,old){
 const before=await old.schema.centralSchemaSnapshot(client),after=await schema.centralSchemaSnapshot(client);
 assert.deepEqual(after,before);assert.equal(JSON.stringify(after),JSON.stringify(before));
 assert.equal(schema.schemaFingerprint(after),entry.schemaFingerprint);
 assert.equal(old.schema.schemaFingerprint(before),entry.schemaFingerprint);
 const oldSecurity=await old.authority.authoritySecuritySnapshot(client),newSecurity=await authority.authoritySecuritySnapshot(client);
 assert.deepEqual(newSecurity,oldSecurity);assert.equal(authority.digest(newSecurity),entry.authoritySecurityFingerprint);
 assert.equal(await old.schema.assertCentralSchema(client,entry.version),entry.schemaFingerprint);
 assert.equal(await schema.assertCentralSchema(client,entry.version),entry.schemaFingerprint);
 assert.deepEqual(await schema.assertCentralSchemaForVersions(client,[entry.version]),{version:entry.version,fingerprint:entry.schemaFingerprint});
 await assert.rejects(()=>schema.assertCentralSchemaForVersions(client,[manifest.find(x=>x.version!==entry.version).version]),error=>error.code==='CENTRAL_SCHEMA_VERSION_NOT_ADMITTED');
 const catalogSnapshot=await catalog.assertCatalogSecurity(client,entry.catalogSecurityFingerprint);
 report.versions.push({version:entry.version,schemaFingerprint:entry.schemaFingerprint,authoritySecurityFingerprint:entry.authoritySecurityFingerprint,
  catalogSecurityFingerprint:catalog.digest(catalogSnapshot),exactJsonEqual:true});
 check('exact baseline/new schema, authority and catalog fingerprints: '+entry.version);
}

async function admissionCounts(pool,entry,old){
 const client=await pool.connect();
 try{
  const previous=countSecurityQueries(client),current=countSecurityQueries(client);
  assert.equal((await old.authority.assertAuthorityAdmission(previous.client)).currentVersion,entry.version);
  assert.equal((await authority.assertAuthorityAdmission(current.client)).currentVersion,entry.version);
  assert.equal(previous.count(),3);assert.equal(current.count(),1);
  const again=countSecurityQueries(client);
  await authority.assertAuthorityAdmission(again.client);await authority.assertAuthorityAdmission(again.client);
  assert.equal(again.count(),2);
  report.versions.find(x=>x.version===entry.version).admissionSecurityCollections={before:previous.count(),after:current.count(),twoRepeatedAdmissions:again.count()};
  check('admission deduplicates one checkpoint and recollects on repeated calls: '+entry.version);
 }finally{client.release();}
}

async function driftCases(pool,entry,old){
 const cases=[
  {name:'role attribute',sql:'ALTER ROLE c4g_authority_runtime INHERIT',authority:true},
  {name:'role membership',sql:'GRANT c4g_central_runtime TO c4g_authority_runtime WITH INHERIT FALSE, SET TRUE',authority:true},
  {name:'table ACL',sql:'GRANT SELECT ON public.global_user TO PUBLIC',authority:true},
  {name:'column ACL',sql:'GRANT SELECT(id) ON public.global_user TO PUBLIC',authority:true},
  {name:'schema ACL',sql:'GRANT CREATE ON SCHEMA public TO PUBLIC',authority:true},
  {name:'function security',sql:'ALTER FUNCTION authority_api.execute(text,text[],text) SECURITY INVOKER',authority:true},
  {name:'table structure',sql:'ALTER TABLE public.global_user ADD COLUMN metadata_proof_drift integer'},
  {name:'separate catalog ACL',sql:'GRANT SELECT ON opportunity_catalog.funding_run TO PUBLIC',catalogOnly:true}
 ];
 for(const item of cases){
  stage='drift '+item.name;const client=await pool.connect();
  try{
   await client.query('BEGIN');
   assert.equal(await schema.assertCentralSchema(client,entry.version),entry.schemaFingerprint);
   await authority.assertAuthoritySecurity(client,entry.version);
   await client.query(item.sql);
   const oldSnapshot=await old.schema.centralSchemaSnapshot(client),newSnapshot=await schema.centralSchemaSnapshot(client);
   assert.deepEqual(newSnapshot,oldSnapshot);
   if(item.catalogOnly){
    assert.equal(schema.schemaFingerprint(newSnapshot),entry.schemaFingerprint,'Catalog drift must exercise the separate validator.');
    await assert.rejects(()=>schema.assertCentralSchema(client,entry.version),/CATALOG_SECURITY_DRIFT/);
    await assert.rejects(()=>schema.assertCentralSchemaForVersions(client,[entry.version]),/CATALOG_SECURITY_DRIFT/);
   }else{
    assert.notEqual(schema.schemaFingerprint(newSnapshot),entry.schemaFingerprint);
    await assert.rejects(()=>schema.assertCentralSchema(client,entry.version),/Central schema drift/);
    await assert.rejects(()=>schema.assertCentralSchemaForVersions(client,[entry.version]),error=>error.code==='CENTRAL_SCHEMA_VERSION_NOT_ADMITTED');
   }
   await assert.rejects(()=>old.schema.assertCentralSchema(client,entry.version));
   if(item.authority)await assert.rejects(()=>authority.assertAuthoritySecurity(client,entry.version),error=>error.code==='AUTHORITY_SECURITY_DRIFT');
   await client.query('ROLLBACK');
   assert.equal(await schema.assertCentralSchema(client,entry.version),entry.schemaFingerprint);
   await authority.assertAuthoritySecurity(client,entry.version);
   report.drifts.push({case:item.name,rejected:true,baselineAndNewSnapshotsEqual:true,restored:true});
   check('fresh same-connection drift rejection and rollback restoration: '+item.name);
  }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
 }
}

async function postLockProof(fixture,item){
 stage='post-lock '+item.name;
 const blocker=await fixture.pool.connect();let reachedResolve,arrived=false,ran=false,pending,mutated=false;
 const reached=new Promise(resolve=>{reachedResolve=resolve;});
 const observed={query:(...args)=>fixture.authorityPool.query(...args),async connect(){
  const client=await fixture.authorityPool.connect();
  return {on:(...args)=>client.on(...args),removeListener:(...args)=>client.removeListener(...args),release:error=>client.release(error),
   query(...args){if(args[0]==='SELECT pg_advisory_xact_lock(43001306,1)'){arrived=true;reachedResolve();}return client.query(...args);}};
 }};
 const coordinator=createAuthorityCoordinator({pool:observed,permitSecret:fixture.permitSecret});
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(43001306,1)');
  pending=coordinator.withAuthority(async()=>{ran=true;return 'UNSAFE_CALLBACK_EXECUTED';});pending.catch(()=>{});
  let timer;try{await Promise.race([reached,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('POST_LOCK_CHECKPOINT_NOT_REACHED')),7000);})]);}finally{clearTimeout(timer);}
  assert(arrived);assert.equal(ran,false);
  let blocked;const observeUntil=Date.now()+2000;
  do{
   blocked=await fixture.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename='c4g_authority_runtime' AND wait_event_type='Lock' AND wait_event='advisory' AND cardinality(pg_blocking_pids(pid))>0");
   if(blocked.rows[0].n===1)break;
   await new Promise(resolve=>setTimeout(resolve,10));
  }while(Date.now()<observeUntil);
  assert.equal(blocked.rows[0].n,1,'The real authority transaction must wait on the external PostgreSQL lock.');
  await fixture.pool.query(item.up);mutated=true;
  await blocker.query('COMMIT');
  await assert.rejects(()=>pending,error=>error.code==='AUTHORITY_SECURITY_DRIFT');
  assert.equal(ran,false);
  report.postLock.push({case:item.name,realBlockedAuthorityTransactions:blocked.rows[0].n,mutationAfterPreflight:true,functionalCallbackExecuted:ran,rejected:'AUTHORITY_SECURITY_DRIFT'});
  check('fresh post-lock authority observation rejects committed '+item.name+' drift');
 }finally{
  await blocker.query('ROLLBACK').catch(()=>{});blocker.release();
  if(pending)await pending.catch(()=>{});
  if(mutated)await fixture.pool.query(item.down);
 }
}

async function installPrefix(pool,adminPool,entries){
 await adminPool.query('ALTER ROLE c4g_f12_admin SUPERUSER');
 const installer=await pool.connect();
 try{
  await installer.query('SET SESSION AUTHORIZATION c4g_f12_admin');
  if(!(await installer.query("SELECT to_regclass('public.c4g_database_identity') IS NOT NULL AS present")).rows[0].present)
   await installer.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
  const wrapper={connect:async()=>({query:(...args)=>installer.query(...args),release(){}})};
  await migrations.applyCentralMigrationsWithManifest(wrapper,entries,migrationSql);
 }finally{await installer.query('RESET SESSION AUTHORIZATION').catch(()=>{});installer.release();await adminPool.query('ALTER ROLE c4g_f12_admin NOSUPERUSER NOCREATEROLE NOCREATEDB NOLOGIN');}
}

async function run(){
 const target=new URL(process.env.AUTHORITY_METADATA_ADMIN_URL||'');
 if(target.hostname!=='127.0.0.1'||target.pathname!=='/postgres'||target.username!=='proof_admin'
  ||!/^\d+$/.test(target.port)||! /^[a-f0-9]{32}$/.test(process.env.AUTHORITY_METADATA_RUN||''))throw Error('OWNED_DISPOSABLE_TARGET_REQUIRED');
 const old=baselineModules();report.baselineSourceHashes=old.hashes;assert.equal(authority.SQL,old.authority.SQL);
 let fixture,history,historyAuthority,admin;
 try{
  stage='current fixture';
  fixture=await require('../f13/central-authority-fixture').centralAuthorityFixture(target.toString(),{validateHistoricalRoundTrip:false});
  report.postgres=(await fixture.pool.query('SHOW server_version')).rows[0].server_version;
  const current=manifest.at(-1);
  await assertEquivalent(fixture.pool,current,old);await admissionCounts(fixture.authorityPool,current,old);
  await driftCases(fixture.pool,current,old);
  await postLockProof(fixture,{name:'table ACL',up:'GRANT SELECT ON public.global_user TO PUBLIC',down:'REVOKE SELECT ON public.global_user FROM PUBLIC'});
  await postLockProof(fixture,{name:'role attribute',up:'ALTER ROLE c4g_authority_runtime INHERIT',down:'ALTER ROLE c4g_authority_runtime NOINHERIT'});
  assert.equal(await schema.assertCentralSchema(fixture.pool,current.version),current.schemaFingerprint);
  stage='historical schema fixture';
  admin=new Pool({connectionString:target.toString(),max:2});
  await admin.query("CREATE DATABASE c4g_authority_metadata_history ENCODING 'UTF8' TEMPLATE template0");
  const historyUrl=new URL(target);historyUrl.pathname='/c4g_authority_metadata_history';history=new Pool({connectionString:historyUrl.toString(),max:2});
  const limitedUrl=new URL(fixture.authorityConnectionString);limitedUrl.pathname=historyUrl.pathname;
  historyAuthority=new Pool({connectionString:limitedUrl.toString(),max:2});
  for(const prefix of ['029_','030_','031_']){
   const index=manifest.findIndex(entry=>entry.version.startsWith(prefix));assert(index>=0);
   const entries=Object.freeze(manifest.slice(0,index+1)),entry=entries.at(-1);
   stage='historical '+entry.version;await installPrefix(history,admin,entries);
   await assertEquivalent(history,entry,old);await admissionCounts(historyAuthority,entry,old);
  }
  assert.equal(await schema.assertCentralSchema(fixture.pool,current.version),current.schemaFingerprint);
  check('current schema remains exact after historical fixtures');
  report.status='PASS';
 }finally{
  for(const [name,close] of [['historical authority',()=>historyAuthority?.end()],['historical owner',()=>history?.end()],['central fixture',()=>fixture?.close({retain:true})],['admin',()=>admin?.end()]]){
   try{await close();}catch(error){report.cleanupErrors.push({name,code:code(error)});report.status='FAIL';}
  }
 }
}
run().catch(error=>{report.status='FAIL';report.failure={stage,code:code(error)};process.exitCode=1;}).finally(()=>{
 report.finishedAt=new Date().toISOString();checkpoint();console.log('AUTHORITY_METADATA_PROOF '+report.status+' checks='+report.checks.length);
 if(report.status!=='PASS')process.exitCode=1;
});
