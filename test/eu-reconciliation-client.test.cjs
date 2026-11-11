'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {base,SOURCE,httpCommand,routeDecision,createSessionClient}=require('../scripts/lib/eu-reconciliation-browser.cjs');
const planId='01900000-0000-7000-8000-000000000001',actorId='01900000-0000-7000-8000-000000000002',requestId='01900000-0000-7000-8000-000000000003';
const input={requestId,previewDigest:'a'.repeat(64)},execution={...input,approvalEventId:actorId,approvalEventHash:'b'.repeat(64)};
test('reconciliation client excludes resume, enqueue, alternate plans and caller authority',()=>{
 for(const operation of ['approve','execute']){
  const scope={planId,operation},body=operation==='approve'?input:execution;
  assert.doesNotThrow(()=>httpCommand(scope,'GET',base(planId)));
  assert.doesNotThrow(()=>httpCommand(scope,'POST',base(planId)+'/'+operation,body));
  for(const route of [SOURCE+'/resume',SOURCE+'/suspend',SOURCE+'/writer','/api/admin/integrations/funding-tenders',base(actorId)+'/'+operation])assert.throws(()=>httpCommand(scope,'POST',route,body));
  assert.throws(()=>httpCommand(scope,'POST',base(planId)+'/'+operation,{...body,actorId}));
 }
});
test('inert browser document is fulfilled locally and cannot run application mutations or leave trusted origins',()=>{
 const inert='http://localhost:3000/__codex/eu-reconciliation-session';
 assert.equal(routeDecision('GET',inert),'INERT');assert.equal(routeDecision('POST',inert),'ABORT');
 assert.equal(routeDecision('POST','http://localhost:3000'+SOURCE+'/resume'),'ABORT');
 assert.equal(routeDecision('GET','https://attacker.invalid/'),'ABORT');
 assert.equal(routeDecision('POST','https://localhost:8443/realms/c4g-native-local/login-actions/authenticate'),'CONTINUE');
 assert.equal(routeDecision('POST','https://localhost:8443/admin/realms'),'ABORT');
 const permitted=base(planId)+'/execute';assert.equal(routeDecision('POST','http://localhost:3000'+permitted,permitted),'CONTINUE');
 assert.equal(routeDecision('POST','http://localhost:3000'+permitted+'/extra',permitted),'ABORT');
});
test('uncertain mutation reauthenticates and repeats the same intention once, never creates a second ID',async()=>{
 let opens=0,closed=0,posts=[];const client=createSessionClient({planId,operation:'approve',clock:()=>10,openSession:async()=>{
  const index=++opens;return{authenticatedAt:0,close:async()=>{closed++;},request:async(method,url,body)=>{if(method==='GET')return{user:{id:actorId,platformRoles:['C4G_ADMIN']}};posts.push(body);if(index===1)throw Object.assign(Error('response lost'),{uncertain:true});return{eventId:requestId};}};
 }});
 assert.deepEqual(await client.mutate(input),{eventId:requestId});await client.close();assert.equal(opens,2);assert.equal(closed,2);assert.equal(posts.length,2);assert.strictEqual(posts[0],input);assert.strictEqual(posts[1],input);
});
test('authority identity and current plan are rechecked after reauthentication before any new POST',async()=>{
 let now=0,opens=0,posts=0;const client=createSessionClient({planId,operation:'execute',expectedActorId:actorId,clock:()=>now,openSession:async()=>({authenticatedAt:now,close:async()=>{},request:async method=>{if(method==='GET')return{user:{id:++opens===1?actorId:requestId,platformRoles:['C4G_ADMIN']}};posts++;return{};}})});
 await client.request('GET',SOURCE);now=180000;await assert.rejects(()=>client.mutate(execution),{code:'RECONCILIATION_ACTOR_CHANGED'});assert.equal(posts,0);await client.close();
 const other=createSessionClient({planId,operation:'approve',clock:()=>10,openSession:async()=>({authenticatedAt:0,close:async()=>{},request:async method=>{if(method==='GET')return{user:{id:actorId,platformRoles:['C4G_ADMIN']}};posts++;return{};}})});
 await assert.rejects(()=>other.mutate(input,{assertCurrent:()=>{throw Error('plan expired');}}),/plan expired/);assert.equal(posts,0);await other.close();
});
test('journal failure before the intention and definite HTTP refusal do not trigger a write retry',async()=>{
 let posts=0;const openSession=async()=>({authenticatedAt:0,close:async()=>{},request:async method=>{if(method==='GET')return{user:{id:actorId,platformRoles:['C4G_ADMIN']}};posts++;throw Object.assign(Error('conflict'),{status:409});}});
 const noJournal=createSessionClient({planId,operation:'approve',clock:()=>1,openSession,onProgress:async()=>{throw Error('journal unavailable');}});
 await assert.rejects(()=>noJournal.mutate(input),/journal unavailable/);assert.equal(posts,0);await noJournal.close();
 const conflict=createSessionClient({planId,operation:'approve',clock:()=>1,openSession});await assert.rejects(()=>conflict.mutate(input),/conflict/);assert.equal(posts,1);await conflict.close();
});
