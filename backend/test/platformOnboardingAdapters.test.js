'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID,randomBytes}=require('node:crypto');
const {createKeycloakAdapter}=require('../src/platformOnboarding/keycloakAdapter'),{createEncryptedJournal}=require('../src/platformOnboarding/encryptedJournal');
const issuer='https://identity.example.invalid/realms/c4g';
const input=()=>({operationId:randomUUID(),organizationId:randomUUID(),globalUserId:randomUUID(),membershipId:randomUUID(),input:{adminEmail:'test@example.invalid',adminName:'Test',expectedSubject:null}});
function response(body,status=200){return {ok:status<400,status,headers:{get:()=>status===201?'0':null},json:async()=>body};}
test('Keycloak retries only its own account and never writes a password',async()=>{
 const x=input(),users=[],requests=[];const adapter=createKeycloakAdapter({issuer,accessToken:async()=>'test-token',ownershipKey:'x'.repeat(32),fetchImpl:async(url,options)=>{requests.push({url,...options});if(options.method==='POST'){const value=JSON.parse(options.body);assert.equal(value.credentials,undefined);assert.equal(value.emailVerified,false);users.push({...value,id:randomUUID()});return response(null,201);}return response(users);}});
 const a=await adapter.ensure(x),b=await adapter.ensure(x);assert.equal(a.subject,b.subject);assert.equal(requests.filter(r=>r.method==='POST').length,1);assert(requests.every(r=>r.signal));assert(requests.every(r=>r.redirect==='error'));
 users[0].attributes.c4g_onboarding_owner=['foreign'];await assert.rejects(()=>adapter.ensure(x),e=>e.code==='IDENTITY_RECONCILIATION_REQUIRED');assert.equal(requests.filter(r=>r.method==='POST').length,1);
});
test('unknown email collision cannot attach an account and existing subject receives no mutation',async()=>{
 const x=input();let writes=0;const adapter=createKeycloakAdapter({issuer,accessToken:async()=>'test-token',ownershipKey:'x'.repeat(32),fetchImpl:async(url,options)=>{if(options.method==='POST'){writes++;return response({},409);}return response(x.input.expectedSubject?{id:x.input.expectedSubject,enabled:true}:[]);}});
 await assert.rejects(()=>adapter.ensure(x),e=>e.code==='IDENTITY_RECONCILIATION_REQUIRED');assert.equal(writes,1);
 x.input.expectedSubject=randomUUID();const result=await adapter.ensure(x);assert.equal(result.mode,'EXISTING');assert.equal(writes,1);
});
test('Keycloak redirect transport failure stops identity lookup',async()=>{
 const x=input();let calls=0;
 const adapter=createKeycloakAdapter({issuer,accessToken:async()=>'synthetic-token',ownershipKey:'x'.repeat(32),fetchImpl:async(url,options)=>{
  calls++;assert.equal(new URL(url).origin,'https://identity.example.invalid');assert.equal(options.redirect,'error');throw Error('synthetic redirect rejected');
 }});
 await assert.rejects(()=>adapter.ensure(x));assert.equal(calls,1);
});
test('private journal survives new process instance and detects changed intention or tampering',async()=>{
 const prefix=path.join(os.tmpdir(),'c4g-onboarding-journal-'),directory=await fs.mkdtemp(prefix),key=randomBytes(32).toString('hex'),id=randomUUID(),password=randomBytes(32).toString('hex');
 try{
  const a=createEncryptedJournal({directory,key}),intent={organizationId:randomUUID()};assert.equal((await a.reserve(id,intent,()=>({password}))).password,password);
  const filename=path.join(directory,id+'.enc'),bytes=await fs.readFile(filename,'utf8');assert(!bytes.includes(password));
  const b=createEncryptedJournal({directory,key});assert.equal((await b.reserve(id,intent,()=>{throw Error('MUST_NOT_RECREATE');})).password,password);
  await assert.rejects(()=>b.reserve(id,{organizationId:randomUUID()},()=>({})),e=>e.code==='PROVISIONING_INTENT_CONFLICT');
  const damaged=JSON.parse(bytes);damaged.data=(damaged.data.startsWith('00')?'01':'00')+damaged.data.slice(2);await fs.writeFile(filename,JSON.stringify(damaged));await assert.rejects(()=>b.reserve(id,intent,()=>({})));
 }finally{assert(directory.startsWith(prefix));await fs.rm(directory,{recursive:true,force:true});}
});
