'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createActivationEmail}=require('../src/platformOnboarding/activationEmail');
const options={key:'k'.repeat(32),apiKey:'test-only',from:'C4G <activation@example.invalid>',origin:'https://app.example.invalid'};
const {renderTemplate}=require('../src/emailTemplates/render');
const {defaultTemplate}=require('../src/emailTemplates/defaultTemplates');
const message=()=>renderTemplate(defaultTemplate('MEMBER_INVITATION'),{organizationName:'Entidade',expiresAt:'2030-01-15T12:00:00Z'});

test('configured messages reach the provider in HTML and text with the real activation link',async()=>{
 const sent=[];const email=createActivationEmail({...options,fetchImpl:async(url,request)=>{sent.push(JSON.parse(request.body));return {ok:true,json:async()=>({id:'accepted'})};}});
 const invitationId=randomUUID(),secret=await email.secret({invitationId});
 const value={invitationId,to:'person@example.invalid',secret,expiresAt:new Date(Date.now()+3600000),message:message()};
 assert.equal((await email.send(value)).status,'ACCEPTED');
 for(const part of ['html','text'])assert.ok(sent[0][part].includes('/api/activation#'+secret));
 assert.equal((await email.send({...value,message:{...value.message,text:'missing marker'}})).status,'UNCONFIRMED');
 assert.equal(sent.length,1);
});

test('test emails are marked and only contain the nonfunctional example link',async()=>{
 let sent;const email=createActivationEmail({...options,fetchImpl:async(url,request)=>{sent=JSON.parse(request.body);return {ok:true,json:async()=>({id:'accepted'})};}});
 assert.equal((await email.test({to:'admin@example.invalid',message:message(),idempotencyKey:randomUUID()})).status,'ACCEPTED');
 assert.match(sent.subject,/^\[TESTE\]/);
 for(const part of ['html','text']){assert.match(sent[part],/TESTE/);assert.match(sent[part],/https:\/\/exemplo.invalid\/ativacao-de-exemplo/);assert.doesNotMatch(sent[part],/api\/activation#/);}
});
test('activation retries preserve token, message and provider idempotency key',async()=>{
 const calls=[];
 const email=createActivationEmail({...options,fetchImpl:async(url,request)=>{calls.push({url,...request});return {ok:true,json:async()=>({id:'accepted'})};}});
 const invitationId=randomUUID(),secret=await email.secret({invitationId});
 assert.equal(secret,await createActivationEmail(options).secret({invitationId}));
 assert.notEqual(secret,await email.secret({invitationId:randomUUID()}));
 const value={invitationId,secret,to:'person@example.invalid',expiresAt:new Date(Date.now()+3600000).toISOString()};
 assert.equal((await email.send(value)).status,'ACCEPTED');
 await email.send(value);
 assert.equal(calls[0].body,calls[1].body);
 assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);
 assert.match(JSON.parse(calls[0].body).text,new RegExp('/api/activation#'+secret));
 assert.equal(calls[0].url,'https://api.resend.com/emails');
 assert.equal(calls[0].redirect,'error');
});
test('disabled, expired and failed email never report success',async()=>{
 let calls=0;
 const email=createActivationEmail({...options,fetchImpl:async()=>{calls++;throw Error('private provider detail');}});
 const invitationId=randomUUID(),secret=await email.secret({invitationId});
 const value={invitationId,secret,to:'person@example.invalid',expiresAt:new Date(Date.now()+3600000)};
 assert.deepEqual(await email.send(value),{status:'UNCONFIRMED'});
 assert.deepEqual(await email.send({...value,expiresAt:new Date(0)}),{status:'EXPIRED'});
 assert.equal(calls,1);
 const disabled=createActivationEmail({...options,apiKey:''});
 assert.equal(await disabled.secret({invitationId}),null);
 assert.deepEqual(await disabled.send(value),{status:'NOT_CONFIGURED'});
});
test('activation origin cannot contain credentials, path or an insecure protocol',async()=>{
 for(const origin of ['http://app.example.invalid','https://user:password@app.example.invalid','https://app.example.invalid/path']){
  assert.equal(await createActivationEmail({...options,origin}).secret({invitationId:randomUUID()}),null);
 }
});
test('provider redirect failure remains unconfirmed without a second request',async()=>{
 let calls=0;const email=createActivationEmail({...options,fetchImpl:async(url,config)=>{calls++;assert.equal(url,'https://api.resend.com/emails');assert.equal(config.redirect,'error');throw Error('synthetic redirect rejected')}});
 const invitationId=randomUUID(),secret=await email.secret({invitationId});
 assert.deepEqual(await email.send({invitationId,secret,to:'person@example.invalid',expiresAt:new Date(Date.now()+3600000)}),{status:'UNCONFIRMED'});
 assert.equal(calls,1);
});
