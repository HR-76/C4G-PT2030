'use strict';
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {createOpportunityInterestRepository}=require('../../../backend/src/opportunityInterests/repository');
const {createApplicationRepository}=require('../../../backend/src/applications/repository');
const {command}=require('../../../backend/src/applications/contracts');
const {createAuditEvent}=require('../../../backend/src/audit/event');
const {createUuidV7}=require('../../../backend/src/audit/uuidV7');
const {createAppendService}=require('../../../backend/src/audit/appendService');
const {PostgresAppendRepository}=require('../../../backend/src/audit/postgresAppendRepository');

function fixture(){
 const orgA=randomUUID(),orgB=randomUUID(),actor={id:randomUUID(),membershipId:randomUUID()},sources=new Map(),revisions=new Map();
 const source=()=>{const opportunityId=randomUUID(),revisionId=randomUUID(),snapshot={schemaVersion:1,title:'Synthetic interest source',lifecycleState:'ACTIVE',closingDate:'2099-12-31'};
  sources.set(opportunityId,{revisionId,snapshot});revisions.set(revisionId,{opportunityId,snapshot});return {opportunityId,centralRevisionId:revisionId};};
 const origin=source(),other=source(),third=source();
 return {orgA,orgB,actor,origin,other,third,sources,revisions,units:{a:randomUUID(),a2:randomUUID(),archived:randomUUID(),team:randomUUID(),foreign:randomUUID()},
  centralCurrent:async id=>{const value=sources.get(id);if(!value)throw Object.assign(Error(),{code:'RESOURCE_NOT_AVAILABLE'});return structuredClone(value);},
  centralOrigin:async(id,revision)=>{const value=revisions.get(revision);if(!value||value.opportunityId!==id)throw Object.assign(Error(),{code:'RESOURCE_NOT_AVAILABLE'});return structuredClone(value.snapshot);}};
}
function auditCandidate(f,org,event){
 return createAuditEvent({trustedContext:{organizationId:org,tenantId:org,operationAuthority:'TENANT',operationCode:event.operationCode,
   catalogVersion:'f13-editorial-events-v1',source:'API',channel:'APPLICATION',synchronous:true},input:{eventCode:event.eventCode,
   actor:{type:'HUMAN',id:f.actor.id,membershipId:f.actor.membershipId,serviceActorCode:null,supportGrantId:null},subject:null,
   resource:{type:event.operationCode.startsWith('OPPORTUNITY_INTEREST')?'OPPORTUNITY_INTEREST':'APPLICATION',id:event.resourceId},decision:'ACCEPT',outcome:'SUCCESS',
   observedAt:new Date().toISOString(),correlationId:createUuidV7(),causationId:null,idempotencyKey:`GATE:${event.operationCode}:${event.idempotencyKey}`,streamType:'DATA',payload:{detailCode:event.eventCode}}});
}
function auditWriter(f,org,{failAfterAppend=false}={}){
 const append=createAppendService({appendPort:new PostgresAppendRepository()});
 return async(client,event)=>{
  await append.append(auditCandidate(f,org,event),client);if(failAfterAppend)throw Error('SYNTHETIC_AFTER_REAL_AUDIT');
 };
}
function repositories(f,org=f.orgA,options={}){
 const protect=async()=>{if(options.denied)throw Object.assign(Error(),{code:'NOT_AUTHORIZED'});};
 const common={organizationId:org,actor:f.actor,protect,authorize:async()=>!options.denied,cursor:{cursor:value=>String(value),openCursor:value=>/^\d+$/.test(value)?Number(value):value},
  centralOrigin:f.centralOrigin,centralCurrent:f.centralCurrent,audit:auditWriter(f,org,options)};
 return {interests:createOpportunityInterestRepository(common),applications:createApplicationRepository({...common,verifyResponsible:async id=>id===f.actor.membershipId})};
}
async function seedBaseline(inspect,transaction,f){
 for(const [id,org,type,status,label] of [[f.units.a,f.orgA,'UNIT','ACTIVE','Unit A'],[f.units.a2,f.orgA,'UNIT','ACTIVE','Unit A2'],
  [f.units.archived,f.orgA,'UNIT','ARCHIVED','Archived unit'],[f.units.team,f.orgA,'TEAM','ACTIVE','Team'],[f.units.foreign,f.orgB,'UNIT','ACTIVE','Foreign unit']]){
  await transaction(org,client=>client.query(`INSERT INTO organizational_scope.scope(scope_id,organization_id,scope_type,label,lifecycle,provenance,created_by_actor_type,created_by_actor_id,updated_by_actor_type,updated_by_actor_id,archived_at,archived_by_actor_id,archive_reason_code)
   VALUES($1,$2,$3,$4,$5,'{}','HUMAN',$6,'HUMAN',$6,CASE WHEN $5='ARCHIVED' THEN clock_timestamp() ELSE NULL END,CASE WHEN $5='ARCHIVED' THEN $6::uuid ELSE NULL END,CASE WHEN $5='ARCHIVED' THEN 'SYNTHETIC' ELSE NULL END)`,[id,org,type,label,status,f.actor.id]));
 }
 const input=command('create',{origin:'CENTRAL',...f.origin,evaluationId:null,title:'Preserved existing application',responsibleMembershipId:f.actor.membershipId,
  deadline:'2099-11-30',notes:'Preserve notes',totalBudget:'123.45',organizationBudget:'0',idempotencyKey:randomUUID()});
 f.baselineApplication=await transaction(f.orgA,client=>repositories(f).applications.create(client,input));
 f.baselineInput=input;
}
async function preserved(inspect){
 const values={};
 for(const table of ['opportunity_catalog.application','opportunity_catalog.application_change','opportunity_catalog.application_receipt','organizational_scope.scope','audit.event','audit.event_identity','audit.chain_head','c4g_system.schema_migration']){
  values[table]=(await inspect(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows.map(row=>row.row);
 }
 return {digest:createHash('sha256').update(JSON.stringify(values)).digest('hex'),values};
}
async function runProof({f,transaction,inspect,check,concurrent=false,reconnectTransaction=null}){
 const repo=repositories(f),body={...f.origin,unitIds:[f.units.a],idempotencyKey:randomUUID()};
 const counts=async()=>({interests:Number((await inspect('SELECT count(*) AS n FROM opportunity_catalog.opportunity_interest')).rows[0].n),
  applications:Number((await inspect('SELECT count(*) AS n FROM opportunity_catalog.application')).rows[0].n),
  changes:Number((await inspect('SELECT count(*) AS n FROM opportunity_catalog.interest_change')).rows[0].n),
  receipts:Number((await inspect('SELECT count(*) AS n FROM opportunity_catalog.interest_receipt')).rows[0].n),
  audits:Number((await inspect('SELECT count(*) AS n FROM audit.event')).rows[0].n)});
 let interest,application;
 await check('REGISTER_REPLAY_EXISTING_AND_DENIED_AUTHORITY_FIXTURE',async()=>{
  interest=await transaction(f.orgA,c=>repo.interests.register(c,body));assert.equal(interest.status,'ACTIVE');assert.deepEqual(interest.unitIds,[f.units.a]);
  const before=await counts();const replay=await transaction(f.orgA,c=>repo.interests.register(c,body));assert.deepEqual(replay,interest);assert.deepEqual(await counts(),before);
  const duplicate=await transaction(f.orgA,c=>repo.interests.register(c,{...body,unitIds:[],idempotencyKey:randomUUID()}));assert.equal(duplicate.interestId,interest.interestId);assert.deepEqual(duplicate.unitIds,[f.units.a]);
  await assert.rejects(transaction(f.orgA,c=>repo.interests.register(c,{...body,unitIds:[]})),{code:'IDEMPOTENCY_CONFLICT'});
  await assert.rejects(transaction(f.orgA,c=>repositories(f,f.orgA,{denied:true}).interests.register(c,{...body,idempotencyKey:randomUUID()})),{code:'NOT_AUTHORIZED'});
 });
 await check('RLS_FOREIGN_READ_AND_WRITE_REFUSED',async()=>{
  const visible=await transaction(f.orgB,c=>c.query('SELECT interest_id FROM opportunity_catalog.opportunity_interest WHERE interest_id=$1',[interest.interestId]));assert.equal(visible.rows.length,0);
  await assert.rejects(transaction(f.orgB,c=>c.query(`INSERT INTO opportunity_catalog.opportunity_interest(organization_id,interest_id,central_opportunity_id,central_revision_id,central_snapshot,title,created_by,created_membership_id)
   VALUES($1,$2,$3,$4,'{}','Forbidden',$5,$6)`,[f.orgA,randomUUID(),randomUUID(),randomUUID(),f.actor.id,f.actor.membershipId])),{code:'42501'});
  await assert.rejects(transaction(f.orgB,c=>repositories(f,f.orgB).interests.get(c,{},interest.interestId)),{code:'RESOURCE_NOT_AVAILABLE'});
 });
 await check('SQL_UNIT_GUARDS_AND_LINK_IMMUTABILITY',async()=>{
  for(const unit of [f.units.team,f.units.foreign,f.units.archived,randomUUID()])await assert.rejects(transaction(f.orgA,c=>c.query(
   'INSERT INTO opportunity_catalog.interest_unit(organization_id,interest_id,scope_id,active) VALUES($1,$2,$3,true)',[f.orgA,interest.interestId,unit])));
  await assert.rejects(transaction(f.orgA,c=>c.query('UPDATE opportunity_catalog.interest_change SET notes=notes WHERE interest_id=$1',[interest.interestId])),{code:'42501'});
  await assert.rejects(transaction(f.orgA,c=>c.query('DELETE FROM opportunity_catalog.opportunity_interest WHERE interest_id=$1',[interest.interestId])),{code:'42501'});
  await assert.rejects(transaction(f.orgA,c=>repo.interests.register(c,{...f.other,unitIds:[f.units.foreign],idempotencyKey:randomUUID()})),{code:'UNIT_UNAVAILABLE'});
 });
 await check('CONVERT_EXPLICIT_CURRENT_SOURCE_AND_PRESERVE_INTEREST_OBSERVATION',async()=>{
  const currentRevision=randomUUID(),snapshot={...f.sources.get(f.origin.opportunityId).snapshot,title:'Updated source'};
  f.sources.set(f.origin.opportunityId,{revisionId:currentRevision,snapshot});f.revisions.set(currentRevision,{opportunityId:f.origin.opportunityId,snapshot});
  const input=command('create',{origin:'CENTRAL',opportunityId:f.origin.opportunityId,centralRevisionId:currentRevision,evaluationId:null,title:'Converted application',
   responsibleMembershipId:f.actor.membershipId,deadline:'2099-11-20',sourceInterestId:interest.interestId,sourceInterestRevision:interest.revision,
   unitIds:[f.units.a,f.units.a2].sort(),includeResponsibleInTeam:true,idempotencyKey:randomUUID()});
  application=await transaction(f.orgA,c=>repo.applications.create(c,input));assert.equal(application.sourceInterestId,interest.interestId);assert.equal(application.status,'IDENTIFIED');
  assert.deepEqual(application.unitIds,[f.units.a,f.units.a2].sort());assert.equal(application.centralRevisionId,currentRevision);
  const members=await inspect('SELECT membership_id FROM opportunity_catalog.application_participant WHERE application_id=$1 AND active',[application.applicationId]);assert.equal(members.rows[0].membership_id,f.actor.membershipId);
  assert.deepEqual(await transaction(f.orgA,c=>repo.applications.create(c,input)),application);
  const original=await transaction(f.orgA,c=>repo.interests.get(c,{},interest.interestId));assert.equal(original.centralRevisionId,f.origin.centralRevisionId);
  await assert.rejects(transaction(f.orgA,c=>repo.applications.create(c,{...input,sourceInterestRevision:99,idempotencyKey:randomUUID()})),{code:'STALE_REVISION'});
 });
 await check('EDIT_ARCHIVE_HISTORY_AND_INDEPENDENT_APPLICATION_UNITS',async()=>{
  const edit={notes:'Reviewed synthetic interest',unitIds:[f.units.a2],expectedRevision:interest.revision,idempotencyKey:randomUUID()};
  const edited=await transaction(f.orgA,c=>repo.interests.edit(c,edit,interest.interestId));assert.equal(edited.revision,2);
  await assert.rejects(transaction(f.orgA,c=>repo.interests.edit(c,{...edit,idempotencyKey:randomUUID()},interest.interestId)),{code:'STALE_REVISION'});
  const applicationUnits=(await inspect('SELECT scope_id FROM opportunity_catalog.application_unit WHERE application_id=$1 AND active ORDER BY scope_id',[application.applicationId])).rows.map(row=>row.scope_id);
  assert.deepEqual(applicationUnits,[f.units.a,f.units.a2].sort());
  // Archive the selected unit, then retain that historical link while editing
  // notes. New/re-enabled links must still be rejected by both API and SQL.
  await transaction(f.orgA,c=>c.query(`UPDATE organizational_scope.scope SET lifecycle='ARCHIVED',revision=revision+1,updated_at=transaction_timestamp(),
   archived_at=transaction_timestamp(),archived_by_actor_id=$3,archive_reason_code='SYNTHETIC',updated_by_actor_type='HUMAN',updated_by_actor_id=$3
   WHERE organization_id=$1 AND scope_id=$2`,[f.orgA,f.units.a2,f.actor.id]));
  const retained=await transaction(f.orgA,c=>repo.interests.edit(c,{...edit,notes:'Keep historical unit',expectedRevision:2,idempotencyKey:randomUUID()},interest.interestId));
  assert.equal(retained.units[0].lifecycle,'ARCHIVED');assert.equal(retained.revision,3);
  await assert.rejects(transaction(f.orgA,c=>repo.interests.register(c,{...f.third,unitIds:[f.units.a2],idempotencyKey:randomUUID()})),{code:'UNIT_UNAVAILABLE'});
  await transaction(f.orgA,c=>repo.interests.edit(c,{...edit,unitIds:[],expectedRevision:3,idempotencyKey:randomUUID()},interest.interestId));
  await assert.rejects(transaction(f.orgA,c=>repo.interests.edit(c,{...edit,expectedRevision:4,idempotencyKey:randomUUID()},interest.interestId)),{code:'UNIT_UNAVAILABLE'});
  await assert.rejects(transaction(f.orgA,c=>c.query('UPDATE opportunity_catalog.interest_unit SET active=true WHERE organization_id=$1 AND interest_id=$2 AND scope_id=$3',[f.orgA,interest.interestId,f.units.a2])));
  const archive={reason:'Synthetic review complete',expectedRevision:4,idempotencyKey:randomUUID()};
  const archived=await transaction(f.orgA,c=>repo.interests.archive(c,archive,interest.interestId));assert.equal(archived.status,'ARCHIVED');
  assert.deepEqual(await transaction(f.orgA,c=>repo.interests.archive(c,archive,interest.interestId)),archived);
  const history=await transaction(f.orgA,c=>repo.interests.history(c,{cursor:null},interest.interestId));assert.deepEqual(history.items.map(row=>row.action),['ARCHIVE','EDIT','EDIT','EDIT','REGISTER']);
  assert.equal(history.items.at(-1).units[0].label,'Unit A');
  await assert.rejects(transaction(f.orgA,c=>repo.interests.edit(c,{...edit,expectedRevision:5,idempotencyKey:randomUUID()},interest.interestId)),{code:'STATE_CONFLICT'});
 });
 await check('REAL_AUDIT_FAILURE_ROLLS_BACK_AGGREGATE_HISTORY_RECEIPT_AND_LEDGER',async()=>{
  const before=await counts(),head=(await inspect('SELECT * FROM audit.chain_head ORDER BY stream_id')).rows;
  const failedBody={...f.other,unitIds:[f.units.a],idempotencyKey:randomUUID()};
  await assert.rejects(transaction(f.orgA,c=>repositories(f,f.orgA,{failAfterAppend:true}).interests.register(c,failedBody)),/SYNTHETIC_AFTER_REAL_AUDIT/);
  assert.deepEqual(await counts(),before);assert.deepEqual((await inspect('SELECT * FROM audit.chain_head ORDER BY stream_id')).rows,head);
  const saved=await transaction(f.orgA,c=>repo.interests.register(c,failedBody));assert.equal(saved.status,'ACTIVE');
 });
 if(concurrent)await check('CONCURRENT_COMMITTED_REPLAY_HAS_ONE_AGGREGATE',async()=>{
  const input={...f.third,unitIds:[],idempotencyKey:randomUUID()},before=await counts();
  const results=await Promise.all([transaction(f.orgA,c=>repo.interests.register(c,input)),transaction(f.orgA,c=>repo.interests.register(c,input))]);
  assert.deepEqual(results[0],results[1]);assert.equal((await counts()).interests,before.interests+1);
  if(reconnectTransaction)assert.deepEqual(await reconnectTransaction(f.orgA,c=>repo.interests.register(c,input)),results[0]);
 });
 return {counts:await counts(),interestId:interest.interestId,applicationId:application.applicationId};
}
module.exports={fixture,auditCandidate,repositories,seedBaseline,preserved,runProof};
