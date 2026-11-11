'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {randomUUID,createHash} = require('node:crypto');
const {Pool} = require('../../../backend/node_modules/pg');
const {manifest,migrationSql} = require('../../../backend/src/security/centralMigrationManifest');
const runner = require('../../../backend/scripts/runCentralMigrations');
const {centralSchemaSnapshot,schemaFingerprint} = require('../../../backend/src/security/centralSchemaManifest');
const {authoritySecuritySnapshot,digest} = require('../../../backend/src/security/authoritySecurityManifest');
const {createFundingRepository} = require('../../../backend/src/fundingTenders/repository');
const {createSource} = require('./v1FixtureFunder');
const {createFundingWorker} = require('../../../backend/src/fundingTenders/worker');
const {createPgBossQueueAdapter} = require('../../../backend/src/async/adapters/pgBossQueueAdapter');
async function main(){
 const target=new URL(process.env.FUNDING_TEST_DATABASE_URL);
 assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'5558');assert.equal(target.pathname,'/funding_fixture');
 const pool=new Pool({connectionString:target.toString()});let worker;
 try {
  for(const role of ['c4g_central_owner','c4g_central_runtime'])await pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
  await runner.applyCentralMigrationsWithManifest(pool,manifest.filter(x=>x.version<'017'),migrationSql);
  const before=schemaFingerprint(await centralSchemaSnapshot(pool));
  const up=fs.readFileSync(path.resolve(__dirname,'../../../backend/database/central/migrations/017_funding_programmes.up.sql'),'utf8');
  const down=fs.readFileSync(path.resolve(__dirname,'../../../backend/database/central/migrations/017_funding_programmes.down.sql'),'utf8');
  await pool.query(up);
  const fingerprints={schemaFingerprint:schemaFingerprint(await centralSchemaSnapshot(pool)),authoritySecurityFingerprint:digest(await authoritySecuritySnapshot(pool)),upChecksum:createHash('sha256').update(up).digest('hex'),downChecksum:createHash('sha256').update(down).digest('hex')};
  fs.mkdirSync('output/funding-programmes',{recursive:true});fs.writeFileSync('output/funding-programmes/migration-fingerprints.json',JSON.stringify(fingerprints,null,2));
  await pool.query(down);assert.equal(schemaFingerprint(await centralSchemaSnapshot(pool)),before);
  if(!manifest.some(x=>x.version==='017_funding_programmes')){console.log('FUNDING_PROGRAMMES_FINGERPRINT_PASS');return}
  await runner.applyCentralMigrationsWithManifest(pool,manifest.filter(x=>x.version<'018'),migrationSql);
  assert.equal((await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(pool)).currentVersion,'017_funding_programmes');
  await require('../../../backend/src/opportunities/preflight').opportunityPreflight(pool,'central');
  const admin=randomUUID(),member=randomUUID();
  for(const id of [admin,member])await pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Fixture',$2,'ACTIVE')",[id,id+'@example.invalid']);
  await pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),admin]);
  const repo=createFundingRepository({pool});
  const offlineRepo=createFundingRepository({pool,workerHealth:async()=>({ready:false})});
  await assert.rejects(offlineRepo.enqueue(admin,randomUUID()),{code:'FUNDING_WORKER_UNAVAILABLE'});
  await assert.rejects(repo.enqueue(member,randomUUID(),'CORDIS'),{code:'FUNDING_FORBIDDEN'});
  const {PgBoss}=await import('../../../backend/node_modules/pg-boss/dist/index.js');const boss=new PgBoss({connectionString:target.toString(),supervise:false,schedule:false});await boss.start();await boss.createQueue('funding-tenders-refresh',{retryLimit:0});await boss.stop();
  const queue=await createPgBossQueueAdapter({connectionString:target.toString(),queueMap:{'funding_tenders.refresh':'funding-tenders-refresh'},inspectSchema:async()=>({schema:'pgboss',schemaVersion:Number((await pool.query('SELECT version FROM pgboss.version')).rows[0].version)})});
  const pages=[];let changed=false,mixedErasmus=false;
  const source=createSource({fetchImpl:async(url,options)=>{
   const page=Number(new URL(url).searchParams.get('pageNumber'));const query=JSON.parse(await options.body.get('query').text());const codes=query.bool.must.find(x=>x.terms?.frameworkProgramme)?.terms.frameworkProgramme;
   const selection=codes?.includes('HORIZON')?'CORDIS':codes?'ERASMUS':'EU';pages.push({selection,page});
   if(selection==='ERASMUS'){assert.ok(codes.includes('43353764'));assert.ok(!codes.includes('43253967'))}
   // RENEWFM appears in the general response and as an invalid extra in Erasmus.
   const ids=selection==='EU'?Array.from({length:25},(_,i)=>(page-1)*25+i):selection==='CORDIS'?[0,100]:mixedErasmus?[1,101,98]:[1,101];
   return new Response(JSON.stringify({totalResults:selection==='EU'?101:ids.length,results:ids.map(i=>({content:changed?'Changed '+i:'Call '+i,metadata:{identifier:['FIXTURE-'+i],frameworkProgramme:[i===98?'43253967':i%2?'43353764':'43108390'],deadlineDate:['2099-12-31']}}))}));
  }});
  worker=createFundingWorker({pool,queue,source});
  const id=randomUUID();await repo.enqueue(admin,id);await assert.rejects(repo.enqueue(admin,id,'CORDIS'),{code:'IDEMPOTENCY_CONFLICT'});await assert.rejects(repo.enqueue(admin,randomUUID(),'ERASMUS'),{code:'FUNDING_BUSY'});
  await assert.rejects(repo.enqueue(admin,randomUUID()),{code:'FUNDING_BUSY'});
  assert.equal((await repo.enqueue(admin,id)).status,'QUEUED');
  assert.equal((await offlineRepo.enqueue(admin,id)).status,'QUEUED');
  await worker.runOnce();assert.equal((await repo.status(admin)).lastRun.created,100);assert.equal((await repo.status(admin)).lastRun.limited,true);assert.deepEqual(pages.map(x=>x.page),[1,2,3,4]);
  assert.ok(worker.health().lastPollAt>0);assert.equal(worker.health().consecutiveFailures,0);
  assert.equal((await repo.status(admin)).lastCompleteRuns.length,0);
  const renewableId=(await pool.query("SELECT opportunity_id FROM opportunity_catalog.funding_identity WHERE external_identifier='FIXTURE-98'")).rows[0].opportunity_id;
  // The read model stamps each read with clock-derived fields (asOf, ageSeconds).
  const withoutAsOf=value=>JSON.parse(JSON.stringify(value,(key,child)=>key==='asOf'||key==='ageSeconds'?undefined:child));
  const renewableBefore=await repo.get(renewableId);assert.equal(renewableBefore.snapshot.programmeName,'RENEWFM');
  const identity=(await pool.query("SELECT opportunity_id FROM opportunity_catalog.funding_identity WHERE external_identifier='FIXTURE-0'")).rows[0].opportunity_id;
  const first=await repo.get(identity);const {CentralOpportunityRepository}=require('../../../backend/src/opportunities/centralRepository');
  const catalog=new CentralOpportunityRepository({pool,identityFactory:require('../../../backend/src/opportunities/identity').createIdentityFactory()});
  await catalog.update({schemaVersion:1,requestId:randomUUID(),opportunityId:identity,expectedRowVersion:Number(first.rowVersion),snapshot:{...first.snapshot,title:'Manual title',provenanceId:randomUUID()},provenance:{schemaVersion:1,sourceType:'C4G_MANUAL',sourceNamespace:'C4G',observedAt:new Date().toISOString()}},{actor:{type:'SERVICE',reference:'SYNTHETIC_FIXTURE'}});
  changed=true;
  for(const code of ['CORDIS','ERASMUS']){const request=randomUUID();const run=await repo.enqueue(admin,request,code);await worker.runOnce();const status=(await repo.status(admin)).lastRun;assert.equal(status.status,'SUCCESS');assert.equal(status.source,code);assert.equal(status.created,1);assert.equal(status.updated,1);assert.equal((await repo.enqueue(admin,request,code)).runId,run.runId)}
  assert.equal((await repo.get(identity)).snapshot.title,'Manual title');assert.deepEqual((await repo.get(identity)).conflicts,['title']);
  mixedErasmus=true;await repo.enqueue(admin,randomUUID(),'ERASMUS');await worker.runOnce();
  const rejected=(await repo.status(admin)).lastRun;
  assert.equal(rejected.status,'ERROR');assert.equal(rejected.errorCode,'SOURCE_RECORDS_REJECTED');assert.equal(rejected.failed,1);
  assert.equal(rejected.created,0);assert.equal(rejected.updated,0);assert.equal(rejected.unchanged,2);
  assert.deepEqual(withoutAsOf(await repo.get(renewableId)),withoutAsOf(renewableBefore));
  assert.equal((await pool.query('SELECT count(*)::int n FROM opportunity_catalog.funding_identity')).rows[0].n,102);
  assert.equal((await repo.status(admin)).lastRuns.length,3);
  await assert.rejects(pool.query(down),/FUNDING_PROGRAMME_HISTORY_REQUIRES_017/);
  assert.equal(schemaFingerprint(await centralSchemaSnapshot(pool)),fingerprints.schemaFingerprint);
  const cascadeProof=await require('./cascade-reconciliation').run({pool,repo,admin,queue});
  fs.writeFileSync('output/funding-programmes/cascade-disposable-verification.json',JSON.stringify(cascadeProof,null,2));
  const revoked=await repo.enqueue(admin,randomUUID(),'CORDIS');await pool.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE global_user_id=$1",[admin]);
  await assert.rejects(repo.claim(revoked.runId),{code:'FUNDING_FORBIDDEN'});await assert.rejects(repo.status(admin),{code:'FUNDING_FORBIDDEN'});
  const result={status:'PASS',pagination:pages,identities:102,renewfmProgramme:'RENEWFM',erasmusRejectsRenewfm:true,renewfmUnchangedByErasmus:true,manualCorrectionPreserved:true,sharedIdentity:true,revocation:true,migrationRoundTrip:true,historyProtected:true};
  fs.writeFileSync('output/funding-programmes/disposable-verification.json',JSON.stringify(result,null,2));console.log('FUNDING_PROGRAMMES_GATE_PASS');
 } finally {if(worker)await worker.shutdown();await pool.end()}
}
main().catch(e=>{console.error(e.code||e.name,e.stack);process.exitCode=1});
