'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createRequire}=require('node:module');
const q=require('../src/platformOnboarding/memberSql');
const {createActivationEmail}=require('../src/platformOnboarding/activationEmail');

// Exercise the service with a transactional journal double, without external databases.
function fixture({configured=true,prepareEmail,deliveryHistory}={}){
 const id=randomUUID(),organizationId=randomUUID(),actorId=randomUUID();
 const row={id,organization_id:organizationId,global_user_id:randomUUID(),membership_id:randomUUID(),profile_code:'CONTRIBUTOR',phase:'READY',status:'WAITING',revision:1,input:{adminName:'Person',adminEmail:'person@example.invalid'},receipt:{subject:randomUUID(),mode:'CREATED'}};
 const invitations=[],sent=[];let authorized=true,outcome='ACCEPTED',writeFailure=false;
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
  else if(sql===q.emailDelivery){if(writeFailure)throw Error('WRITE_FAILED');row.receipt.activationEmail=JSON.parse(args[1]);}
  else throw Error('Unexpected SQL');
  return {rows};
 }};
 let writes=Promise.resolve();
 const coordinator={pool:client,withAuthority:fn=>fn(),write:(keys,fn)=>{
 const pending=writes.then(async()=>{
  const prior=structuredClone({row,invitations});
  try{return await fn(client);}catch(error){Object.assign(row,prior.row);invitations.splice(0,invitations.length,...prior.invitations);throw error;}
 });
 writes=pending.catch(()=>{});return pending;
 }};
 const filename=path.resolve(__dirname,'../src/platformOnboarding/memberService.js'),localRequire=createRequire(filename),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,require:name=>name==='../security/authorityCoordinator'?{isAuthorityCoordinator:value=>value===coordinator}:localRequire(name),structuredClone,Date,Buffer});
 const transport=createActivationEmail({key:'k'.repeat(32),apiKey:'test',from:'test@example.invalid',origin:'https://app.example.invalid'});
 const service=module.exports.createMemberOnboardingService({coordinator,prepareEmail,deliveryHistory,issuer:'https://identity.example.invalid',policyVersion:'test',assuranceRequirements:{},mfaPolicyCode:'test',dataResidencyCode:'test',identity:{ensure:async()=>{}},projection:{ensure:async()=>{}},verification:{verify:async()=>{}},audit:async()=>{},email:{secret:configured?transport.secret:async()=>null,send:async value=>{sent.push(value);return {status:outcome};}}});
 const request={sessionID:'session',authContext:{sessionId:'session'},user:{id:actorId},headers:{'x-c4g-organization':organizationId}};
 return {service,id,row,invitations,sent,request,setOutcome:value=>outcome=value,deny:()=>authorized=false,failWrite:()=>writeFailure=true};
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
 assert.equal(f.sent.length,2);
});

test('message and versions are pinned before sending, reused after failure, and renewed only on explicit resend',async()=>{
 let version=1;const scopes=[];
 const f=fixture({prepareEmail:async value=>{scopes.push(value);return {message:{subject:'Version '+version,html:'pinned HTML',text:'pinned text'},template:{source:'ORGANIZATION',version},logo:{url:'/logo-'+version}};}});
 f.setOutcome('UNCONFIRMED');
 const first=await f.service.prepare(f.id,f.request);
 assert.equal(scopes[0].organizationId,f.row.organization_id);
 assert.equal(first.emailDelivery.message,undefined);
 assert.equal((await f.service.get(f.id,f.request)).emailDelivery.message,undefined);
 assert.equal(JSON.stringify(f.row.receipt).includes(f.sent[0].secret),false);
 version=2;f.setOutcome('ACCEPTED');
 await f.service.prepare(f.id,f.request);
 assert.deepEqual(f.sent[0],f.sent[1]);assert.equal(scopes.length,1);
 await f.service.sendEmail(f.id,{requestId:randomUUID(),replace:true},f.request);
 assert.equal(scopes.length,2);assert.equal(f.sent[2].message.subject,'Version 2');
 assert.equal(f.row.receipt.activationEmail.previous[0].template.version,1);
 assert.equal(f.row.receipt.activationEmail.previous[0].logo.url,'/logo-1');
 assert.equal(f.row.receipt.activationEmail.previous[0].message,undefined);
});

test('a failed durable preparation never contacts the provider',async()=>{
 const f=fixture({prepareEmail:async()=>({message:{subject:'unsent'}})});
 f.failWrite();
 await assert.rejects(f.service.prepare(f.id,f.request),/WRITE_FAILED/);
 assert.equal(f.sent.length,0);assert.equal(f.row.receipt.activationEmail,undefined);
});

test('concurrent attempts resolve one snapshot under the operation write lock',async()=>{
 let resolutions=0;
 const f=fixture({prepareEmail:async()=>({message:{subject:'version '+(++resolutions),html:'same',text:'same'},template:{version:resolutions}})});
 f.setOutcome('UNCONFIRMED');
 await Promise.all([f.service.prepare(f.id,f.request),f.service.prepare(f.id,f.request)]);
 assert.equal(resolutions,1);assert.equal(f.invitations.length,1);
 assert.equal(f.sent.length,2);assert.deepEqual(f.sent[0],f.sent[1]);
});

test('legacy uncertain invitations retain the original provider payload',async()=>{
 const f=fixture({prepareEmail:async()=>{throw Error('Legacy invitations must not resolve a new payload');}});
 await f.service.issue(f.id,{requestId:f.id,replace:false},f.request,true);
 f.setOutcome('UNCONFIRMED');
 await f.service.prepare(f.id,f.request);
 await f.service.prepare(f.id,f.request);
 assert.equal(f.sent[1].message,undefined);assert.deepEqual(f.sent[0],f.sent[1]);
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


test('invitation history receives only the authorized scope and recipient, never activation secrets',async()=>{
 const records=[];
 const f=fixture({deliveryHistory:{async deliver(metadata,send){records.push(metadata);return send();}}});
 await f.service.prepare(f.id,f.request);
 assert.equal(records.length,1);
 assert.deepEqual(Object.keys(records[0]).sort(),['id','organizationId','recipient']);
 assert.equal(records[0].organizationId,f.row.organization_id);
 assert.equal(records[0].id,f.invitations[0].id);
 assert.equal(records[0].recipient,'person@example.invalid');
 assert.equal(JSON.stringify(records).includes(f.sent[0].secret),false);
 await f.service.prepare(f.id,f.request);
 assert.equal(records.length,1);
});

test('invitation history cannot be touched by a denied membership operation',async()=>{
 let records=0;
 const f=fixture({deliveryHistory:{async deliver(){records++;}}});
 f.deny();
 await assert.rejects(f.service.prepare(f.id,f.request));
 assert.equal(records,0);assert.equal(f.sent.length,0);
});

test('history preparation failure does not send an invitation',async()=>{
 const f=fixture({deliveryHistory:{async deliver(){throw Error('STORAGE_UNAVAILABLE');}}});
 const result=await f.service.prepare(f.id,f.request);
 assert.equal(result.emailDelivery.status,'UNCONFIRMED');assert.equal(f.sent.length,0);
});
