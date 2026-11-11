'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),out=path.join(root,'output/interreg-poctep');
const {Pool}=require('../../../backend/node_modules/pg');
const {manifest,migrationSql}=require('../../../backend/src/security/centralMigrationManifest');
const runner=require('../../../backend/scripts/runCentralMigrations');
const {centralSchemaSnapshot,schemaFingerprint}=require('../../../backend/src/security/centralSchemaManifest');
const {authoritySecuritySnapshot,digest}=require('../../../backend/src/security/authoritySecurityManifest');
const {createFundingRepository}=require('../../../backend/src/fundingTenders/repository');
const {createOfficialSource,SOURCES}=require('../../../backend/src/fundingTenders/officialSources');
const {createFundingWorker}=require('../../../backend/src/fundingTenders/worker');
const {createPgBossQueueAdapter}=require('../../../backend/src/async/adapters/pgBossQueueAdapter');
const version='018_official_programme_sources';
async function main(){
 const target=new URL(process.env.FUNDING_TEST_DATABASE_URL);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'5558');assert.equal(target.pathname,'/funding_fixture');
 const pool=new Pool({connectionString:target.toString()});let worker;
 try{
  for(const role of ['c4g_central_owner','c4g_central_runtime'])await pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
  await runner.applyCentralMigrationsWithManifest(pool,manifest.filter(x=>x.version<version),migrationSql);
  const before=schemaFingerprint(await centralSchemaSnapshot(pool));
  const up=fs.readFileSync(path.join(root,`backend/database/central/migrations/${version}.up.sql`),'utf8'),down=fs.readFileSync(path.join(root,`backend/database/central/migrations/${version}.down.sql`),'utf8');
  await pool.query(up);
  const fingerprints={schemaFingerprint:schemaFingerprint(await centralSchemaSnapshot(pool)),authoritySecurityFingerprint:digest(await authoritySecuritySnapshot(pool)),upChecksum:createHash('sha256').update(up).digest('hex'),downChecksum:createHash('sha256').update(down).digest('hex')};
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'migration-fingerprints.json'),JSON.stringify(fingerprints,null,2));
  await pool.query(down);assert.equal(schemaFingerprint(await centralSchemaSnapshot(pool)),before);
  if(!manifest.some(x=>x.version===version)){console.log('OFFICIAL_FINGERPRINT_PASS');return;}
  const admin=randomUUID(),member=randomUUID();
  for(const id of [admin,member])await pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Fixture',$2,'ACTIVE')",[id,id+'@example.invalid']);
  await pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),admin]);
  const repo=createFundingRepository({pool});
  // A genuine pre-migration EU record and historical receipt must survive byte-for-byte.
  const eu=await repo.enqueue(admin,randomUUID()),euRun=await repo.claim(eu.runId);
  const batch={observedAt:new Date().toISOString(),received:1,failed:0,limited:false,records:[{externalIdentifier:'EU-BEFORE-018',fields:{title:'Existing EU record',funderName:'European Commission',closingDate:'2099-12-31'}}]};
  await repo.stage(euRun,batch);await repo.apply(euRun,(await repo.pending(euRun))[0]);await repo.finish(euRun);
  const oldTables=['opportunity','revision','provenance','funding_run','funding_run_item','funding_identity','funding_observation','idempotency_record'];
  const snapshot=async()=>Object.fromEntries(await Promise.all(oldTables.map(async t=>[t,(await pool.query(`SELECT to_jsonb(t) row FROM opportunity_catalog.${t} t ORDER BY to_jsonb(t)::text`)).rows])));
  const original=await snapshot();
  await runner.applyCentralMigrationsWithManifest(pool,manifest,migrationSql);
  // Later migrations add nullable columns to these tables. Rows are preserved when every
  // original value is unchanged and every column added afterwards is null.
  const upgraded=await snapshot(),withoutAddedNulls=Object.fromEntries(oldTables.map((t,ti)=>[t,upgraded[t].map(({row})=>{const keys=new Set(original[t].flatMap(o=>Object.keys(o.row)));for(const [k,v] of Object.entries(row))if(!keys.has(k))assert.equal(v,null,`Added column ${t}.${k} must be null on preserved rows`);return {row:Object.fromEntries(Object.entries(row).filter(([k])=>keys.has(k)))};}).sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:1)]));
  assert.deepEqual(withoutAddedNulls,Object.fromEntries(oldTables.map(t=>[t,[...original[t]].sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:1)])));
  assert.equal((await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(pool)).currentVersion,manifest.at(-1).version);
  await require('../../../backend/src/opportunities/preflight').opportunityPreflight(pool,'central');
  await assert.rejects(repo.enqueue(member,randomUUID(),'POCTEP'),{code:'FUNDING_FORBIDDEN'});
  const {PgBoss}=await import('../../../backend/node_modules/pg-boss/dist/index.js');const boss=new PgBoss({connectionString:target.toString(),supervise:false,schedule:false});await boss.start();await boss.createQueue('funding-tenders-refresh',{retryLimit:0});await boss.stop();
  const queue=await createPgBossQueueAdapter({connectionString:target.toString(),queueMap:{'funding_tenders.refresh':'funding-tenders-refresh'},inspectSchema:async()=>({schema:'pgboss',schemaVersion:Number((await pool.query('SELECT version FROM pgboss.version')).rows[0].version)})});
  const fixture=path.join(root,'backend/test/fixtures/official-programmes');let changed=false,broken=false,now='2026-10-18';
  const source=createOfficialSource({clock:()=>Date.parse(now+'T12:00:00Z'),fetchImpl:async url=>{
    if(url.endsWith('.xlsx'))return new Response(fs.readFileSync(path.join(fixture,'interreg.xlsx')),{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
    let data=fs.readFileSync(path.join(fixture,url===SOURCES.POCTEP.url?'calendar.json':'open.json'),'utf8');
    if(changed)data=data.replaceAll('17/11/2026','18/11/2026');if(broken)data='{}';return new Response(data,{headers:{'content-type':'application/json'}});
  }});
  worker=createFundingWorker({pool,queue,source});
  async function collect(code){const request=randomUUID(),run=await repo.enqueue(admin,request,code);let status;for(let i=0;i<6;i++){await worker.runOnce();status=(await repo.status(admin)).lastRun;if(['SUCCESS','ERROR'].includes(status.status))break;}assert.equal(status.runId,run.runId);return {request,...status};}
  const empty=await collect('INTERREG_EUROPE');assert.equal(empty.status,'SUCCESS');assert.equal(empty.created,0);assert.equal(empty.received,3);
  const first=await collect('POCTEP');assert.equal(first.status,'SUCCESS');assert.equal(first.created,2);assert.equal(first.received,10);
  assert.equal((await repo.enqueue(admin,first.request,'POCTEP')).runId,first.runId);await assert.rejects(repo.enqueue(admin,first.request,'INTERREG_EUROPE'),{code:'IDEMPOTENCY_CONFLICT'});
  const identity=(await pool.query("SELECT * FROM opportunity_catalog.funding_identity WHERE external_identifier='POCTEP:2021-2027:CALL:10'")).rows[0];
  const existing=await repo.get(identity.opportunity_id);assert.equal(existing.source,'POCTEP');assert.equal(existing.snapshot.closingDate,'2026-11-17');
  const provenance=(await pool.query('SELECT source_type,source_namespace FROM opportunity_catalog.provenance WHERE opportunity_id=$1',[identity.opportunity_id])).rows;assert.deepEqual(provenance,[{source_type:'OFFICIAL_PROGRAMME',source_namespace:'POCTEP'}]);
  // Pool has several connections; use a public fixture table for the FK assertion.
  await pool.query('CREATE TABLE public.official_fixture_relation(opportunity_id uuid REFERENCES opportunity_catalog.opportunity(opportunity_id))');await pool.query('INSERT INTO public.official_fixture_relation VALUES($1)',[identity.opportunity_id]);
  const repeat=await collect('POCTEP');assert.equal(repeat.created,0);assert.equal(repeat.unchanged,2);assert.equal((await repo.get(identity.opportunity_id)).revisionId,existing.revisionId);
  const catalog=new(require('../../../backend/src/opportunities/centralRepository').CentralOpportunityRepository)({pool,identityFactory:require('../../../backend/src/opportunities/identity').createIdentityFactory()});
  await catalog.update({schemaVersion:1,requestId:randomUUID(),opportunityId:identity.opportunity_id,expectedRowVersion:Number(existing.rowVersion),snapshot:{...existing.snapshot,title:'Manual title retained',provenanceId:randomUUID()},provenance:{schemaVersion:1,sourceType:'C4G_MANUAL',sourceNamespace:'C4G',observedAt:new Date().toISOString()}},{actor:{type:'SERVICE',reference:'SYNTHETIC_FIXTURE'}});
  const previousRevisions=(await pool.query('SELECT to_jsonb(r) row FROM opportunity_catalog.revision r ORDER BY revision_id')).rows;
  changed=true;const update=await collect('POCTEP');assert.equal(update.created,0);assert.equal(update.updated,1);
  // The read model stamps each read with clock-derived fields (asOf, ageSeconds).
  const withoutAsOf=value=>JSON.parse(JSON.stringify(value,(key,child)=>key==='asOf'||key==='ageSeconds'?undefined:child));
  const after=await repo.get(identity.opportunity_id);assert.equal(after.snapshot.title,'Manual title retained');assert.equal(after.snapshot.closingDate,'2026-11-18');assert.deepEqual(after.conflicts,['title']);
  assert.equal((await pool.query('SELECT opportunity_id FROM public.official_fixture_relation')).rows[0].opportunity_id,identity.opportunity_id);
  for(const row of previousRevisions)assert.deepEqual((await pool.query('SELECT to_jsonb(r) row FROM opportunity_catalog.revision r WHERE revision_id=$1',[row.row.revision_id])).rows[0],row);
  broken=true;const failure=await collect('POCTEP');assert.equal(failure.status,'ERROR');assert.equal(failure.errorCode,'SOURCE_RESPONSE_INVALID');assert.deepEqual(withoutAsOf(await repo.get(identity.opportunity_id)),withoutAsOf(after));broken=false;
  now='2030-01-01';const expired=await collect('POCTEP');assert.equal(expired.status,'SUCCESS');assert.equal(expired.created,0);assert.deepEqual(withoutAsOf(await repo.get(identity.opportunity_id)),withoutAsOf(after));
  assert.equal((await pool.query('SELECT count(*)::int n FROM opportunity_catalog.funding_identity')).rows[0].n,3);
  await assert.rejects(pool.query(down),/OFFICIAL_SOURCE_HISTORY_REQUIRES_018/);
  const spoof=await repo.enqueue(admin,randomUUID(),'POCTEP'),spoofRun=await repo.claim(spoof.runId);await assert.rejects(repo.stage(spoofRun,batch),{code:'SOURCE_RECORD_INVALID'});await repo.finish(spoofRun,'SOURCE_RESPONSE_INVALID');
  const revoked=await repo.enqueue(admin,randomUUID(),'POCTEP');await pool.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE global_user_id=$1",[admin]);await assert.rejects(repo.claim(revoked.runId),{code:'FUNDING_FORBIDDEN'});await assert.rejects(repo.status(admin),{code:'FUNDING_FORBIDDEN'});
  for(const t of ['revision','provenance','funding_observation','idempotency_record']){const current=await snapshot();for(const item of original[t])assert(current[t].some(row=>JSON.stringify(row)===JSON.stringify(item)));}
  const proof={status:'PASS',migrationRoundTrip:true,preexistingRowsUnchanged:true,identities:3,poctepCreated:2,interregCurrent:0,repeatUnchanged:2,manualCorrectionPreserved:true,foreignKeyPreserved:true,oldRevisionsPreserved:true,expiredRecordsPreserved:true,malformedSourceDoesNotWrite:true,namespaceIsolation:true,adminRevocation:true,ordinaryMemberDenied:true,rollbackProtectsHistory:true};
  fs.writeFileSync(path.join(out,'disposable-verification.json'),JSON.stringify(proof,null,2));console.log('OFFICIAL_PROGRAMME_GATE_PASS');
 }finally{if(worker)await worker.shutdown();await pool.end();}
}
main().catch(e=>{console.error(e.code||e.name,e.stack);process.exitCode=1});
