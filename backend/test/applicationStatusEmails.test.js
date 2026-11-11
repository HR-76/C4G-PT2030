"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {event,payload}=require('../src/applications/statusEmails/contracts');
const {selectRecipients}=require('../src/applications/statusEmails/recipients');
const {render}=require('../src/applications/statusEmails/template');
const {createTransport}=require('../src/applications/statusEmails/transport');
const {createResendDouble}=require('./support/doubles');
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const base={organizationId:uuid(1),applicationId:uuid(2),revision:2,actorUserId:uuid(3),actorEmail:'author@example.org',occurredAt:'2026-11-02T12:00:00.000Z',organizationName:'Organização',title:'Projeto',fromStatus:'PREPARATION',toStatus:'SUBMITTED',candidateMembershipIds:[uuid(4),uuid(5)]};
const now=()=>new Date(base.occurredAt);
const resolved=membershipId=>({status:'RESOLVED',organizationId:uuid(1),applicationId:uuid(2),membershipId,userId:uuid(6),email:'team@example.org',organizationActive:true,userActive:true,membershipActive:true,validFrom:'2026-01-01T00:00:00Z',validUntil:null,isResponsible:true,isActiveParticipant:true,canReadApplication:true,canReadOpportunity:true,requiresEvaluation:true,canReadEvaluation:true});
const select=(override={})=>selectRecipients(base,{now,resolve:async({membershipId})=>({...resolved(membershipId),...override})});
test('closed event and queue contracts reject unrelated or personal payloads',()=>{
 assert.throws(()=>event({...base,notes:'private'}));assert.throws(()=>event({...base,toStatus:base.fromStatus}));
 assert.throws(()=>event({...base,title:'x\r\nBcc: x'}));assert.throws(()=>event({...base,occurredAt:'2026-02-30T12:00:00.000Z'}));
 assert.throws(()=>payload({deliveryId:uuid(1),email:'private@example.org'}));assert.deepEqual(payload({deliveryId:uuid(1)}),{deliveryId:uuid(1)});
 assert.equal(event({...base,candidateMembershipIds:[uuid(4),uuid(4)]}).candidateMembershipIds.length,1);
});
test('responsible/participant and normalized addresses are deduplicated',async()=>{
 const r=await select({email:' TEAM@EXAMPLE.ORG '});assert.equal(r.status,'READY');assert.equal(r.recipients.length,1);assert.equal(r.recipients[0].email,'team@example.org');assert.equal(r.decisions[0].reason,'DUPLICATE_ADDRESS');
});
for(const [field,value] of Object.entries({organizationId:uuid(9),applicationId:uuid(9),membershipId:uuid(9),organizationActive:false,userActive:false,membershipActive:false,canReadApplication:false,canReadOpportunity:false,canReadEvaluation:false,validFrom:'2027-01-01',validUntil:base.occurredAt,requiresEvaluation:undefined})){
 test(`fails closed: ${field}`,async()=>assert.equal((await select({[field]:value})).recipients.length,0));
}
test('admins, partners and new members are not added by privilege',async()=>{
 assert.equal((await select({isResponsible:false,isActiveParticipant:false,role:'ADMIN'})).recipients.length,0);
 const calls=[];await selectRecipients(base,{now,resolve:async({membershipId})=>{calls.push(membershipId);return resolved(membershipId);}});assert.deepEqual(calls,base.candidateMembershipIds);
});
test('author excluded by identity and normalized address; missing address recorded',async()=>{
 for(const override of [{userId:base.actorUserId},{email:' AUTHOR@example.org '}])assert.equal((await select(override)).decisions[0].reason,'AUTHOR');
 assert.equal((await select({email:null})).decisions[0].reason,'NO_ADDRESS');
});
test('authority outage prevents partial selection and access is rechecked each time',async()=>{
 let active=true;const resolve=async({membershipId})=>({...resolved(membershipId),membershipActive:active});
 assert.equal((await selectRecipients(base,{now,resolve})).recipients.length,1);active=false;assert.equal((await selectRecipients(base,{now,resolve})).recipients.length,0);
 const result=await selectRecipients(base,{now,resolve:async({membershipId})=>{if(membershipId===uuid(5))throw Error('sensitive');return resolved(membershipId);}});
 assert.equal(result.status,'UNAVAILABLE');assert.deepEqual(result.recipients,[]);assert.ok(!JSON.stringify(result).includes('sensitive'));
});
test('same address in different organizations remains independent',async()=>{
 const other={...base,organizationId:uuid(8)};
 assert.equal((await selectRecipients(other,{now,resolve:async({membershipId})=>({...resolved(membershipId),organizationId:uuid(8)})})).recipients.length,1);
 assert.equal((await select()).recipients.length,1);
});
test('template escapes HTML, uses historical state and trusted context link',()=>{
 const result=render({...base,title:'<script>alert("x")</script>'},{publicOrigin:'https://app.example.org'});
 assert.ok(!result.html.includes('<script>'));assert.ok(result.html.includes('&lt;script&gt;'));assert.ok(result.text.includes('Em preparação → Submetida'));assert.ok(result.text.includes('Europe/Lisbon'));assert.ok(result.text.includes(`organizacao=${uuid(1)}`));assert.ok(!result.text.includes(base.actorEmail));
 for(const publicOrigin of ['javascript:alert(1)','https://u:p@example.org','https://example.org/evil','https://example.org?redirect=x'])assert.throws(()=>render(base,{publicOrigin}));
});
const msg={to:'team@example.org',subject:'Estado',html:'<p>Estado</p>',text:'Estado'};
test('disabled default and real mode cannot invoke a provider',async()=>{
 const provider=createResendDouble();const transport=createTransport();assert.equal((await transport.send(msg,'k')).status,'DISABLED');assert.equal(provider.calls.length,0);
 assert.throws(()=>createTransport({mode:'real'}));assert.throws(()=>createTransport({mode:'simulated'}));
});
test('simulated lost response, duplicate, changed request and 24h expiry',async()=>{
 let time=0;const t=createTransport({mode:'simulated',isolated:true,now:()=>time,outcome:()=> 'TIMEOUT_AFTER_ACCEPTANCE'});
 assert.equal((await t.send(msg,'k')).status,'UNKNOWN');assert.equal((await t.send(msg,'k')).status,'ACCEPTED');assert.equal(t.stats().accepted,1);
 assert.equal((await t.send({...msg,text:'changed'},'k')).reason,'IDEMPOTENCY_CONFLICT');time=86400000;
 assert.equal((await t.send(msg,'k')).reason,'RECONCILIATION_REQUIRED');assert.equal(t.stats().accepted,1);
});
for(const outcome of ['RETRYABLE_NOT_ACCEPTED','PERMANENT_REJECTED','UNKNOWN'])test(`simulated ${outcome}`,async()=>{
 const t=createTransport({mode:'simulated',isolated:true,outcome:()=>outcome});assert.equal((await t.send(msg,'k')).status,outcome);assert.equal(t.stats().accepted,0);
});
test('simulated cancellation, concurrent duplicates and independent keys',async()=>{
 const t=createTransport({mode:'simulated',isolated:true});const controller=new AbortController();controller.abort();
 assert.equal((await t.send(msg,'k',controller.signal)).status,'RETRYABLE_NOT_ACCEPTED');assert.equal(t.stats().calls,0);
 await Promise.all([t.send(msg,'k'),t.send(msg,'k')]);assert.equal(t.stats().accepted,1);await t.send(msg,'other-org');assert.equal(t.stats().accepted,2);
});
test('existing Resend double drives simulation scenarios without network',async()=>{
 const provider=createResendDouble({sendEmail:()=>({status:'UNKNOWN'})});
 const scenario=await provider.sendEmail(msg);
 const transport=createTransport({mode:'simulated',isolated:true,outcome:()=>scenario.status});
 assert.equal((await transport.send(msg,'double-scenario')).status,'UNKNOWN');assert.equal(transport.stats().accepted,0);assert.equal(provider.calls.length,1);
});

test('local composition selects, renders and simulates one individual message',async()=>{
 const selection=await select();const template=render(base,{publicOrigin:'https://app.example.org'});
 const transport=createTransport({mode:'simulated',isolated:true});
 for(const recipient of selection.recipients){
  const result=await transport.send({to:recipient.email,subject:template.subject,html:template.html,text:template.text},`${base.organizationId}/${base.applicationId}/${base.revision}/${recipient.membershipId}`);
  assert.equal(result.status,'ACCEPTED');assert.equal(result.simulated,true);
 }
 assert.equal(transport.stats().accepted,1);
});

test('active team member need not be responsible; optional evaluation does not require extra grant',async()=>{
 const r=await select({isResponsible:false,isActiveParticipant:true,requiresEvaluation:false,canReadEvaluation:false});assert.equal(r.recipients.length,1);
});
test('unavailable and malformed authority answers do not authorize delivery',async()=>{
 for(const answer of [null,{status:'UNAVAILABLE'},{status:'UNKNOWN'},{...resolved(uuid(4)),userId:'invalid'}]){
  const r=await selectRecipients(base,{now,resolve:async()=>answer});assert.equal(r.status,'UNAVAILABLE');assert.equal(r.recipients.length,0);
 }
});
