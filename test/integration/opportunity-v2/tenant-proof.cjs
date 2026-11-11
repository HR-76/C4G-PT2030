'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {createFundingRepository}=require('../../../backend/src/fundingTenders/repository');
const {validateSnapshotV2}=require('../../../backend/src/opportunities/v2');
const {createApplicationRepository}=require('../../../backend/src/applications/repository');
const {createOpportunityInterestRepository}=require('../../../backend/src/opportunityInterests/repository');
const {command}=require('../../../backend/src/applications/contracts');
const previous=require('../opportunity-interests/proof');
const {createAppendService}=require('../../../backend/src/audit/appendService');
const {PostgresAppendRepository}=require('../../../backend/src/audit/postgresAppendRepository');
const root=path.resolve(__dirname,'../../..'),asOf='2026-10-31T00:00:00.000Z';
async function tenantProof({pool,tenantPool,check,report,persisted,outputDirectory}){
 const central=createFundingRepository({pool,readRole:true,clock:()=>new Date(asOf)}),f=previous.fixture();
 const transaction=async(org,work)=>{const client=await tenantPool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');await client.query("SELECT set_config('app.organization_id',$1,true),set_config('app.membership_id',$2,true)",[org,f.actor.membershipId]);const result=await work(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}};
 const append=createAppendService({appendPort:new PostgresAppendRepository()});
 const repoFor=(org=f.orgA)=>{const base={organizationId:org,actor:f.actor,protect:async()=>{},authorize:async()=>true,cursor:{},audit:(client,event)=>append.append(previous.auditCandidate(f,org,event),client),centralOrigin:(id,rev)=>central.revision(id,rev),centralCurrent:id=>central.get(id)};return {applications:createApplicationRepository({...base,verifyResponsible:async id=>id===f.actor.membershipId}),interests:createOpportunityInterestRepository(base)};};
 let before,oldInterest,largeSource,largeRecord,application,interest;
 const repositories=repoFor();
 await check('S6_TENANT_BASELINE_FREEZES_REAL_LEGACY_REVISION',async()=>{
  f.origin={opportunityId:persisted.legacy.opportunityId,centralRevisionId:persisted.legacy.revisionId};
  f.sources.set(f.origin.opportunityId,{opportunityId:f.origin.opportunityId,revisionId:f.origin.centralRevisionId,snapshot:persisted.historySnapshot});
  f.revisions.set(f.origin.centralRevisionId,{opportunityId:f.origin.opportunityId,snapshot:persisted.historySnapshot});
  await previous.seedBaseline((s,p)=>tenantPool.query(s,p),transaction,f);
  oldInterest=await transaction(f.orgA,c=>previous.repositories(f).interests.register(c,{...f.origin,unitIds:[f.units.a],idempotencyKey:randomUUID()}));
  before=await previous.preserved((s,p)=>tenantPool.query(s,p));
  before.interest=(await tenantPool.query('SELECT to_jsonb(i) AS row FROM opportunity_catalog.opportunity_interest i WHERE interest_id=$1',[oldInterest.interestId])).rows[0].row;
 });
 await check('S6_LARGE_V2_ACCEPTED_CENTRALLY_BUT_OLD_TENANT_CAPACITY_REFUSED',async()=>{
  largeSource=structuredClone(require('../../../context/references/opportunity-v2/examples/eu-11145.json'));
  largeSource.sourceRecords.filter(s=>s.role!=='PROGRAMME_METADATA').forEach(s=>s.externalId='CASCADE:99999001');
  largeSource.identity.references.value.find(r=>r.kind==='SOURCE_CALL_ID').value='99999001';
  largeSource.sourceRecords[0].url=largeSource.sourceRecords[0].url.replace('/11145','/99999001');
  largeSource.links.official.value=largeSource.sourceRecords[0].url;
  largeSource.description.title.value='Synthetic S6 large snapshot';
  for(let i=0;i<20;i++)largeSource.provenance.evidence.push({...largeSource.provenance.evidence[0],id:'s6-large-'+i,excerpt:'x'.repeat(2000)});
  validateSnapshotV2(largeSource);
  const value={requestId:randomUUID(),candidateId:randomUUID(),snapshot:largeSource,mappingDigest:createHash('sha256').update('S6 large fixture').digest('hex'),expected:null};
  const preview=await persisted.repo.preview(value,{actor:persisted.actor});persisted.approvals.add(preview.previewDigest);
  largeRecord=await persisted.repo.accept({...value,approvalDigest:preview.previewDigest},{actor:persisted.actor});
  const input=command('create',{origin:'CENTRAL',opportunityId:largeRecord.opportunityId,centralRevisionId:largeRecord.revisionId,evaluationId:null,title:'Large v2 application',responsibleMembershipId:f.actor.membershipId,deadline:'2028-09-02',idempotencyKey:randomUUID()});
  await assert.rejects(transaction(f.orgA,c=>repositories.applications.create(c,input)),{code:'SCHEMA_UPGRADE_REQUIRED'});
  assert.deepEqual(await previous.preserved((s,p)=>tenantPool.query(s,p)),{digest:before.digest,values:before.values});
 });
 await check('S6_TENANT_CANDIDATE_PRESERVES_HISTORY_AND_SUPPORTS_LARGE_V2',async()=>{
  const client=await tenantPool.connect();try{await client.query('BEGIN');await client.query(fs.readFileSync(path.join(root,'backend/database/tenant/candidates/application_snapshot_v2.up.sql'),'utf8'));await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  assert.deepEqual(await previous.preserved((s,p)=>tenantPool.query(s,p)),{digest:before.digest,values:before.values});
  assert.deepEqual((await tenantPool.query('SELECT to_jsonb(i) AS row FROM opportunity_catalog.opportunity_interest i WHERE interest_id=$1',[oldInterest.interestId])).rows[0].row,before.interest);
  const input=command('create',{origin:'CENTRAL',opportunityId:largeRecord.opportunityId,centralRevisionId:largeRecord.revisionId,evaluationId:null,title:'Large v2 application',responsibleMembershipId:f.actor.membershipId,deadline:'2028-09-02',idempotencyKey:randomUUID()});
  application=await transaction(f.orgA,c=>repositories.applications.create(c,input));
  assert.deepEqual(await transaction(f.orgA,c=>repositories.applications.create(c,input)),application);
  const stored=(await tenantPool.query('SELECT central_snapshot,central_revision_id,octet_length(central_snapshot::text) AS bytes FROM opportunity_catalog.application WHERE application_id=$1',[application.applicationId])).rows[0];
  assert.deepEqual(stored.central_snapshot,largeSource);assert.equal(stored.central_revision_id,largeRecord.revisionId);assert(stored.bytes>32768&&stored.bytes<=262144);
  interest=await transaction(f.orgA,c=>repositories.interests.register(c,{opportunityId:largeRecord.opportunityId,centralRevisionId:largeRecord.revisionId,unitIds:[f.units.a],idempotencyKey:randomUUID()}));
  assert.deepEqual(interest.snapshot,largeSource);assert.equal(interest.readModel.projection.financing.allocations.value[0].money.amount,'120000');
  report.tenant={largeSnapshotBytes:stored.bytes,legacySnapshotsPreserved:true,snapshotReferencesPreserved:true,capacity:'v1 32768; v2 262144 JSONB bytes'};
 });
 await check('S6_TENANT_REAL_RLS_AND_CONDITIONAL_V1_LIMIT',async()=>{
  for(const table of ['application','opportunity_interest'])assert.equal((await transaction(f.orgB,c=>c.query(`SELECT * FROM opportunity_catalog.${table} WHERE organization_id=$1`,[f.orgA]))).rows.length,0);
  await assert.rejects(transaction(f.orgB,c=>repoFor(f.orgB).applications.get(c,application.applicationId)),{code:'RESOURCE_NOT_AVAILABLE'});
  await assert.rejects(transaction(f.orgB,c=>repoFor(f.orgB).interests.get(c,{},interest.interestId)),{code:'RESOURCE_NOT_AVAILABLE'});
  const oversized={...persisted.historySnapshot,summary:'x'.repeat(40000)};
  await assert.rejects(transaction(f.orgA,c=>c.query('UPDATE opportunity_catalog.application SET central_snapshot=$2 WHERE organization_id=$1 AND application_id=$3',[f.orgA,oversized,application.applicationId])),{code:'42501'});
  // Runtime cannot update frozen source columns. Exercise INSERT so the size
  // assertions actually reach the CHECK rather than passing on an ACL refusal.
  const insertSource=snapshot=>transaction(f.orgA,c=>c.query("INSERT INTO opportunity_catalog.application(organization_id,application_id,opportunity_id,evaluation_id,title,responsible_membership_id,deadline,status,created_by,central_opportunity_id,central_revision_id,central_snapshot) VALUES($1,$2,NULL,NULL,'Synthetic oversized source',$3,'2028-09-02','IDENTIFIED',$4,$5,$6,$7)",[f.orgA,randomUUID(),f.actor.membershipId,f.actor.id,largeRecord.opportunityId,largeRecord.revisionId,snapshot]));
  await assert.rejects(insertSource(oversized),{code:'23514'});
  const huge={...largeSource,extra:'x'.repeat(270000)};
  await assert.rejects(insertSource(huge),{code:'23514'});
 });
 await check('S6_FROZEN_PRIVATE_REVISION_SURVIVES_CENTRAL_UPDATE',async()=>{
  const next=structuredClone(largeSource);next.description.summary.value='New central revision; frozen applications remain unchanged.';
  const value={requestId:randomUUID(),candidateId:randomUUID(),snapshot:next,mappingDigest:createHash('sha256').update('S6 large fixture').digest('hex'),expected:{opportunityId:largeRecord.opportunityId,revisionId:largeRecord.revisionId,rowVersion:largeRecord.rowVersion}};
  const preview=await persisted.repo.preview(value,{actor:persisted.actor});persisted.approvals.add(preview.previewDigest);
  const updated=await persisted.repo.accept({...value,approvalDigest:preview.previewDigest},{actor:persisted.actor});assert.notEqual(updated.revisionId,largeRecord.revisionId);
  const detail=await transaction(f.orgA,c=>repositories.applications.get(c,application.applicationId));assert.equal(detail.opportunityReadModel.revisionId,largeRecord.revisionId);assert.equal(detail.opportunityReadModel.projection.financing.allocations.value[0].money.amount,'120000');
  assert.deepEqual((await transaction(f.orgA,c=>repositories.interests.get(c,{},interest.interestId))).snapshot,largeSource);
  assert.deepEqual((await central.revision(persisted.legacy.opportunityId,persisted.legacy.revisionId)),persisted.historySnapshot);
 });
 await check('S6_REAL_POSTGRES_HTTP_LIST_DETAIL_AND_FILTERS',async()=>{
  const express=require('../../../backend/node_modules/express'),app=express();let authorized=true;
  const {createFundingRouters}=require('../../../backend/src/fundingTenders/http');
  const routers=createFundingRouters({express,pool,catalogReader:central,authenticate(req,_res,next){req.user={id:f.actor.id};next();},organizationMiddleware:{requireServerSession(req,_res,next){req.sessionID='s6-fixture';next();},resolveOrganizationContext(_req,_res,next){next();}},sessionRegistry:{resolveOrganizationContext:async()=>({state:authorized?'VALID':'INVALID'})}});
  app.use('/catalog',routers.catalog);const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base='http://127.0.0.1:'+server.address().port+'/catalog';
  try{
   const resp=await fetch(base+'/'+persisted.records.eu.opportunityId);assert.equal(resp.status,200);const detail=await resp.json();
   const listed=await fetch(base+'?q=11145');assert.equal(listed.status,200);const list=await listed.json(),row=list.items.find(i=>i.opportunityId===detail.opportunityId);assert(row);
   assert.deepEqual(row.readModel,detail.readModel);assert.equal(detail.readModel.projection.financing.allocations.value[0].money.amount,'120000');assert.equal(detail.readModel.projection.schedule.deadlines.value.length,7);
   assert.equal(detail.readModel.freshness.observedAt,'2026-10-31T00:00:00.000Z');assert.equal(detail.observedAt,detail.readModel.freshness.observedAt);
   const all=[];let cursor;do{const page=await central.list({temporalState:'PLANNED',...(cursor?{cursor}:{})});all.push(...page.items);cursor=page.nextCursor;}while(cursor);
   assert.equal(all.length,177);assert.equal(new Set(all.map(i=>i.opportunityId)).size,177);
   const plans=await central.list({programme:'ALGARVE2030',temporalState:'PLANNED'});assert(plans.items.length);assert(plans.items.every(i=>i.readModel.projection.programmes.value.some(p=>p.label.includes('ALGARVE2030'))));
   const dashboard=await central.dashboardSummary(asOf.slice(0,10),asOf);assert.equal(dashboard.planned,177);
   authorized=false;assert.equal((await fetch(base)).status,404);
   fs.writeFileSync(path.join(outputDirectory,'http-validation.json'),JSON.stringify({status:'PASS',revisionId:detail.revisionId,amount:'120000',currencyState:detail.readModel.projection.financing.allocations.value[0].money.currency.state,cutoffs:7,plans:all.length,dashboardPlanned:dashboard.planned,scope:'Real PostgreSQL and Express routes; synthetic session/authority callbacks'},null,2));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 });
 const centralSchema=require('../../../backend/src/security/centralSchemaManifest'),tenantSchema=require('../../../backend/src/security/tenantSchemaFingerprint');
 await check('S6_CANDIDATE_SCHEMA_FINGERPRINTS',async()=>{
  report.notNullDiagnostics={};
  for(const [name,db] of [['central',pool],['tenant',tenantPool]])report.notNullDiagnostics[name]=(await db.query("SELECT n.nspname,c.relname,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE k.contype='n' AND n.nspname NOT LIKE 'pg_%' AND pg_get_constraintdef(k.oid,true) !~ '^NOT NULL [a-z_][a-z_0-9]*$'")).rows;
  report.candidateFingerprints={central:centralSchema.schemaFingerprint(await centralSchema.centralSchemaSnapshot(pool)),tenant:tenantSchema.tenantSchemaFingerprint(await tenantSchema.tenantSchemaSnapshot(tenantPool)),registered:false};
 });
}
module.exports={tenantProof};
