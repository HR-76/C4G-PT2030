'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const migrations=require('../../../backend/src/security/centralMigrationManifest');
const {createFundingRepository}=require('../../../backend/src/fundingTenders/repository');
const {createSource}=require('./v1FixtureFunder');
async function main(){
 const target=new URL(process.env.FUNDING_TEST_DATABASE_URL);
 assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'5562');assert.equal(target.pathname,'funding_temporal'.replace(/^/,'/'));
 const pool=new Pool({connectionString:target.toString(),max:4});let worker;
 try{
  let connected=false;
  for(let attempt=0;attempt<30;attempt++){try{await pool.query('SELECT 1');connected=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,300));}}
  if(!connected)throw Error('TEMPORAL_POSTGRES_NOT_REACHABLE');
  for(const role of ['c4g_central_owner','c4g_central_runtime'])await pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
  const runner=require('../../../backend/scripts/runCentralMigrations');
  await runner.applyCentralMigrationsWithManifest(pool,migrations.manifest.filter(m=>m.version<'034'),migrations.migrationSql);
  const sql=fs.readFileSync(path.join(__dirname,'../../../backend/database/central/migrations/034_funding_temporal_refresh.up.sql'),'utf8');
  const schema=require('../../../backend/src/security/centralSchemaManifest'),authority=require('../../../backend/src/security/authoritySecurityManifest'),security=require('../../../backend/src/security/catalogSecurityManifest');
  async function capture(client){fs.writeFileSync('fingerprints.json',JSON.stringify({upChecksum:createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex'),schemaFingerprint:schema.schemaFingerprint(await schema.centralSchemaSnapshot(client)),authoritySecurityFingerprint:authority.digest(await authority.authoritySecuritySnapshot(client)),catalogSecurityFingerprint:security.digest(await security.catalogSecuritySnapshot(client))},null,2));}
  const pinned=migrations.manifest.some(m=>m.version==='034_funding_temporal_refresh');
  if(pinned)await runner.applyCentralMigrationsWithManifest(pool,migrations.manifest,migrations.migrationSql,{afterSql:async({client,entry})=>{if(entry.version==='034_funding_temporal_refresh')await capture(client);}});
  else await pool.query(sql);
  await capture(pool);
  const securityBefore=security.digest(await security.catalogSecuritySnapshot(pool));
  assert.ok((await security.catalogSecuritySnapshot(pool)).relations.some(row=>row.relname==='funding_refresh_target'));
  await pool.query('GRANT SELECT ON opportunity_catalog.funding_refresh_target TO PUBLIC');
  await assert.rejects(security.assertCatalogSecurity(pool,securityBefore),/CATALOG_SECURITY_DRIFT/);
  await pool.query('REVOKE SELECT ON opportunity_catalog.funding_refresh_target FROM PUBLIC');
  if(pinned){await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(pool);await require('../../../backend/src/opportunities/preflight').opportunityPreflight(pool,'central');await require('../../../backend/src/security/catalogReaderSchema').assertCatalogReaderSchema(pool);}
  const admin=randomUUID();await pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Temporal fixture','temporal@example.invalid','ACTIVE')",[admin]);
  await pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),admin]);
  const repo=createFundingRepository({pool,coverageEnabled:true,refreshEnabled:true});
  const ids=['A-EXTEND','B-CLOSED','C-SAME','D-CONFLICT','E-ABSENT','F-ERROR'];let discovery=true;
  const item=(id,status='31094502',deadline='2099-01-01')=>({content:id,metadata:{type:['1'],identifier:[id],status:[status],frameworkProgramme:['43108390'],startDate:['2020-01-01'],deadlineDate:[deadline]}});
  const source=createSource({fetchImpl:async(url,options)=>{
   const query=JSON.parse(await options.body.get('query').text()),id=query.bool.must.find(x=>x.term?.identifier)?.term.identifier;
   const results=id? id==='A-EXTEND'?[item(id,'31094502','2100-01-01')]:id==='B-CLOSED'?[item(id,'31094503','2020-02-01')]:id==='C-SAME'?[item(id)]:id==='D-CONFLICT'?[item(id),item(id,'31094503','2020-02-01')]:id==='E-ABSENT'?[]:[{}]:discovery?ids.map(id=>item(id)):[];
   return new Response(JSON.stringify({results,totalResults:results.length}));
  }});
  const {PgBoss}=await import('../../../backend/node_modules/pg-boss/dist/index.js');
  const boss=new PgBoss({connectionString:target.toString(),supervise:false,schedule:false});await boss.start();await boss.createQueue('funding-tenders-refresh',{retryLimit:0});await boss.stop();
  const queue=await require('../../../backend/src/async/adapters/pgBossQueueAdapter').createPgBossQueueAdapter({connectionString:target.toString(),queueMap:{'funding_tenders.refresh':'funding-tenders-refresh'},inspectSchema:async()=>({schema:'pgboss',schemaVersion:Number((await pool.query('SELECT version FROM pgboss.version')).rows[0].version)})});
  worker=require('../../../backend/src/fundingTenders/worker').createFundingWorker({pool,queue,source,repository:repo});
  async function drain(){for(let i=0;i<30;i++){await worker.runOnce();const result=(await repo.status(admin)).lastRun;if(!['RUNNING','QUEUED'].includes(result.status))return result;}throw Error('TEMPORAL_DRAIN_EXHAUSTED');}
  await repo.enqueue(admin,randomUUID());assert.equal((await drain()).created,6);
  const before=(await pool.query('SELECT revision_id,snapshot FROM opportunity_catalog.revision ORDER BY revision_id')).rows;
  const original=(await pool.query('SELECT external_identifier,opportunity_id FROM opportunity_catalog.funding_identity ORDER BY external_identifier')).rows;
  discovery=false;const request=await repo.enqueue(admin,randomUUID());
  let run=await repo.claim(request.runId);await repo.stage(run,await source.collect({pageBudget:1}));await repo.finish(run);
  const pending=(await pool.query("SELECT run_id FROM opportunity_catalog.funding_run WHERE status='QUEUED' ORDER BY created_at LIMIT 1")).rows[0];
  run=await repo.claim(pending.run_id);const batch=await source.lookup({externalIdentifier:run.checkpoint.input_cursor.externalIdentifier});await repo.stage(run,batch);await repo.stage(run,batch);
  await pool.query("UPDATE opportunity_catalog.funding_run SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1",[run.run_id]);
  const done=await drain();assert.equal(done.status,'PARTIAL');assert.equal(done.received,0);assert.deepEqual(done.knownRefresh,{UPDATED:2,UNCHANGED:1,CONFLICT:1,ABSENT:1,ERROR:1,DISCOVERY_DEFERRED:0});
  assert.deepEqual((await pool.query('SELECT external_identifier,opportunity_id FROM opportunity_catalog.funding_identity ORDER BY external_identifier')).rows,original);
  for(const row of before)assert.deepEqual((await pool.query('SELECT snapshot FROM opportunity_catalog.revision WHERE revision_id=$1',[row.revision_id])).rows[0].snapshot,row.snapshot);
  const closed=await repo.get(original.find(r=>r.external_identifier==='B-CLOSED').opportunity_id);assert.equal(closed.temporal.state,'CLOSED');
  const conflict=await repo.get(original.find(r=>r.external_identifier==='D-CONFLICT').opportunity_id);assert.equal(conflict.sourceReview,'CONFLICT');assert.equal(conflict.snapshot.closingDate,'2099-01-01');
  const summary=await repo.dashboardSummary('2026-10-28');assert.equal(summary.total,6);assert.equal(summary.closed,1);
  assert.equal(summary.open,2);assert.equal(summary.unknown,3);
  assert.equal((await repo.list({temporalState:'CLOSED'})).items.length,1);
  assert.equal((await repo.list({temporalState:'UNKNOWN'})).items.length,3);
  const revisionCount=(await pool.query('SELECT count(*)::int n FROM opportunity_catalog.revision')).rows[0].n;
  discovery=true;await repo.enqueue(admin,randomUUID());const repeat=await drain();
  assert.equal(repeat.knownRefresh.DISCOVERY_DEFERRED,6);assert.equal(repeat.knownRefresh.UPDATED||0,0);assert.equal(repeat.coverage.pending,0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM opportunity_catalog.revision')).rows[0].n,revisionCount);
  assert.equal((await repo.get(closed.opportunityId)).snapshot.closingDate,'2020-02-01');
  const {temporalState}=require('../../../backend/src/opportunities/temporal'),{temporalSql}=require('../../../backend/src/opportunities/temporalSql');
  for(const fields of [{openingDate:'2027-01-01',closingDate:'2028-01-01'},{closingDate:'2026-10-28'},{},{closingDate:'2026-09-01',sourceTemporal:{status:'OPEN',deadlines:['2026-09-01','2027-01-01'],openings:[]}},{closingDate:'2026-10-28',sourceTemporal:{status:'OPEN',deadlines:['2026-10-28T13:00:00+01:00'],openings:[]}},{closingDate:'2028-01-01',sourceTemporal:{status:'CANCELLED',deadlines:[],openings:[]}}]){
   const result=await pool.query(`WITH o AS (SELECT $1::date AS opening_date,$2::date AS closing_date),r AS (SELECT $3::jsonb AS snapshot) SELECT temporal.temporal_state FROM o CROSS JOIN r ${temporalSql({today:"'2026-10-28'::date",now:"'2026-10-28T12:00:00Z'::timestamptz"})}`,[fields.openingDate||null,fields.closingDate||null,fields]);
   assert.equal(result.rows[0].temporal_state,temporalState(fields,'2026-10-28T12:00:00Z').state);
  }
  const reader=await pool.connect();try{await reader.query('BEGIN');await reader.query('SET LOCAL ROLE c4g_catalog_reader');await assert.rejects(reader.query('SELECT * FROM opportunity_catalog.funding_refresh_target'),{code:'42501'});}finally{await reader.query('ROLLBACK');reader.release();}
  const readerRepo=createFundingRepository({pool,readRole:true});assert.equal((await readerRepo.get(original[0].opportunity_id)).opportunityId,original[0].opportunity_id);
  const expires=await repo.enqueue(admin,randomUUID());run=await repo.claim(expires.runId);await repo.stage(run,await source.collect({pageBudget:1}));await repo.finish(run);
  const expiring=(await pool.query("SELECT run_id FROM opportunity_catalog.funding_run WHERE status='QUEUED' ORDER BY created_at LIMIT 1")).rows[0];
  run=await repo.claim(expiring.run_id);await repo.stage(run,await source.lookup({externalIdentifier:run.checkpoint.input_cursor.externalIdentifier}));
  await pool.query("UPDATE opportunity_catalog.funding_run SET created_at=clock_timestamp()-interval '6 minutes',lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1",[run.run_id]);await worker.runOnce();
  const expired=(await repo.status(admin)).runs.find(row=>row.runId===expires.runId);assert.equal(expired.status,'ERROR');assert.equal(expired.knownRefresh.ERROR,1);assert.equal(expired.updated,0);
  const revoked=await repo.enqueue(admin,randomUUID());run=await repo.claim(revoked.runId);await repo.stage(run,await source.collect({pageBudget:1}));await repo.finish(run);
  const lastQueued=(await pool.query("SELECT run_id FROM opportunity_catalog.funding_run WHERE status='QUEUED' ORDER BY created_at LIMIT 1")).rows[0];
  run=await repo.claim(lastQueued.run_id);await repo.stage(run,await source.lookup({externalIdentifier:run.checkpoint.input_cursor.externalIdentifier}));
  const identitiesBefore=(await pool.query('SELECT * FROM opportunity_catalog.funding_identity ORDER BY external_identifier')).rows;
  await pool.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE global_user_id=$1",[admin]);
  await assert.rejects(repo.pending(run),{code:'FUNDING_FORBIDDEN'});await repo.finish(run,'FUNDING_FORBIDDEN');
  assert.deepEqual((await pool.query('SELECT * FROM opportunity_catalog.funding_identity ORDER BY external_identifier')).rows,identitiesBefore);
  await assert.rejects(repo.enqueue(admin,randomUUID()),{code:'FUNDING_FORBIDDEN'});
  fs.writeFileSync('verification.json',JSON.stringify({status:'PASS',manifestPinned:pinned,done,summary,checks:['durable lookup','stage replay','restart after staging','source conflict preservation','source absence preservation','historical revisions immutable','stable identities','reader boundary','revoked authority']},null,2));
 }finally{if(worker)await worker.shutdown();await pool.end();}
}
main().catch(error=>{fs.writeFileSync('error.json',JSON.stringify({code:error.code||null,name:error.name,message:/^[A-Z_]+$/.test(error.message)?error.message:'TEMPORAL_GATE_ASSERTION_OR_DATABASE_FAILURE',stack:error.stack?.split('\n').filter(line=>line.trim().startsWith('at '))},null,2));process.exitCode=1;});
