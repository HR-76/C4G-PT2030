'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto'),assert=require('node:assert/strict');
const cfg=require('../backend/scripts/localPlatform/config'),{createUuidV7}=require('../backend/src/audit/uuidV7');
const {base,SOURCE,UUID,SHA,check,safeCode,createSessionClient}=require('./lib/eu-reconciliation-browser.cjs');
const CYCLE='7266ad6b-8880-4ec1-9399-4751187831c5',RUN='75b462ed-a399-4bdb-bd96-ed18507761c9';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function args(argv){check(Array.isArray(argv)&&argv.length===1&&argv[0].startsWith('--plan=')&&UUID.test(argv[0].slice(7)),'RECONCILIATION_PLAN_REQUIRED');return argv[0].slice(7);}
function currentPlan(loaded,now=Date.now()){
 const p=loaded?.plan;check(p&&UUID.test(p.planId)&&p.cycleId===CYCLE&&p.runId===RUN&&p.source?.state==='QUIESCED'&&Number.isSafeInteger(p.source.fence)&&p.source.fence>0&&SHA.test(loaded.previewDigest)&&p.previewDigest===loaded.previewDigest,'RECONCILIATION_PLAN_INVALID');
 check(Number.isFinite(Date.parse(p.createdAt))&&Date.parse(p.createdAt)<=now&&Number.isFinite(Date.parse(p.expiresAt))&&Date.parse(p.expiresAt)>now,'RECONCILIATION_PLAN_EXPIRED');return p;
}
function quietSource(value,fence,pending){
 check(value?.family==='EU_FUNDING_TENDERS'&&value.state==='QUIESCED'&&value.fence===fence&&value.writerMode==='CANONICAL_V2'&&value.pendingRuns===pending&&value.otherPendingRuns===0
  &&['activeRunLeases','activeInboxLeases','activeOutboxLeases'].every(k=>value[k]===0),'RECONCILIATION_SOURCE_CHANGED');
 return Object.fromEntries(['family','state','fence','writerMode','writerPolicy','writerMappingDigest','pendingRuns','otherPendingRuns','activeRunLeases','activeInboxLeases','activeOutboxLeases'].map(k=>[k,value[k]]));
}
function approvalBinding(value,{loaded,requestId,actorId}){
 const p=loaded.plan;check(value?.scope==='RECONCILIATION_ONLY'&&value.planId===p.planId&&value.previewDigest===loaded.previewDigest&&value.requestId===requestId&&value.actorId===actorId&&value.eventId===requestId&&SHA.test(value.eventHash)&&value.expiresAt===p.expiresAt&&typeof value.replayed==='boolean','RECONCILIATION_APPROVAL_INVALID');return value;
}
async function approvePrepared({loaded,openSession,clock=Date.now,onProgress=async()=>{},requestId=createUuidV7(),revalidate=()=>{}}){
 const plan=currentPlan(loaded,clock()),client=createSessionClient({planId:plan.planId,operation:'approve',openSession,clock,onProgress});
 const assertCurrent=async()=>{currentPlan(loaded,clock());await revalidate();};
 try{
  const before=quietSource(await client.request('GET',SOURCE),plan.source.fence,1),detail=await client.request('GET',base(plan.planId));
  check(detail?.scope==='EXPIRED_RUN_RECONCILIATION'&&detail.previewDigest===loaded.previewDigest,'RECONCILIATION_PREVIEW_CHANGED');assert.deepEqual(detail.plan,plan,'RECONCILIATION_PREVIEW_CHANGED');quietSource(detail.source,plan.source.fence,1);
  const input={requestId,previewDigest:loaded.previewDigest};
  const approval=approvalBinding(await client.mutate(input,{assertCurrent}),{loaded,requestId,actorId:client.actorId()});await onProgress({stage:'approved',approval});
  const replay=approvalBinding(await client.mutate(input,{assertCurrent}),{loaded,requestId,actorId:client.actorId()});check(replay.replayed===true,'RECONCILIATION_REPLAY_INVALID');assert.deepEqual({...replay,replayed:false},{...approval,replayed:false},'RECONCILIATION_REPLAY_CHANGED');
  const after=quietSource(await client.request('GET',SOURCE),plan.source.fence,1);assert.deepEqual(after,before,'RECONCILIATION_SOURCE_CHANGED');
  return{actorId:client.actorId(),approval,replayVerified:true,sourceUnchanged:true,source:after};
 }finally{await client.close();}
}
async function main(argv=process.argv.slice(2)){
 const planId=args(argv),{loadReconciliationPlan}=require('../backend/src/opportunities/v2/euRunReconciliation'),loaded=loadReconciliationPlan(cfg.root,planId),folder=path.join(cfg.root,'output','opportunity-eu-reconciliation-'+planId),planFile=path.join(folder,'plan.json');
 currentPlan(loaded);check(!fs.readdirSync(folder).some(file=>/^approval-[a-f0-9-]{36}\.json$/.test(file)),'RECONCILIATION_APPROVAL_ALREADY_ATTEMPTED');
 const report={kind:'eu-expired-reconciliation-authenticated-approval-v1',status:'IN_PROGRESS',planId,previewDigest:loaded.previewDigest,plan:{path:path.relative(cfg.root,planFile).replaceAll('\\','/'),sha256:sha(fs.readFileSync(planFile))},scope:'RECONCILIATION_ONLY',startedAt:new Date().toISOString(),sessionFabricated:false,credentialsExported:false,steps:[]};
 const file=path.join(folder,'approval-'+randomUUID()+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});const save=()=>cfg.saveState(report,file);
 try{report.result=await approvePrepared({loaded,onProgress:async step=>{report.steps.push(step);save();},revalidate:()=>assert.deepEqual(loadReconciliationPlan(cfg.root,planId),loaded,'RECONCILIATION_PLAN_CHANGED')});report.authentication={provider:'OIDC',administrator:true,actorId:report.result.actorId,policy:'c4g-user-mfa-v1'};report.status='PASS';}
 catch(e){report.status='FAIL';report.failure=safeCode(e);process.exitCode=1;}finally{report.completedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,planId,evidence:path.relative(cfg.root,file).replaceAll('\\','/'),failure:report.failure||null}));}return report;
}
if(require.main===module)main().catch(e=>{console.error(safeCode(e));process.exitCode=1;});
module.exports={args,currentPlan,quietSource,approvalBinding,approvePrepared,main,CYCLE,RUN};
