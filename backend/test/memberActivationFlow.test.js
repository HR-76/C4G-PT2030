'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createRequire}=require('node:module');
const q=require('../src/platformOnboarding/memberSql');
const {createActivationEmail}=require('../src/platformOnboarding/activationEmail');

// Exercise the service with a transactional journal double, without external databases.
function fixture({configured=true}={}){
 const id=randomUUID(),organizationId=randomUUID(),actorId=randomUUID();
 const row={id,organization_id:organizationId,global_user_id:randomUUID(),membership_id:randomUUID(),profile_code:'CONTRIBUTOR',phase:'READY',status:'WAITING',revision:1,input:{adminName:'Person',adminEmail:'person@example.invalid'},receipt:{subject:randomUUID(),mode:'CREATED'}};
 const invitations=[],sent=[];let authorized=true,outcome='ACCEPTED';
 const client={async query(sql,args){
  let rows=[];
  if(sql===q.operation)rows=[row];
  else if(sql===q.authorize)rows=authorized?[{profile:'ORG_ADMIN'}]:[];
  else if(sql===q.issueReplay)rows=invitations.filter(i=>i.request_key===args[1]);
  else if(sql===q.invite)rows=[...invitations];
  else if(sql===q.orgActive||sql===q.ready)rows=[{id:organizationId}];
  else if(sql===q.identity)rows=[{status:'ACTIVE'}];
  else if(sql===q.revoke){rows=invitations.filter(i=>i.status==='OPEN');rows.forEach(i=>i.status='REVOKED');}
  else if(sql===q.issue){const invitation={id:args[0],operation_id:args[1],request_key:args[2],issued_by:args[3],digest:args[4],replace_requested:args[5],status:'OPEN',revision:1,expires_at:new Date(Date.now()+86400000)};invitations.push(invitation);rows=[invitation];}
  else if(sql===q.emailDelivery)row.receipt.activationEmail=JSON.parse(args[1]);
  else throw Error('Unexpected SQL');
  return {rows};
 }};
 const coordinator={pool:client,withAuthority:fn=>fn(),write:async(keys,fn)=>{
  const prior=structuredClone({row,invitations});
  try{return await fn(client);}catch(error){Object.assign(row,prior.row);invitations.splice(0,invitations.length,...prior.invitations);throw error;}
 }};
 const filename=path.resolve(__dirname,'../src/platformOnboarding/memberService.js'),localRequire=createRequire(filename),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,require:name=>name==='../security/authorityCoordinator'?{isAuthorityCoordinator:value=>value===coordinator}:localRequire(name),structuredClone,Date,Buffer});
 const transport=createActivationEmail({key:'k'.repeat(32),apiKey:'test',from:'test@example.invalid',origin:'https://app.example.invalid'});
 const service=module.exports.createMemberOnboardingService({coordinator,issuer:'https://identity.example.invalid',policyVersion:'test',assuranceRequirements:{},mfaPolicyCode:'test',dataResidencyCode:'test',identity:{ensure:async()=>{}},projection:{ensure:async()=>{}},verification:{verify:async()=>{}},audit:async()=>{},email:{secret:configured?transport.secret:async()=>null,send:async value=>{sent.push(value);return {status:outcome};}}});
 const request={sessionID:'session',authContext:{sessionId:'session'},user:{id:actorId},headers:{'x-c4g-organization':organizationId}};
 return {service,id,row,invitations,sent,request,setOutcome:value=>outcome=value,deny:()=>authorized=false};
}
test('preparing a ready membership automatically emails once and persists acceptance',async()=>{
 const f=fixture(),result=await f.service.prepare(f.id,f.request);
 assert.equal(result.emailDelivery.status,'ACCEPTED');
 assert.equal(f.sent.length,1);
 assert.equal(f.sent[0].to,'person@example.invalid');
 assert.equal(f.row.phase,'READY');
 assert.equal(JSON.stringify(result).includes(f.sent[0].secret),false);
 await f.service.prepare(f.id,f.request);
 assert.equal(f.sent.length,1);
});
test('uncertain initial delivery resumes with the same invitation and secret',async()=>{
 const f=fixture();f.setOutcome('UNCONFIRMED');
 await f.service.prepare(f.id,f.request);
 f.setOutcome('ACCEPTED');await f.service.prepare(f.id,f.request);
 assert.equal(f.invitations.length,1);
 assert.deepEqual(f.sent[0],f.sent[1]);
});
test('explicit resend invalidates the old link and repeats safely with its request key',async()=>{
 const f=fixture();await f.service.prepare(f.id,f.request);
 const intention={requestId:randomUUID(),replace:true};
 await f.service.sendEmail(f.id,intention,f.request);
 await f.service.sendEmail(f.id,intention,f.request);
 assert.equal(f.invitations.length,2);
 assert.equal(f.invitations[0].status,'REVOKED');
 assert.notEqual(f.sent[0].secret,f.sent[1].secret);
 assert.deepEqual(f.sent[1],f.sent[2]);
});
test('revoked, expired, unauthorized and cross-organization requests cannot send',async()=>{
 const f=fixture();await f.service.prepare(f.id,f.request);
 const intention={requestId:f.id,replace:false};
 f.invitations[0].expires_at=new Date(0);
 await assert.rejects(f.service.sendEmail(f.id,intention,f.request),/ACTIVATION_INVALID/);
 f.invitations[0].status='REVOKED';
 await assert.rejects(f.service.sendEmail(f.id,intention,f.request),/ACTIVATION_INVALID/);
 await assert.rejects(f.service.sendEmail(f.id,intention,{...f.request,headers:{'x-c4g-organization':randomUUID()}}),/NOT_AUTHORIZED/);
 f.deny();await assert.rejects(f.service.sendEmail(f.id,intention,f.request),/NOT_AUTHORIZED/);
 assert.equal(f.sent.length,1);
});
test('missing email configuration leaves the prepared user pending without issuing a link',async()=>{
 const f=fixture({configured:false});
 const result=await f.service.prepare(f.id,f.request);
 assert.equal(result.emailDelivery.status,'NOT_CONFIGURED');
 assert.equal(f.row.phase,'READY');
 assert.equal(f.invitations.length,0);
 assert.equal(f.sent.length,0);
});
test('HTTP creation prepares the user and dispatches email before responding',async()=>{
 const routes=new Map(),calls=[];
 const router={get(){},post:(path,handler)=>routes.set(path,handler)};
 const service={create:async input=>{calls.push(input);return {id:'operation'};},prepare:async id=>{calls.push(id);return {id,phase:'READY',emailDelivery:{status:'ACCEPTED'}};}};
 require('../src/routes/memberOnboardingRoutes').createMemberRoutes({express:{Router:()=>router},service,resolveOrganization:()=> 'org'});
 let response;
 await routes.get('/')({method:'POST',body:{name:'Person'},query:{},params:{}},{set(){},json:value=>response=value,status(){throw Error('Unexpected HTTP error');}});
 assert.deepEqual(calls,[{name:'Person',organizationId:'org'},'operation']);
 assert.equal(response.emailDelivery.status,'ACCEPTED');
});
