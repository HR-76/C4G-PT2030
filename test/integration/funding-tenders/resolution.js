'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const migrations=require('../../../backend/src/security/centralMigrationManifest');
const {createFundingRepository}=require('../../../backend/src/fundingTenders/repository');
const {createSource,normalizeRecord}=require('./v1FixtureFunder');
const VERSION='035_funding_source_resolution';
async function main(){
 const target=new URL(process.env.FUNDING_TEST_DATABASE_URL);
 assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'5563');assert.equal(target.pathname,'/funding_resolution');
 const pool=new Pool({connectionString:target.toString(),max:4});let worker;
 try{
  let connected=false;
  for(let i=0;i<30;i++){try{await pool.query('SELECT 1');connected=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,300));}}
  if(!connected)throw Error('RESOLUTION_POSTGRES_NOT_REACHABLE');
  for(const role of ['c4g_central_owner','c4g_central_runtime'])await pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
  const runner=require('../../../backend/scripts/runCentralMigrations');
  await runner.applyCentralMigrationsWithManifest(pool,migrations.manifest.filter(m=>m.version<VERSION),migrations.migrationSql);
  const sql=fs.readFileSync(path.join(__dirname,'../../../backend/database/central/migrations/'+VERSION+'.up.sql'),'utf8');
  const schema=require('../../../backend/src/security/centralSchemaManifest'),authority=require('../../../backend/src/security/authoritySecurityManifest'),security=require('../../../backend/src/security/catalogSecurityManifest');
  async function capture(client){fs.writeFileSync('fingerprints.json',JSON.stringify({upChecksum:createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex'),schemaFingerprint:schema.schemaFingerprint(await schema.centralSchemaSnapshot(client)),authoritySecurityFingerprint:authority.digest(await authority.authoritySecuritySnapshot(client)),catalogSecurityFingerprint:security.digest(await security.catalogSecuritySnapshot(client))},null,2));}
  const pinned=migrations.manifest.some(m=>m.version===VERSION);
  if(pinned)await runner.applyCentralMigrationsWithManifest(pool,migrations.manifest.filter(m=>m.version<=VERSION),migrations.migrationSql,{afterSql:async({client,entry})=>{if(entry.version===VERSION)await capture(client);}});
  else await pool.query(sql);
  await capture(pool);
  if(!pinned){fs.writeFileSync('verification.json',JSON.stringify({status:'CALIBRATED',manifestPinned:false}));return;}
  await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(pool);
  await require('../../../backend/src/opportunities/preflight').opportunityPreflight(pool,'central');
  await require('../../../backend/src/security/catalogReaderSchema').assertCatalogReaderSchema(pool);
  const originalSecurity=security.digest(await security.catalogSecuritySnapshot(pool));
  await pool.query('GRANT SELECT ON opportunity_catalog.funding_resolution TO c4g_catalog_reader');
  await assert.rejects(security.assertCatalogSecurity(pool,originalSecurity),/CATALOG_SECURITY_DRIFT/);
  await pool.query('REVOKE SELECT ON opportunity_catalog.funding_resolution FROM c4g_catalog_reader');

  const admin=randomUUID();
  await pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Resolution fixture','resolution@example.invalid','ACTIVE')",[admin]);
  await pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),admin]);
  const {decisions}=require('../../../backend/src/fundingTenders/resolutionPack');
  assert.equal(decisions.length,6);
  const legacy=createFundingRepository({pool});
  const seed=await legacy.enqueue(admin,randomUUID()),seedRun=await legacy.claim(seed.runId);
  const seedRecords=decisions.map(d=>{
   const record=normalizeRecord(d.evidence.variants[0],{known:true,asOf:'2026-10-28'});
   record.fields.closingDate=d.externalIdentifier.startsWith('CEF')?'2022-01-19':d.externalIdentifier.startsWith('ERASMUS')?'2027-01-26':'2021-09-22';
   delete record.fields.sourceTemporal;
   record.fields.summary='Preserved local summary';
   record.fields.funderName=require('./v1FixtureFunder').FIXTURE_FUNDER;
   return record;
  });
  await legacy.stage(seedRun,{records:seedRecords,observedAt:'2026-10-28T12:00:00Z',received:6,failed:0,limited:false});
  for(const item of await legacy.pending(seedRun))await legacy.apply(seedRun,item);
  await legacy.finish(seedRun);
  await pool.query("UPDATE opportunity_catalog.funding_identity SET source_review='CONFLICT'");
  const original=(await pool.query('SELECT revision_id,snapshot FROM opportunity_catalog.revision ORDER BY revision_id')).rows;
  const ids=(await pool.query('SELECT external_identifier,opportunity_id FROM opportunity_catalog.funding_identity ORDER BY external_identifier')).rows;
  const storedRevisions=()=>pool.query('SELECT revision_id,snapshot FROM opportunity_catalog.revision ORDER BY revision_id').then(r=>r.rows);
  const evidence=new Map(decisions.map(d=>[d.externalIdentifier,structuredClone(d.evidence.variants)]));
  const source=createSource({fetchImpl:async(_url,options)=>{
   const query=JSON.parse(await options.body.get('query').text());
   const id=query.bool.must.find(x=>x.term?.identifier)?.term.identifier;
   const results=id?evidence.get(id)||[]:[];
   return new Response(JSON.stringify({results,totalResults:results.length}));
  }});
  const repository=createFundingRepository({pool,coverageEnabled:true,refreshEnabled:true,resolutionEnabled:true});
  const {createResolutionService}=require('../../../backend/src/fundingTenders/resolutions');
  const service=createResolutionService({pool,repository,source,decisions});
  const prepared=await service.prepare(admin);
  const command={requestId:randomUUID(),expectedDigest:prepared.digest,expectedRevisions:prepared.items.map(x=>({externalIdentifier:x.externalIdentifier,revisionId:x.revisionId}))};
  await assert.rejects(service.apply(admin,{...command,expectedDigest:'0'.repeat(64)}));
  assert.deepEqual(await storedRevisions(),original);
  // Simulated failure after the first audited item must roll back all six decisions.
  let audits=0;
  const failing=createResolutionService({pool,repository,source,decisions,audit:async()=>{if(++audits===2)throw Error('SIMULATED_AUDIT_FAILURE');}});
  await assert.rejects(failing.apply(admin,command));
  assert.deepEqual(await storedRevisions(),original);
  assert.equal((await pool.query('SELECT count(*)::int n FROM opportunity_catalog.funding_resolution')).rows[0].n,0);
  const applied=await service.apply(admin,command);
  const after=await storedRevisions();assert.equal(after.length,12);
  await service.apply(admin,command);assert.deepEqual(await storedRevisions(),after);
  assert.equal((await pool.query('SELECT count(*)::int n FROM opportunity_catalog.funding_resolution')).rows[0].n,6);
  for(const old of original)assert.deepEqual(after.find(x=>x.revision_id===old.revision_id),old);
  assert.deepEqual((await pool.query('SELECT external_identifier,opportunity_id FROM opportunity_catalog.funding_identity ORDER BY external_identifier')).rows,ids);
  for(const d of decisions){
   const id=ids.find(x=>x.external_identifier===d.externalIdentifier).opportunity_id;
   const detail=await repository.get(id);
   assert.equal(detail.sourceReview,null);assert.equal(detail.temporal.state,'CLOSED');
   assert.equal(detail.snapshot.closingDate,d.fields.closingDate);
   assert.deepEqual(detail.snapshot.sourceTemporal.deadlines,d.fields.sourceTemporal.deadlines);
   assert.equal(detail.snapshot.summary,'Preserved local summary');
   assert.equal(detail.snapshot.sourceResolution.sourceFingerprint,d.expectedFingerprint);
   if(d.externalIdentifier.startsWith('ERASMUS'))assert.equal(detail.temporal.publishedState,'OPEN');
  }
  const reader=createFundingRepository({pool,readRole:true});
  assert.ok((await reader.get(ids[0].opportunity_id)).snapshot.sourceResolution.reason);
  const acl=await pool.connect();
  for(const [role,statement] of [['c4g_catalog_reader','SELECT * FROM opportunity_catalog.funding_resolution'],['c4g_opportunity_central_runtime','UPDATE opportunity_catalog.funding_resolution SET decision=decision'],['c4g_opportunity_central_runtime','DELETE FROM opportunity_catalog.funding_resolution']]){
   try{await acl.query('BEGIN');await acl.query('SET LOCAL ROLE '+role);await assert.rejects(acl.query(statement),{code:'42501'});}finally{await acl.query('ROLLBACK');}
  }
  acl.release();
  await assert.rejects(pool.query('UPDATE opportunity_catalog.funding_resolution SET decision=decision'),/OPPORTUNITY_HISTORY_IMMUTABLE/);
  // Include the referencing fixture table so the trigger itself, rather than
  // PostgreSQL's earlier foreign-key check, proves truncation is forbidden.
  await assert.rejects(pool.query('TRUNCATE opportunity_catalog.funding_resolution, opportunity_catalog.funding_run_item'),/OPPORTUNITY_HISTORY_IMMUTABLE/);
  const {PgBoss}=await import('../../../backend/node_modules/pg-boss/dist/index.js');
  const boss=new PgBoss({connectionString:target.toString(),supervise:false,schedule:false});await boss.start();await boss.createQueue('funding-tenders-refresh',{retryLimit:0});await boss.stop();
  const queue=await require('../../../backend/src/async/adapters/pgBossQueueAdapter').createPgBossQueueAdapter({connectionString:target.toString(),queueMap:{'funding_tenders.refresh':'funding-tenders-refresh'},inspectSchema:async()=>({schema:'pgboss',schemaVersion:Number((await pool.query('SELECT version FROM pgboss.version')).rows[0].version)})});
  worker=require('../../../backend/src/fundingTenders/worker').createFundingWorker({pool,queue,source,repository});
  async function drain(){for(let i=0;i<40;i++){await worker.runOnce();const run=(await repository.status(admin)).lastRun;if(!['RUNNING','QUEUED'].includes(run.status))return run;}throw Error('RESOLUTION_DRAIN_EXHAUSTED');}
  // Reordered representations and changed ingestion timestamps are the same evidence.
  for(const records of evidence.values()){records.reverse();for(const record of records)record.metadata.esDA_IngestDate=['2026-10-29T12:00:00.000+0000'];}
  const repeat=await repository.enqueue(admin,randomUUID());
  let run=await repository.claim(repeat.runId);await repository.stage(run,await source.collect({pageBudget:1}));await repository.finish(run);
  const pending=(await pool.query("SELECT run_id FROM opportunity_catalog.funding_run WHERE status='QUEUED' ORDER BY created_at LIMIT 1")).rows[0];
  run=await repository.claim(pending.run_id);const batch=await source.lookup({externalIdentifier:run.checkpoint.input_cursor.externalIdentifier});
  await repository.stage(run,batch);await repository.stage(run,batch);
  await pool.query("UPDATE opportunity_catalog.funding_run SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1",[run.run_id]);
  const repeated=await drain();assert.equal(repeated.status,'SUCCESS');assert.equal(repeated.knownRefresh.UNCHANGED,6);assert.deepEqual(await storedRevisions(),after);
  // A changed single representation must also reopen review rather than bypass the decision.
  const changed=decisions[0].externalIdentifier;
  const one=structuredClone(evidence.get(changed)[0]);one.metadata.deadlineDate=['2099-01-01'];
  evidence.set(changed,[one]);evidence.set(decisions[1].externalIdentifier,[]);
  await repository.enqueue(admin,randomUUID());const reopened=await drain();
  assert.equal(reopened.status,'PARTIAL');assert.equal(reopened.knownRefresh.CONFLICT,1);assert.equal(reopened.knownRefresh.ABSENT,1);
  assert.deepEqual(await storedRevisions(),after);
  assert.equal((await repository.get(ids.find(x=>x.external_identifier===changed).opportunity_id)).sourceReview,'CONFLICT');
  // A newly requested documentary review closes a reopened warning only through
  // a new audited decision. Replaying the old request cannot acknowledge it.
  await service.apply(admin,command);
  assert.equal((await repository.get(ids.find(x=>x.external_identifier===changed).opportunity_id)).sourceReview,'CONFLICT');
  for(const d of decisions)evidence.set(d.externalIdentifier,structuredClone(d.evidence.variants));
  const reviewedAgain=await service.prepare(admin);
  const secondCommand={requestId:randomUUID(),expectedDigest:reviewedAgain.digest,expectedRevisions:reviewedAgain.items.map(({externalIdentifier,revisionId})=>({externalIdentifier,revisionId}))};
  await service.apply(admin,secondCommand);
  const afterSecondReview=await storedRevisions();assert.equal(afterSecondReview.length,18);
  for(const old of after)assert.deepEqual(afterSecondReview.find(x=>x.revision_id===old.revision_id),old);
  for(const id of ids)assert.equal((await repository.get(id.opportunity_id)).sourceReview,null);
  assert.equal((await pool.query('SELECT count(*)::int n FROM opportunity_catalog.funding_resolution')).rows[0].n,12);
  await service.apply(admin,secondCommand);assert.deepEqual(await storedRevisions(),afterSecondReview);
  await pool.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE global_user_id=$1",[admin]);
  await assert.rejects(service.apply(admin,command),{code:'FUNDING_FORBIDDEN'});
  assert.deepEqual(await storedRevisions(),afterSecondReview);
  fs.writeFileSync('verification.json',JSON.stringify({status:'PASS',manifestPinned:true,resolutions:6,revisionsPreserved:6,applied,repeated,reopened,checks:['atomic rollback','stale digest','replay','six documented deadlines','published versus temporal state','reader ACL','immutable evidence','worker restart and stage replay','semantic evidence stability','changed singleton','absence','explicit review after reopening','original decision history','revoked actor']},null,2));
 }finally{if(worker)await worker.shutdown();await pool.end();}
}
main().catch(error=>{fs.writeFileSync('error.json',JSON.stringify({code:error.code||null,name:error.name,message:/^[A-Z_]+$/.test(error.message)?error.message:'RESOLUTION_GATE_ASSERTION_OR_DATABASE_FAILURE',stack:error.stack?.split('\n').filter(line=>line.trim().startsWith('at '))},null,2));process.exitCode=1;});
