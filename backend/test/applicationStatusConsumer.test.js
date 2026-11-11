'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSimulatedConsumer}=require('../src/applications/statusEmails/consumer');
const {createRecipientAuthority}=require('../src/applications/statusEmails/recipientAuthority');
const {createTransport}=require('../src/applications/statusEmails/transport');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
 const snapshot={organizationId:id(1),applicationId:id(2),revision:2,actorUserId:id(3),actorEmail:'author@example.org',occurredAt:'2026-11-02T12:00:00.000Z',organizationName:'Org',title:'Title',fromStatus:'INTENTION',toStatus:'PREPARATION',candidateMembershipIds:[id(4)]};
 const record={snapshot,membershipId:id(4),state:'PENDING',attempted:false};let resolutions=0;
 const person={status:'RESOLVED',organizationId:id(1),applicationId:id(2),membershipId:id(4),userId:id(5),email:'member@example.org',organizationActive:true,userActive:true,membershipActive:true,validFrom:'2020-01-01',validUntil:null,isResponsible:false,isActiveParticipant:true,canReadApplication:true,canReadOpportunity:true,requiresEvaluation:true,canReadEvaluation:true};
 const store={load:async()=>record,skip:async()=>{record.state='SKIPPED'},reserve:async(o,d,message)=>({status:'RESERVED',fence:1,message}),finish:async(o,d,f,state)=>{record.state=state;record.attempted=true;return true}};
 const transport=createTransport({mode:'simulated',isolated:true});
 const options={isolated:true,organizationId:id(1),store,transport,publicOrigin:'https://app.example.org',resolve:async()=>{resolutions++;return person}};
 const job={organizationId:id(1),jobType:'application.status.notify',jobVersion:1,payloadVersion:1,operation:'application.status.notify',actor:{kind:'SERVICE',serviceActorCode:'APPLICATION_STATUS_NOTIFY'},payload:{deliveryId:id(6)}};
 return {options,record,person,job,transport,resolutions:()=>resolutions};
}
test('real/unbranded transport and unscoped consumer rejected',()=>{const f=fixture();assert.throws(()=>createSimulatedConsumer({...f.options,isolated:false}));assert.throws(()=>createSimulatedConsumer({...f.options,transport:{mode:'simulated',send:async()=>{}}}));});
test('exact handler versions and organization fail before loading data',async()=>{const f=fixture();f.options.store.load=()=>assert.fail();const c=createSimulatedConsumer(f.options);for(const change of [{organizationId:id(8)},{jobVersion:0},{payloadVersion:0},{actor:{kind:'HUMAN'}}])assert.equal((await c.handler({...f.job,...change})).code,'AUTHORIZATION_REVOKED');});
test('revalidates twice and duplicate accepted job never sends again',async()=>{const f=fixture(),c=createSimulatedConsumer(f.options);assert.equal((await c.handler(f.job)).code,'SUCCESS');assert.equal(f.resolutions(),2);await c.handler(f.job);assert.equal(f.transport.stats().accepted,1);});
for(const permission of ['canReadApplication','canReadOpportunity','canReadEvaluation','membershipActive','isActiveParticipant'])test('revocation '+permission+' prevents simulated send',async()=>{const f=fixture();f.person[permission]=false;await createSimulatedConsumer(f.options).handler(f.job);assert.equal(f.transport.stats().calls,0);assert.equal(f.record.state,'SKIPPED');});
test('authority failure delays without a skip or send',async()=>{const f=fixture();f.options.resolve=async()=>{throw Error('offline')};assert.equal((await createSimulatedConsumer(f.options).handler(f.job)).code,'RETRYABLE');assert.equal(f.record.state,'PENDING');assert.equal(f.transport.stats().calls,0);});
test('revocation between reservation and send blocks effect',async()=>{const f=fixture();let calls=0;f.options.resolve=async()=>({...f.person,canReadApplication:++calls===1});assert.equal((await createSimulatedConsumer(f.options).handler(f.job)).code,'RETRYABLE');assert.equal(f.transport.stats().calls,0);});
test('uncertain delivery with revoked access is held, not silently skipped',async()=>{const f=fixture();f.record.attempted=true;f.record.state='UNKNOWN';f.person.canReadApplication=false;assert.equal((await createSimulatedConsumer(f.options).handler(f.job)).detailCode,'RECONCILIATION_REQUIRED');assert.equal(f.record.state,'UNKNOWN');assert.equal(f.transport.stats().calls,0);});
test('changed destination or expired idempotency hold never invokes transport',async()=>{const f=fixture();f.options.store.reserve=async()=>({status:'HOLD'});assert.equal((await createSimulatedConsumer(f.options).handler(f.job)).detailCode,'RECONCILIATION_REQUIRED');assert.equal(f.transport.stats().calls,0);});
test('recipient authority uses recipient identity for every dependency, not author',async()=>{
 const calls=[];const resolve=createRecipientAuthority({identity:async()=>({organizationId:id(1),membershipId:id(4),userId:id(5)}),application:async()=>({organizationId:id(1),applicationId:id(2),responsibleMembershipId:id(4),opportunityId:id(7),evaluationId:id(8)}),authorize:async input=>{calls.push(input);return input.operationCode==='OPPORTUNITY_READ'?'DENY':'ALLOW'}});
 const result=await resolve({organizationId:id(1),applicationId:id(2),membershipId:id(4)});assert.equal(result.canReadOpportunity,false);assert.equal(calls.length,3);for(const call of calls)assert.deepEqual(call.subject,{organizationId:id(1),membershipId:id(4),userId:id(5)});
});

test('IPC simulation bridge cannot be enabled outside an isolated child process',()=>{
 const {createIpcSimulationTransport}=require('../src/applications/statusEmails/transport');
 assert.throws(()=>createIpcSimulationTransport());
 if(typeof process.send!=='function')assert.throws(()=>createIpcSimulationTransport({isolated:true}));
});
