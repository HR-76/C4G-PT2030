'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const cfg=require('../backend/scripts/localPlatform/config'),{createUuidV7}=require('../backend/src/audit/uuidV7');
const {readSafe}=require('../backend/src/opportunities/v2/euWriterWindowPlan');
const {base,SOURCE,UUID,SHA,check,safeCode,createSessionClient}=require('./lib/eu-reconciliation-browser.cjs');
const {currentPlan,quietSource,CYCLE,RUN}=require('./eu-reconciliation-approve.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
function args(argv){check(Array.isArray(argv)&&argv.length===1&&/^--execution=output\/opportunity-eu-reconciliation-[a-f0-9-]{36}\/installation\.json$/.test(argv[0]),'RECONCILIATION_INSTALLATION_REQUIRED');const file=argv[0].slice(12);check(UUID.test(file.split('/')[1].slice('opportunity-eu-reconciliation-'.length)));return file;}
function artifact(root,ref){check(ref&&typeof ref.path==='string'&&ref.path.startsWith('output/')&&ref.path.endsWith('.json')&&SHA.test(ref.sha256),'RECONCILIATION_ARTIFACT_INVALID');const bytes=readSafe(root,ref.path);check(sha(bytes)===ref.sha256,'RECONCILIATION_ARTIFACT_CHANGED');return JSON.parse(bytes);}
function validateInstallation(installation,loaded,approval,packageInfo){
 const plan=currentPlan(loaded),a=approval?.result?.approval;
 check(installation?.kind==='eu-expired-reconciliation-installation-v1'&&installation.status==='INSTALLED_AWAITING_RECONCILIATION'&&installation.planId===plan.planId&&installation.previewDigest===loaded.previewDigest&&installation.packageDigest===plan.package.packageDigest&&installation.packageDigest===packageInfo.packageDigest&&installation.healthRestored===true,'RECONCILIATION_INSTALLATION_INVALID');
 check(installation.installed?.centralVersion===packageInfo.entry.version&&installation.installed.centralFingerprint===packageInfo.entry.schemaFingerprint&&installation.installed.tenantVersion==='034_application_snapshot_v2'&&installation.installed.tenantFingerprint===require('../backend/src/security/opportunityV2MigrationPackage').tenantAddition.schemaFingerprint,'RECONCILIATION_INSTALLED_PACKAGE_REQUIRED');
 check(installation.source?.state==='QUIESCED'&&installation.source.fence===plan.source.fence&&installation.configuration?.unchanged===true,'RECONCILIATION_INSTALLATION_SCOPE');
 check(approval?.kind==='eu-expired-reconciliation-authenticated-approval-v1'&&approval.status==='PASS'&&approval.planId===plan.planId&&approval.previewDigest===loaded.previewDigest&&approval.scope==='RECONCILIATION_ONLY'&&approval.sessionFabricated===false&&approval.credentialsExported===false&&approval.authentication?.provider==='OIDC'&&approval.authentication.administrator===true&&approval.result?.replayVerified===true&&approval.result.sourceUnchanged===true,'RECONCILIATION_APPROVAL_INVALID');
 check(a?.scope==='RECONCILIATION_ONLY'&&a.planId===plan.planId&&a.previewDigest===loaded.previewDigest&&a.expiresAt===plan.expiresAt&&a.actorId===installation.approval?.actorId&&a.actorId===approval.authentication.actorId&&a.eventId===installation.approval.eventId&&a.eventHash===installation.approval.eventHash&&UUID.test(a.actorId)&&UUID.test(a.eventId)&&SHA.test(a.eventHash),'RECONCILIATION_APPROVAL_BINDING_INVALID');
 return a;
}
function loadExecution(relative,root=cfg.root){
 args(['--execution='+relative]);const bytes=readSafe(root,relative),installation=JSON.parse(bytes),id=relative.split('/')[1].slice('opportunity-eu-reconciliation-'.length);
 check(installation.planId===id);const {loadReconciliationPlan}=require('../backend/src/opportunities/v2/euRunReconciliation'),loaded=loadReconciliationPlan(root,id);
 assert.deepEqual(artifact(root,installation.plan),loaded.plan,'RECONCILIATION_PLAN_CHANGED');
 const approval=artifact(root,installation.approval),packageInfo=require('../backend/src/security/opportunityEuReconciliationMigrationPackage');validateInstallation(installation,loaded,approval,packageInfo);
 const hashes=installation.configuration.hashes,privateFiles=require('../backend/src/opportunities/v2/euWriterWindowPlan').PRIVATE_FILES;
 check(hashes && Object.keys(hashes).length===privateFiles.length && privateFiles.every(file=>SHA.test(hashes[file]) && loaded.plan.inputs[file]===hashes[file]), 'RECONCILIATION_CONFIGURATION_PROOF_INVALID');
 for(const file of privateFiles)check(sha(readSafe(root,file))===hashes[file],'RECONCILIATION_CONFIGURATION_CHANGED');
 return{loaded,installation,approval,executionDigest:sha(bytes),relative};
}
function executionBinding(value,{loaded,requestId,actorId}){
 const p=loaded.plan,r=value?.result;check(value?.planId===p.planId&&value.previewDigest===loaded.previewDigest&&value.requestId===requestId&&value.actorId===actorId&&value.cycleId===CYCLE&&value.runId===RUN&&value.sourceFence===p.source.fence&&typeof value.replayed==='boolean','RECONCILIATION_EXECUTION_INVALID');
 check(r?.runStatus==='ERROR'&&r.cycleStatus==='ERROR'&&r.errorCode==='FUNDING_EXECUTION_EXPIRED'&&r.inboxState==='FAILED'&&r.inboxResult==='EXPIRED'&&r.executionState==='EXPIRED'&&r.outboxState==='PUBLISHED'&&r.source?.state==='QUIESCED'&&r.source.fence===p.source.fence&&r.targetsChanged===false&&r.pendingRuns===0,'RECONCILIATION_RESULT_INVALID');return value;
}
async function executeApproved({loaded,installation,approval,openSession,clock=Date.now,onProgress=async()=>{},requestId=createUuidV7(),revalidate=()=>{}}){
 const plan=currentPlan(loaded,clock()),approved=approval.result.approval,actorId=installation.approval.actorId;
 check(approved.actorId===actorId&&approved.previewDigest===loaded.previewDigest&&approved.eventId===installation.approval.eventId&&approved.eventHash===installation.approval.eventHash,'RECONCILIATION_APPROVAL_BINDING_INVALID');
 const client=createSessionClient({planId:plan.planId,operation:'execute',expectedActorId:actorId,openSession,clock,onProgress}),assertCurrent=async()=>{currentPlan(loaded,clock());await revalidate();};
 try{
  quietSource(await client.request('GET',SOURCE),plan.source.fence,1);
  const detail=await client.request('GET',base(plan.planId));check(detail?.scope==='EXPIRED_RUN_RECONCILIATION'&&detail.previewDigest===loaded.previewDigest,'RECONCILIATION_PREVIEW_CHANGED');assert.deepEqual(detail.plan,plan,'RECONCILIATION_PREVIEW_CHANGED');
  const input={requestId,previewDigest:loaded.previewDigest,approvalEventId:approved.eventId,approvalEventHash:approved.eventHash};
  const executed=executionBinding(await client.mutate(input,{assertCurrent}),{loaded,requestId,actorId});await onProgress({stage:'executed',receipt:executed});
  const replay=executionBinding(await client.mutate(input,{assertCurrent}),{loaded,requestId,actorId});check(replay.replayed===true,'RECONCILIATION_REPLAY_INVALID');assert.deepEqual({...replay,replayed:false},{...executed,replayed:false},'RECONCILIATION_REPLAY_CHANGED');
  const source=quietSource(await client.request('GET',SOURCE),plan.source.fence,0);check(source.state==='QUIESCED','RECONCILIATION_SOURCE_CHANGED');
  return{actorId,execution:executed,replayVerified:true,sourceControlUnchanged:true,source,newEnqueues:0,resumed:false};
 }finally{await client.close();}
}
async function main(argv=process.argv.slice(2)){
 const relative=args(argv),input=loadExecution(relative),folder=path.dirname(path.join(cfg.root,relative)),file=path.join(folder,'execution.json');
 const report={kind:'eu-expired-reconciliation-authenticated-execution-v1',status:'IN_PROGRESS',planId:input.loaded.plan.planId,previewDigest:input.loaded.previewDigest,installation:{path:relative,sha256:input.executionDigest},approval:input.installation.approval,sessionFabricated:false,credentialsExported:false,newEnqueues:0,resumed:false,startedAt:new Date().toISOString(),steps:[]};
 fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});const save=()=>cfg.saveState(report,file);
 try{report.result=await executeApproved({...input,onProgress:async step=>{report.steps.push(step);save();},revalidate:()=>assert.deepEqual(loadExecution(relative),input,'RECONCILIATION_INSTALLATION_CHANGED')});report.authentication={provider:'OIDC',administrator:true,actorId:report.result.actorId,policy:'c4g-user-mfa-v1'};report.status='PASS';}
 catch(e){report.status='FAIL';report.failure=safeCode(e);process.exitCode=1;}finally{report.completedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,planId:report.planId,evidence:path.relative(cfg.root,file).replaceAll('\\','/'),failure:report.failure||null}));}return report;
}
if(require.main===module)main().catch(e=>{console.error(safeCode(e));process.exitCode=1;});
module.exports={args,validateInstallation,loadExecution,executionBinding,executeApproved,main};
