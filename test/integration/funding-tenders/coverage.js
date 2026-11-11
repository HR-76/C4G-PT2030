'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const migrations=require('../../../backend/src/security/centralMigrationManifest');
const schema=require('../../../backend/src/security/centralSchemaManifest');
const authority=require('../../../backend/src/security/authoritySecurityManifest');
const {createFundingRepository}=require('../../../backend/src/fundingTenders/repository');
const {createSource}=require('./v1FixtureFunder');
async function main(){
 const target=new URL(process.env.FUNDING_TEST_DATABASE_URL);
 assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'5559');assert.equal(target.pathname,'/funding_coverage');
 const pool=new Pool({connectionString:target.toString(),max:4});let worker;
 try{
  for(const role of ['c4g_central_owner','c4g_central_runtime'])await pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
  await require('../../../backend/scripts/runCentralMigrations').applyCentralMigrationsWithManifest(pool,migrations.manifest.filter(m=>m.version<'033'),migrations.migrationSql);
  const up=fs.readFileSync(path.join(__dirname,'../../../backend/database/central/migrations/033_funding_coverage.up.sql'),'utf8');
  async function capture(client){const security=require('../../../backend/src/security/catalogSecurityManifest');fs.writeFileSync('fingerprints.json',JSON.stringify({upChecksum:createHash('sha256').update(up).digest('hex'),schemaFingerprint:schema.schemaFingerprint(await schema.centralSchemaSnapshot(client)),authoritySecurityFingerprint:authority.digest(await authority.authoritySecuritySnapshot(client)),catalogSecurityFingerprint:security.digest(await security.catalogSecuritySnapshot(client))},null,2));}
  if(migrations.manifest.some(m=>m.version==='033_funding_coverage')){
   await require('../../../backend/scripts/runCentralMigrations').applyCentralMigrationsWithManifest(pool,migrations.manifest.filter(m=>m.version<='033_funding_coverage'),migrations.migrationSql,{afterSql:async({client,entry})=>{if(entry.version==='033_funding_coverage')await capture(client);}});
  }else await pool.query(up);
  const security=require('../../../backend/src/security/catalogSecurityManifest');
  const fingerprints={upChecksum:createHash('sha256').update(up).digest('hex'),schemaFingerprint:schema.schemaFingerprint(await schema.centralSchemaSnapshot(pool)),authoritySecurityFingerprint:authority.digest(await authority.authoritySecuritySnapshot(pool)),catalogSecurityFingerprint:security.digest(await security.catalogSecuritySnapshot(pool))};
  fs.writeFileSync('fingerprints.json',JSON.stringify(fingerprints,null,2));
  assert.equal((await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(pool)).currentVersion,'033_funding_coverage');
  await require('../../../backend/src/opportunities/preflight').opportunityPreflight(pool,'central');
  fs.writeFileSync('progress.json',JSON.stringify({stage:'schema'}));
  const protectedNames=(await security.catalogSecuritySnapshot(pool)).relations.map(r=>r.relname);
  assert.ok((await security.catalogSecuritySnapshot(pool)).relations.every(r=>r.owner==='c4g_opportunity_central_owner'));
  for(const name of ['funding_cycle','funding_batch','funding_cycle_seen'])assert.ok(protectedNames.includes(name));
  await pool.query('GRANT SELECT ON opportunity_catalog.funding_cycle TO PUBLIC');
  await assert.rejects(security.assertCatalogSecurity(pool,fingerprints.catalogSecurityFingerprint),/CATALOG_SECURITY_DRIFT/);
  await pool.query('REVOKE SELECT ON opportunity_catalog.funding_cycle FROM PUBLIC');
  await security.assertCatalogSecurity(pool,fingerprints.catalogSecurityFingerprint);
  const reader=await pool.connect();try{await reader.query('BEGIN');await reader.query('SET LOCAL ROLE c4g_catalog_reader');await assert.rejects(reader.query('SELECT * FROM opportunity_catalog.funding_cycle'),{code:'42501'});}finally{await reader.query('ROLLBACK');reader.release();}
  const admin=randomUUID();await pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Coverage fixture','coverage@example.invalid','ACTIVE')",[admin]);
  await pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),admin]);
  const repo=createFundingRepository({pool,coverageEnabled:true});
  let total=1200,mode='normal',retried=false;const pages=[];
  const source=createSource({fetchImpl:async url=>{
   const page=Number(new URL(url).searchParams.get('pageNumber'));pages.push(page);
   if(mode==='retry'&&page===2&&!retried){retried=true;return new Response('',{status:429,headers:{'retry-after':'0'}});}
   const results=Array.from({length:Math.min(25,Math.max(0,total-(page-1)*25))},(_,i)=>({content:`Call ${(page-1)*25+i}`,metadata:{identifier:[`FIX-${(page-1)*25+i}`],frameworkProgramme:['43108390'],deadlineDate:['2099-12-31']}}));
   if(mode==='mixed'&&page===2){results[0]= {content:'Call 0',metadata:{identifier:['FIX-0'],deadlineDate:['2099-12-31']}};results[1].metadata.deadlineDate=['2020-01-01'];results[2]={};}
   if(mode==='duplicate'&&page===2)results[0]={content:'Call 0',metadata:{identifier:['FIX-0'],deadlineDate:['2099-12-31']}};
   return new Response(JSON.stringify({totalResults:mode==='drift'&&page===1?total+1:total,results}));
  }});
  const request=randomUUID(),initial=await repo.enqueue(admin,request);
  // Simulate process loss after stage, before applying its records.
  let run=await repo.claim(initial.runId),batch=await source.collect({pageBudget:1});await repo.stage(run,batch);await repo.stage(run,batch);
  assert.equal((await repo.status(admin)).lastRun.received,25);
  await pool.query("UPDATE opportunity_catalog.funding_run SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1",[run.run_id]);
  run=await repo.claim(run.run_id);assert.equal(run.collected,true);
  await assert.rejects(repo.stage({...run,fence:Number(run.fence)-1},batch),{code:'FUNDING_FENCE_STALE'});
  for(const item of await repo.pending(run))await repo.apply(run,item);
  // Force the outbox INSERT to fail: finish and successor must roll back together.
  await pool.query("CREATE FUNCTION public.reject_coverage_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_DISPATCH_FAILURE'; END $$; CREATE TRIGGER reject_coverage_outbox BEFORE INSERT ON async_exec.outbox FOR EACH ROW EXECUTE FUNCTION public.reject_coverage_outbox()");
  await assert.rejects(repo.finish(run),/SYNTHETIC_DISPATCH_FAILURE/);
  assert.equal((await pool.query('SELECT count(*)::int n FROM opportunity_catalog.funding_batch')).rows[0].n,1);
  await pool.query('DROP TRIGGER reject_coverage_outbox ON async_exec.outbox; DROP FUNCTION public.reject_coverage_outbox()');
  await repo.finish(run);await assert.rejects(repo.finish(run),{code:'FUNDING_FENCE_STALE'});
  assert.equal((await repo.enqueue(admin,request)).status,'RUNNING');
  // Actual queue/worker consumes the remaining durable chain; the initial
  // completed envelope is harmless when delivered after the simulated restart.
  const {PgBoss}=await import('../../../backend/node_modules/pg-boss/dist/index.js');
  const boss=new PgBoss({connectionString:target.toString(),supervise:false,schedule:false});await boss.start();await boss.createQueue('funding-tenders-refresh',{retryLimit:0});await boss.stop();
  const queue=await require('../../../backend/src/async/adapters/pgBossQueueAdapter').createPgBossQueueAdapter({connectionString:target.toString(),queueMap:{'funding_tenders.refresh':'funding-tenders-refresh'},inspectSchema:async()=>({schema:'pgboss',schemaVersion:Number((await pool.query('SELECT version FROM pgboss.version')).rows[0].version)})});
  worker=require('../../../backend/src/fundingTenders/worker').createFundingWorker({pool,queue,source,repository:repo});
  async function drain(){for(let i=0;i<80;i++){await worker.runOnce();const status=(await repo.status(admin)).lastRun;if(status.status!=='RUNNING')return status;}throw Error('CYCLE_DID_NOT_FINISH');}
  let done=await drain();assert.equal(done.status,'SUCCESS');assert.equal(done.received,1200);assert.equal(done.created,1200);assert.equal(done.coverage.pages,48);assert.equal(done.coverage.unique,1200);assert.deepEqual(pages,Array.from({length:48},(_,i)=>i+1));
  fs.writeFileSync('progress.json',JSON.stringify({stage:'first-cycle',done}));
  const revisions=Number((await pool.query('SELECT count(*) n FROM opportunity_catalog.revision')).rows[0].n);
  assert.equal((await repo.status(admin)).runs.length,1);assert.equal((await repo.status(admin)).lastCompleteRuns[0].received,1200);
  await repo.enqueue(admin,randomUUID());done=await drain();assert.equal(done.unchanged,1200);assert.equal(done.created,0);assert.equal(Number((await pool.query('SELECT count(*) n FROM opportunity_catalog.revision')).rows[0].n),revisions);
  fs.writeFileSync('progress.json',JSON.stringify({stage:'repeat',done}));
  total=50;mode='mixed';await repo.enqueue(admin,randomUUID());done=await drain();assert.equal(done.status,'ERROR');assert.equal(done.received,50);assert.equal(done.coverage.unique,47);assert.equal(done.coverage.duplicates,1);assert.equal(done.coverage.excluded,1);assert.equal(done.coverage.invalid,1);
  fs.writeFileSync('progress.json',JSON.stringify({stage:'mixed',done}));
  assert.equal((await repo.status(admin)).lastCompleteRuns[0].received,1200);
  mode='duplicate';await repo.enqueue(admin,randomUUID());done=await drain();fs.writeFileSync('progress.json',JSON.stringify({stage:'duplicate',done}));assert.equal(done.status,'PARTIAL');assert.equal(done.coverage.duplicates,1);assert.equal(done.coverage.unique,49);
  mode='drift';await repo.enqueue(admin,randomUUID());done=await drain();fs.writeFileSync('progress.json',JSON.stringify({stage:'drift',done}));assert.equal(done.status,'PARTIAL');assert.equal(done.coverage.totalChanged,true);
  mode='retry';await repo.enqueue(admin,randomUUID());done=await drain();fs.writeFileSync('progress.json',JSON.stringify({stage:'retry',done}));assert.equal(done.status,'SUCCESS');assert.equal(done.coverage.pages,2);assert.equal(retried,true);
  // Expiration after a partially applied staged page preserves accurate counts.
  mode='normal';const expired=await repo.enqueue(admin,randomUUID());run=await repo.claim(expired.runId);batch=await source.collect({pageBudget:1});await repo.stage(run,batch);
  for(const item of (await repo.pending(run)).slice(0,10))await repo.apply(run,item);
  await pool.query("UPDATE opportunity_catalog.funding_run SET created_at=clock_timestamp()-interval '6 minutes',lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1",[run.run_id]);await worker.runOnce();
  const expiredResult=(await repo.status(admin)).runs.find(r=>r.runId===expired.runId);
  fs.writeFileSync('progress.json',JSON.stringify({stage:'expired',done:expiredResult}));
  assert.equal(expiredResult.status,'ERROR');assert.equal(expiredResult.unchanged,10);
  mode='normal';const revoked=await repo.enqueue(admin,randomUUID());await pool.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE global_user_id=$1",[admin]);
  await assert.rejects(repo.claim(revoked.runId),{code:'FUNDING_FORBIDDEN'});await assert.rejects(repo.status(admin),{code:'FUNDING_FORBIDDEN'});
  await pool.query("UPDATE opportunity_catalog.funding_run SET created_at=clock_timestamp()-interval '6 minutes' WHERE run_id=$1",[revoked.runId]);await worker.runOnce();
  assert.equal((await pool.query('SELECT status FROM opportunity_catalog.funding_cycle WHERE cycle_id=$1',[revoked.runId])).rows[0].status,'ERROR');
  fs.writeFileSync('verification.json',JSON.stringify({status:'PASS',identities:1200,pages:48,repeatedUnchanged:1200,checkpointRecovery:true,atomicSuccessorRollback:true,idempotency:true,revocation:true,expiration:true,accounting:true,partialOnDuplicates:true,partialOnTotalDrift:true,retry429:true,catalogGrantsProtected:true,tenantReaderDenied:true},null,2));
  console.log('FUNDING_COVERAGE_GATE_PASS');
 }finally{if(worker)await worker.shutdown();await pool.end()}
}
main().catch(error=>{fs.writeFileSync('failure.json',JSON.stringify({code:error.code||'COVERAGE_GATE_FAILED',reason:/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:null,frames:error.stack?.split('\n').filter(line=>/^\s+at /.test(line)).slice(0,3),...(error.code==='ERR_ASSERTION'?{message:error.message}:{})},null,2));console.log('FUNDING_COVERAGE_GATE_FAILED');process.exitCode=1});
