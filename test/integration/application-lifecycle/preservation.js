'use strict';
const assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {canonicalize}=require('../../../backend/src/organizationalProfile/canonicalization');
const {createApplicationRepository}=require('../../../backend/src/applications/repository');
const {createWorkRepository}=require('../../../backend/src/applications/work');
const {command}=require('../../../backend/src/applications/contracts');
async function prepare(client){
 const org=randomUUID(),actor={id:randomUUID()},membership=randomUUID();
 await client.query("SELECT set_config('app.organization_id',$1,true)",[org]);
 await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
 const deps={organizationId:org,actor,protect:async()=>{},authorize:async()=>true,verifyResponsible:async()=>true,audit:async()=>{},cursor:{cursor:v=>String(v),openCursor:v=>Number(v)},centralOrigin:async()=>({title:'Old opportunity',lifecycleState:'ACTIVE'})};
 const repository=createApplicationRepository(deps),work=createWorkRepository(deps);
 const input=command('create',{origin:'CENTRAL',centralRevisionId:randomUUID(),opportunityId:randomUUID(),evaluationId:null,title:'Old application',responsibleMembershipId:membership,deadline:'2026-12-31',idempotencyKey:randomUUID()});
 const before=await repository.create(client,input);assert.equal(before.status,'INTENTION');
 const oldInput={...input,idempotencyKey:randomUUID()},oldProjection={...before};
 for(const key of ['notes','totalBudget','organizationBudget','statusChangedAt','lastSubmittedAt','lifecycleExtended'])delete oldProjection[key];
 const oldDigest=createHash('sha256').update(canonicalize({operation:'CREATE',resourceId:oldInput.opportunityId,input:oldInput,organizationId:org,subjectId:actor.id})).digest('hex');
 await client.query("INSERT INTO opportunity_catalog.application_receipt(organization_id,idempotency_key,operation,subject_id,resource_id,intention_digest,result_projection) VALUES($1,$2,'CREATE',$3,$4,$5,$6)",[org,oldInput.idempotencyKey,actor.id,oldInput.opportunityId,oldDigest,oldProjection]);
 await work.taskCreate(client,before.applicationId,{title:'Existing task',responsibleMembershipId:membership,deadline:'2026-12-30',expectedRevision:1,idempotencyKey:randomUUID()});
 const taskBefore=await work.workGet(client,before.applicationId,{});
 const historyBefore=await repository.history(client,before.applicationId,{cursor:null});
 const receiptBefore=(await client.query('SELECT * FROM opportunity_catalog.application_receipt')).rows;
 await client.query('RESET ROLE');
 return async()=>{
  await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
  assert.deepEqual(await repository.create(client,input),before,'Old receipt must replay byte-for-byte as JSON');
  assert.deepEqual(await repository.create(client,command('create',oldInput)),oldProjection,'Original response shape must not gain new fields on replay');
  const read=await repository.get(client,before.applicationId);assert.equal(read.status,'INTENTION');assert.equal(read.notes,null);assert.equal(read.revision,1);
  assert.deepEqual(await work.workGet(client,before.applicationId,{}),taskBefore);
  assert.deepEqual(await repository.history(client,before.applicationId,{cursor:null}),historyBefore);
  assert.deepEqual((await client.query('SELECT * FROM opportunity_catalog.application_receipt')).rows,receiptBefore);
  const fresh=await repository.create(client,{...input,deadline:'2026-07-01',idempotencyKey:randomUUID(),totalBudget:'0',organizationBudget:'123.45',notes:'Preserved cents'});assert.equal(fresh.status,'IDENTIFIED');assert.equal(fresh.deadline,'2026-07-01');assert.equal(fresh.totalBudget,'0');assert.equal(fresh.organizationBudget,'123.45');
  // Event order is the immutable revision, even if transaction clocks go backwards.
  for(const [revision,from,to,date] of [[2,'IDENTIFIED','SUBMITTED','2020-01-01'],[3,'SUBMITTED','PREPARATION','2019-01-01'],[4,'PREPARATION','SUBMITTED','2018-01-01']]){
   await client.query(`INSERT INTO opportunity_catalog.application_change(organization_id,application_id,revision,kind,from_status,to_status,title,responsible_membership_id,deadline,reason,actor_subject_id,recorded_at,notes,total_budget,organization_budget)
    SELECT organization_id,application_id,$2,'TRANSITION',$3,$4,title,responsible_membership_id,deadline,'Clock ordering fixture',created_by,$5,notes,total_budget,organization_budget FROM opportunity_catalog.application WHERE application_id=$1`,[fresh.applicationId,revision,from,to,date+'T00:00:00Z']);
   await client.query('UPDATE opportunity_catalog.application SET revision=$2,status=$3 WHERE application_id=$1',[fresh.applicationId,revision,to]);
  }
  const latest=await repository.get(client,fresh.applicationId);assert.equal(latest.statusChangedAt,'2018-01-01T00:00:00.000Z');assert.equal(latest.lastSubmittedAt,'2018-01-01T00:00:00.000Z');
  // DB constraints independently reject precision/range violations (no rounding).
  for(const amount of ['1.001','-1','100000000000000','NaN']){
   await client.query('SAVEPOINT invalid_budget');
   await assert.rejects(()=>client.query('UPDATE opportunity_catalog.application SET total_budget=$1 WHERE application_id=$2',[amount,fresh.applicationId]),{code:'23514'});
   await client.query('ROLLBACK TO SAVEPOINT invalid_budget');
  }
  await client.query('RESET ROLE');console.log('MIGRATION_OLD_RECEIPT_HISTORY_TASKS_PRESERVED_PASS');
 };
}
module.exports={prepare};
