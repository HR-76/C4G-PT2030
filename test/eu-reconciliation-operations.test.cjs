'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {approvePrepared,args:approvalArgs,CYCLE,RUN}=require('../scripts/eu-reconciliation-approve.cjs');
const {executeApproved,validateInstallation,args:executionArgs}=require('../scripts/eu-reconciliation-execute.cjs');
const {SOURCE,base}=require('../scripts/lib/eu-reconciliation-browser.cjs');
const id='01900000-0000-7000-8000-000000000001',actor='01900000-0000-7000-8000-000000000002',request='01900000-0000-7000-8000-000000000003',event='01900000-0000-7000-8000-000000000004',digest='a'.repeat(64),eventHash='b'.repeat(64);
function fixture({operation='approve',lost=false,slowLogin=false,wrongActor=false,badResult=false}={}){
 let now=Date.now(),posts=[],sessions=0,closed=0,pending=1,accepted=null;
 const plan={planId:id,cycleId:CYCLE,runId:RUN,createdAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),source:{state:'QUIESCED',fence:7},package:{packageDigest:'c'.repeat(64)},previewDigest:digest},loaded={plan,previewDigest:digest};
 const receipt={scope:'RECONCILIATION_ONLY',planId:id,previewDigest:digest,requestId:event,actorId:actor,eventId:event,eventHash,expiresAt:plan.expiresAt,replayed:false};
 const approval={kind:'eu-expired-reconciliation-authenticated-approval-v1',status:'PASS',planId:id,previewDigest:digest,scope:'RECONCILIATION_ONLY',sessionFabricated:false,credentialsExported:false,authentication:{provider:'OIDC',administrator:true,actorId:actor},result:{approval:receipt,replayVerified:true,sourceUnchanged:true}};
 const installation={kind:'eu-expired-reconciliation-installation-v1',status:'INSTALLED_AWAITING_RECONCILIATION',planId:id,previewDigest:digest,packageDigest:plan.package.packageDigest,healthRestored:true,source:plan.source,configuration:{unchanged:true},approval:{actorId:actor,eventId:event,eventHash},installed:{centralVersion:'044_opportunity_eu_expired_reconciliation',centralFingerprint:'d'.repeat(64),tenantVersion:'034_application_snapshot_v2',tenantFingerprint:require('../backend/src/security/opportunityV2MigrationPackage').tenantAddition.schemaFingerprint}};
 const source=()=>({family:'EU_FUNDING_TENDERS',state:'QUIESCED',fence:7,writerMode:'CANONICAL_V2',writerPolicy:'eu-existing-v2.0',writerMappingDigest:'e'.repeat(64),pendingRuns:pending,otherPendingRuns:0,activeRunLeases:0,activeInboxLeases:0,activeOutboxLeases:0});
 const openSession=async()=>{sessions++;if(slowLogin)now+=61000;return{authenticatedAt:now,close:async()=>{closed++;},request:async(method,url,body)=>{
  if(url==='/api/auth/session')return{user:{id:wrongActor?event:actor,platformRoles:['C4G_ADMIN']}};
  if(method==='GET'&&url===SOURCE)return source();if(method==='GET'&&url===base(id))return{plan,previewDigest:digest,scope:'EXPIRED_RUN_RECONCILIATION',source:source()};
  posts.push({url,body});const replay=accepted!==null;
  if(operation==='approve')accepted||={...receipt,requestId:body.requestId,eventId:body.requestId};
  else{pending=0;accepted||={planId:id,previewDigest:digest,requestId:body.requestId,actorId:actor,cycleId:CYCLE,runId:RUN,sourceFence:7,result:{runStatus:badResult?'SUCCESS':'ERROR',cycleStatus:'ERROR',errorCode:'FUNDING_EXECUTION_EXPIRED',inboxState:'FAILED',inboxResult:'EXPIRED',executionState:'EXPIRED',outboxState:'PUBLISHED',source:{state:'QUIESCED',fence:7},targetsChanged:false,pendingRuns:0}};}
  if(lost&&posts.length===1)throw Object.assign(Error('lost response'),{uncertain:true});return{...accepted,replayed:replay};
 }};};
 return{loaded,installation,approval,openSession,clock:()=>now,requestId:request,stats:()=>({posts,sessions,closed,pending}),packageInfo:{packageDigest:plan.package.packageDigest,entry:{version:installation.installed.centralVersion,schemaFingerprint:installation.installed.centralFingerprint}}};
}
test('normal approval binds the exact preview and replays one durable approval with no source mutation',async()=>{
 const f=fixture(),r=await approvePrepared(f);assert.equal(r.actorId,actor);assert.equal(r.replayVerified,true);assert.equal(r.sourceUnchanged,true);assert.equal(f.stats().posts.length,2);assert.deepEqual(f.stats().posts[0],f.stats().posts[1]);assert(f.stats().posts.every(p=>p.url===base(id)+'/approve'));assert.equal(f.stats().closed,1);
});
test('execution closes only expired work and verifies replay while keeping the same quiescent epoch',async()=>{
 const f=fixture({operation:'execute'}),r=await executeApproved(f);assert.equal(r.execution.result.runStatus,'ERROR');assert.equal(r.source.fence,7);assert.equal(r.source.pendingRuns,0);assert.equal(r.newEnqueues,0);assert.equal(r.resumed,false);assert.equal(f.stats().posts.length,2);assert.deepEqual(f.stats().posts[0],f.stats().posts[1]);assert(f.stats().posts.every(p=>p.url===base(id)+'/execute'));
});
test('lost execution response cannot create a second intention or falsely report success before receipt validation',async()=>{
 const f=fixture({operation:'execute',lost:true}),r=await executeApproved(f);assert.equal(r.replayVerified,true);assert.equal(f.stats().posts.length,3);assert.equal(new Set(f.stats().posts.map(p=>p.body.requestId)).size,1);assert.equal(f.stats().sessions,2);
 const invalid=fixture({operation:'execute',badResult:true});await assert.rejects(()=>executeApproved(invalid),{code:'RECONCILIATION_RESULT_INVALID'});assert.equal(invalid.stats().posts.length,1);
});
test('expired plan after login or a different administrator cannot mutate',async()=>{
 const stale=fixture({slowLogin:true});await assert.rejects(()=>approvePrepared(stale),{code:'RECONCILIATION_PLAN_EXPIRED'});assert.equal(stale.stats().posts.length,0);
 const other=fixture({operation:'execute',wrongActor:true});await assert.rejects(()=>executeApproved(other),{code:'RECONCILIATION_ACTOR_CHANGED'});assert.equal(other.stats().posts.length,0);
});
test('installation and original approval bindings reject unreviewed configuration, package or actor drift',()=>{
 const f=fixture();assert.doesNotThrow(()=>validateInstallation(f.installation,f.loaded,f.approval,f.packageInfo));
 for(const change of [{healthRestored:false},{status:'PASS'},{packageDigest:'f'.repeat(64)},{source:{state:'ACTIVE',fence:7}},{configuration:{unchanged:false}},{approval:{...f.installation.approval,actorId:event}}])assert.throws(()=>validateInstallation({...f.installation,...change},f.loaded,f.approval,f.packageInfo));
 assert.throws(()=>validateInstallation(f.installation,f.loaded,{...f.approval,scope:'PREPARATION_ONLY'},f.packageInfo));
});
test('CLI names are limited to the fixed plan and installation artifact',()=>{
 assert.equal(approvalArgs(['--plan='+id]),id);assert.throws(()=>approvalArgs(['--plan='+id,'--resume']));
 const file='output/opportunity-eu-reconciliation-'+id+'/installation.json';assert.equal(executionArgs(['--execution='+file]),file);
 for(const value of ['--execution=../private.json','--execution='+file.replace('installation','window'),'--resume='+id])assert.throws(()=>executionArgs([value]));
});
