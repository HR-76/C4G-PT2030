'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {runControlledCycle,httpCommand,validateExecution,loadExecution}=require('../scripts/eu-writer-controlled-cycle.cjs');
const {ACTIONS,CONTROLLED_CYCLE}=require('../backend/src/opportunities/v2/euWriterWindowPlan');
const pkg=require('../backend/src/security/opportunityEuWriterMigrationPackage'),base=require('../backend/src/security/opportunityV2MigrationPackage');
const writer=require('../backend/src/fundingTenders/euWriter').euWriterConfiguration();
const A='/api/admin/opportunity-activation/sources/eu',F='/api/admin/integrations/funding-tenders',sha='a'.repeat(64);
function fixture(options={}){
 let time=Date.now(),sessions=0,postCount=0,logicalRuns=0,firstEnqueue=true,firstResume=true;const actorId=randomUUID(),runId=randomUUID(),windowId=randomUUID(),executionId=randomUUID(),calls=[],receipts=new Map();
 const plan={kind:'eu-writer-window-plan-v1',windowId,createdAt:new Date(time-1000).toISOString(),expiresAt:new Date(time+(options.shortExpiry?10000:1800000)).toISOString(),package:{packageId:pkg.PACKAGE_ID,packageDigest:pkg.packageDigest,sqlSha256:pkg.entry.upChecksum},baseline:{centralVersion:pkg.CENTRAL_BASELINE,tenantVersion:base.tenantAddition.version,centralFingerprint:base.centralEntries.at(-1).schemaFingerprint,tenantFingerprint:base.tenantAddition.schemaFingerprint},writer,source:{state:'QUIESCED',fence:3},expected:{opportunityId:randomUUID(),revisionId:randomUUID(),rowVersion:5},accepted:{contentDigest:sha,snapshotDigest:sha},evidence:Object.fromEntries(['preview','backup','validation'].map(k=>[k,{path:'output/unit/'+k+'.json',sha256:sha}])),inputs:{'scripts/eu-writer-controlled-cycle.cjs':sha},actions:[...ACTIONS],controlledCycle:{...CONTROLLED_CYCLE}};
 const execution={kind:'eu-writer-execution-window-v1',executionId,windowId,status:'INSTALLED_AWAITING_CONTROLLED_CYCLE',planDigest:require('../backend/src/opportunities/v2/euWriterWindowPlan').planDigest(plan),packageDigest:pkg.packageDigest,approval:{actorId,eventId:randomUUID(),eventHash:sha},installed:{centralVersion:pkg.entry.version,centralFingerprint:pkg.entry.schemaFingerprint,tenantVersion:base.tenantAddition.version,tenantFingerprint:base.tenantAddition.schemaFingerprint},source:{state:'QUIESCED',fence:3},healthRestored:true};
 let source={family:'EU_FUNDING_TENDERS',state:'QUIESCED',fence:3,activeLeases:0,pendingRuns:0,queuedRuns:0,otherPendingRuns:0,writerMode:'LEGACY_V1',writerPolicy:null,writerMappingDigest:null,canQuiesce:false,...(options.foreignInitial?{state:'ACTIVE',fence:9}:{})};
 let cycle=null;const health={ready:true,euWriterSupported:true,euWriterPolicyVersion:writer.policyVersion,euWriterMappingDigest:writer.mappingDigest,coverageSupported:true,refreshSupported:true,resolutionSupported:true,enrichmentSupported:true,discoveryDetailSupported:true};
 async function openSession(){sessions++;if(options.reauthFailsOnce&&sessions===2)throw Error('Login failed');if(options.slowLogin&&sessions===1)time+=20000;const authenticatedAt=time;return {authenticatedAt,close:async()=>{},async request(method,url,body){assert(time-authenticatedAt<240000,'never send with expired local authority');calls.push({method,url,body:body&&structuredClone(body),session:sessions});if(url==='/api/auth/session')return{user:{id:actorId,platformRoles:['C4G_ADMIN']}};
 if(method==='GET'&&url===A)return structuredClone(source);
 if(method==='GET'&&url===F){if(cycle&&!options.neverTerminal){cycle.status='SUCCESS';source.pendingRuns=0;source.queuedRuns=0;}if(cycle&&options.foreignAfterResume)source.fence=99;return{worker:health,runs:cycle?[structuredClone(cycle)]:[]};}
 if(url===F){postCount++;if(options.failEnqueue)throw Object.assign(Error('Denied'),{status:403,code:'FUNDING_FORBIDDEN'});if(!receipts.has(body.requestId)){logicalRuns++;cycle={runId,source:'EU_FUNDING_TENDERS',status:'RUNNING'};source.pendingRuns=1;receipts.set(body.requestId,cycle);}if(options.uncertainEnqueue&&firstEnqueue){firstEnqueue=false;throw Object.assign(Error('Timeout'),{uncertain:true});}return structuredClone(receipts.get(body.requestId));}
 if(url===A+'/resume'&&options.foreignResumeConflict){if(source.state==='QUIESCED'){source.state='ACTIVE';source.fence++;}if(options.uncertainResumeConflict&&firstResume){firstResume=false;throw Object.assign(Error('Timeout'),{uncertain:true});}throw Object.assign(Error('Other actor won the fence'),{status:409,code:'OPPORTUNITY_V2_SOURCE_FENCE_STALE'});}
 if(receipts.has(body.requestId))return {...structuredClone(receipts.get(body.requestId)),replayed:true};
 assert.equal(body.expectedFence,source.fence);const action=url.slice(A.length+1);if(options.failSuspend&&action==='suspend')throw Object.assign(Error('Denied'),{status:403,code:'FUNDING_FORBIDDEN'});
 source.fence++;if(action==='writer')Object.assign(source,{writerMode:'CANONICAL_V2',writerPolicy:writer.policyVersion,writerMappingDigest:writer.mappingDigest});if(action==='resume')source.state='ACTIVE';if(action==='suspend'){source.state='SUSPEND_REQUESTED';source.canQuiesce=true;}if(action==='quiesce')source.state='QUIESCED';receipts.set(body.requestId,structuredClone(source));return structuredClone(source);
 }};}
 return{plan,execution,openSession,clock:()=>time,wait:async ms=>{time+=ms;},calls,stats:()=>({sessions,postCount,logicalRuns,source})};
}
test('one normal EU cycle is followed by authenticated suspension and quiescence',async()=>{
 const f=fixture(),result=await runControlledCycle(f);assert.equal(result.status,'PASS');assert.equal(result.finalSuspensionVerified,true);assert.equal(result.finalSource.state,'QUIESCED');assert.equal(f.stats().logicalRuns,1);
 assert.deepEqual(f.calls.filter(c=>c.method==='POST').map(c=>c.url),[A+'/writer',A+'/resume',F,A+'/suspend',A+'/quiesce']);
});
test('failure after resume still suspends and preserves the failure instead of declaring success',async()=>{
 const f=fixture({failEnqueue:true}),r=await runControlledCycle(f);assert.equal(r.status,'FAIL');assert.equal(r.finalSuspensionVerified,true);assert.equal(f.stats().source.state,'QUIESCED');assert.equal(f.stats().postCount,1);
});
test('uncertain enqueue reconciles only the identical durable intention, never a second logical cycle',async()=>{
 const f=fixture({uncertainEnqueue:true}),r=await runControlledCycle(f);assert.equal(r.status,'PASS');assert.equal(f.stats().logicalRuns,1);const posts=f.calls.filter(c=>c.method==='POST'&&c.url===F);assert.equal(posts.length,2);assert.deepEqual(posts[0].body,posts[1].body);
});
test('300 second observation refreshes OIDC and cleanup survives plan expiry with pending work preserved',async()=>{
 const f=fixture({neverTerminal:true,shortExpiry:true}),r=await runControlledCycle(f);assert.equal(r.status,'PAUSED_FOR_REVIEW');assert.equal(r.stopReason,'OBSERVATION_WINDOW_ELAPSED');assert.equal(r.finalSuspensionVerified,true);assert.equal(r.finalSource.pendingRuns,1);assert(f.stats().sessions>=2);assert.equal(f.stats().logicalRuns,1);
});
test('reauthentication failure during observation still retries normal login for final suspension',async()=>{
 const f=fixture({neverTerminal:true,reauthFailsOnce:true}),r=await runControlledCycle(f);assert.equal(r.status,'FAIL');assert.equal(r.finalSuspensionVerified,true);assert(f.stats().sessions>=3);
});
test('failed suspension is explicit and cannot yield a successful cycle report',async()=>{
 const f=fixture({failSuspend:true}),r=await runControlledCycle(f);assert.equal(r.status,'FAIL');assert.equal(r.finalSuspensionVerified,false);assert(r.cleanupFailure);
});
test('a foreign initial active epoch is never suspended by the failed preparation',async()=>{
 const f=fixture({foreignInitial:true}),r=await runControlledCycle(f);assert.equal(r.status,'FAIL');assert.equal(r.finalSuspensionVerified,false);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);assert.equal(f.stats().source.fence,9);
});
test('cleanup does not mutate a newer external source epoch after this client resumed',async()=>{
 const f=fixture({foreignAfterResume:true}),r=await runControlledCycle(f);assert.equal(r.status,'FAIL');assert.equal(r.finalSuspensionVerified,false);assert.equal(f.calls.filter(c=>[A+'/suspend',A+'/quiesce'].includes(c.url)).length,0);assert.equal(f.stats().source.fence,99);
});
test('a 409 resume race never grants ownership merely because the competing actor used the expected next fence',async()=>{
 for(const uncertainResumeConflict of [false,true]){const f=fixture({foreignResumeConflict:true,uncertainResumeConflict}),r=await runControlledCycle(f);assert.equal(r.status,'FAIL');assert.equal(r.finalSuspensionVerified,false);assert.equal(f.calls.filter(c=>[A+'/suspend',A+'/quiesce',F].includes(c.url)&&c.method==='POST').length,0);assert.equal(f.stats().source.state,'ACTIVE');}
});
test('a response journal failure after acknowledged resume cannot discard ownership needed for suspension',async()=>{
 const f=fixture(),r=await runControlledCycle({...f,onProgress:async event=>{if(event.stage==='resume'&&event.status==='RESPONDED')throw Error('Journal unavailable');}});
 assert.equal(r.status,'FAIL');assert.equal(r.finalSuspensionVerified,true);assert.equal(f.stats().source.state,'QUIESCED');assert.equal(f.stats().postCount,0);
});
test('a plan that expires during normal login cannot configure, resume or enqueue',async()=>{
 const f=fixture({slowLogin:true,shortExpiry:true}),r=await runControlledCycle(f);assert.equal(r.status,'FAIL');assert.equal(r.finalSuspensionVerified,true);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
});
test('HTTP command scope excludes other sources, approval, direct acceptance and arbitrary bodies',()=>{
 assert.doesNotThrow(()=>httpCommand('POST',F,{requestId:randomUUID(),source:'EU_FUNDING_TENDERS'}));
 for(const [url,body]of [[F,{requestId:randomUUID(),source:'CORDIS'}],[A+'/resume',{requestId:randomUUID(),expectedFence:3,policy:'other'}],[A+'/accept',{requestId:randomUUID()}]])assert.throws(()=>httpCommand('POST',url,body));
 const f=fixture();assert.doesNotThrow(()=>validateExecution(f.execution,f.plan,f.clock()));assert.throws(()=>validateExecution({...f.execution,status:'PASS'},f.plan,f.clock()));
});
test('post-install loader permits only the exact runtime descriptor delta and binds the original approval',t=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto'),{hash}=require('../backend/src/opportunities/v2/activationArchive');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'eu-cycle-loader-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
 const write=(file,data)=>{const bytes=JSON.stringify(data);fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),bytes);return{path:file,sha256:digest(bytes)};};
 const f=fixture(),p=f.plan,e=f.execution,folder='output/opportunity-eu-writer-execution-'+e.executionId,relative=folder+'/window.json';
 const before={retained:{generation:'unchanged'}},descriptor={packageId:pkg.PACKAGE_ID,...writer},after={...before,opportunityEuWriter:descriptor},runtime='.tmp/local-platform/runtime.json';
 const old=write(runtime,before),current=write(runtime,after);p.inputs={[runtime]:old.sha256};
 for(const k of Object.keys(p.evidence))p.evidence[k]=write('output/unit/'+k+'.json',{fixture:k});
 e.plan=write('output/opportunity-eu-writer-window-'+p.windowId+'/plan.json',p);e.planDigest=require('../backend/src/opportunities/v2/euWriterWindowPlan').planDigest(p);
 const approval={kind:'eu-writer-window-authenticated-approval-v1',status:'PASS',windowId:p.windowId,planDigest:e.planDigest,result:{replayVerified:true,approval:{scope:'PREPARATION_ONLY',windowId:p.windowId,planDigest:e.planDigest,actorId:e.approval.actorId,eventId:e.approval.eventId,eventHash:e.approval.eventHash,expiresAt:p.expiresAt}}};
 e.approval={...e.approval,...write('output/unit/approval.json',approval)};
 e.config={runtimeBeforeSha256:old.sha256,runtimeAfterSha256:current.sha256,unchangedRuntimeDigest:hash(before),changedKeys:['opportunityEuWriter'],writerDescriptor:descriptor};write(relative,e);
 assert.equal(loadExecution(relative,root).execution.executionId,e.executionId);
 write(runtime,{...after,retained:{generation:'drift'}});assert.throws(()=>loadExecution(relative,root),{code:'CONTROLLED_CONFIGURATION_CHANGED'});write(runtime,after);
 approval.result.approval.eventHash='b'.repeat(64);e.approval.sha256=write('output/unit/approval.json',approval).sha256;write(relative,e);assert.throws(()=>loadExecution(relative,root),{code:'CONTROLLED_APPROVAL_BINDING_INVALID'});
});
