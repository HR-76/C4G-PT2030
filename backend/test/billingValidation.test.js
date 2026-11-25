 'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createBillingValidationService}=require('../src/billingValidation/service');
const {mountValidationRoutes}=require('../src/billingValidation/http');
const {createValidationWorker,createValidationTransport}=require('../src/billingValidation/worker');
const org=randomUUID(),actor=randomUUID(),version=randomUUID(),requestId=randomUUID();
const request={sessionID:'session',authContext:{sessionId:'session'},user:{id:actor}};
function harness(query=async()=>({rows:[{result:{status:'PENDING'}}]})) {
 const calls=[];let authorizations=0;
 return {calls,get authorizations(){return authorizations},service:createBillingValidationService({pool:{query:async(...args)=>{calls.push(args);return query(...args)}},customerService:{execute:async()=>{authorizations++;return {organizationId:org}}}})};
}
test('validation reads customer organization from authenticated context and revalidates',async()=>{
 const h=harness();await h.service.read(request,randomUUID());assert.equal(h.authorizations,2);assert.deepEqual(h.calls[0][1],['session',actor,org,false]);
});
test('validation refuses mismatched session and extra client fields before SQL',async()=>{
 const h=harness();await assert.rejects(()=>h.service.read({...request,sessionID:'other'},org,true),{code:'NOT_AUTHORIZED'});
 await assert.rejects(()=>h.service.request(request,org,{versionId:version,requestKey:randomUUID(),organizationId:org}),{code:'INVALID_INPUT'});
 await assert.rejects(()=>h.service.confirm(request,{versionId:version,requestId,actorId:actor}),{code:'INVALID_INPUT'});assert.equal(h.calls.length,0);
});
test('confirmation passes both displayed version and request to the scoped SQL boundary',async()=>{
 const h=harness(async()=>({rows:[{result:requestId}]}));assert.deepEqual(await h.service.confirm(request,{versionId:version,requestId}),{requestId});assert.deepEqual(h.calls[0][1],['session',actor,org,requestId,version]);
});
test('validation maps SQL denials without exposing SQL text',async()=>{
 for(const code of ['STALE_REVISION','NOT_AUTHORIZED','BILLING_VALIDATION_NO_RECIPIENT']){const h=harness(async()=>{throw Error(code)});await assert.rejects(()=>h.service.request(request,org,{versionId:version,requestKey:randomUUID()}),{code})}
});
test('validation HTTP keeps disabled capability explicit and refuses writes',async()=>{
 const routes={};mountValidationRoutes({get:(path,fn)=>{routes.get=fn},post:(path,fn)=>{routes.post=fn}},{service:null});
 let status=200,body;const res={status(n){status=n;return this},json(value){body=value;return this}};
 await routes.get({query:{}},res);assert.deepEqual(body,{enabled:false});
 await routes.post({query:{},body:{}},res);assert.equal(status,503);
});
test('validation HTTP maps conflict and never accepts query parameters on a command',async()=>{
 let called=false;const routes={};mountValidationRoutes({get(){},post:(path,fn)=>{routes.post=fn}},{service:{confirm:async()=>{called=true;throw Object.assign(Error(),{code:'STALE_REVISION'})}}});
 let status;const res={status(n){status=n;return this},json(){return this}};
 await routes.post({query:{organizationId:org},body:{}},res);assert.equal(status,400);assert.equal(called,false);
 await routes.post({query:{},body:{}},res);assert.equal(status,409);
});
test('email transport uses a fixed authenticated link, stable idempotency and no billing fields',async()=>{
 const calls=[];const send=createValidationTransport({apiKey:'synthetic',from:'c4g@example.invalid',origin:'https://c4g.example.invalid',fetchImpl:async(...args)=>{calls.push(args);return {ok:true,json:async()=>({id:'accepted'})}}});
 const delivery={id:randomUUID(),organizationId:org,organizationName:'Entidade',to:'admin@example.invalid',notes:'INTERNAL',taxIdentifier:'SECRET'};
 assert.equal(await send(delivery),true);await send(delivery);
 assert.equal(calls[0][1].headers['Idempotency-Key'],calls[1][1].headers['Idempotency-Key']);
 const body=JSON.parse(calls[0][1].body);assert.ok(body.text.includes('/faturacao?validarEntidade='+org));assert.ok(!body.text.includes('INTERNAL'));assert.ok(!body.text.includes('SECRET'));
 assert.equal(calls[0][1].redirect,'error');
});
test('transport refuses unsafe origins and treats provider ambiguity as retryable',async()=>{
 for(const origin of ['http://example.invalid','https://example.invalid/path','https://u:p@example.invalid'])assert.throws(()=>createValidationTransport({apiKey:'x',from:'x',origin}));
 const send=createValidationTransport({apiKey:'x',from:'c4g@example.invalid',origin:'https://example.invalid',fetchImpl:async()=>{throw Error('timeout')}});
 assert.equal(await send({id:randomUUID(),organizationId:org,organizationName:'Test',to:'admin@example.invalid'}),false);
});
test('worker records accepted versus uncertain sends with the leased identity',async()=>{
 for(const accepted of [true,false]){
  const delivery={id:randomUUID(),token:randomUUID()};const calls=[];
  const worker=createValidationWorker({pool:{query:async(sql,params)=>{calls.push([sql,params]);return {rows:[{delivery}]}}},send:async()=>accepted});
  assert.equal(await worker.tick(),true);assert.deepEqual(calls[1][1],[delivery.id,delivery.token,accepted]);
 }
});
test('worker never sends cancelled or absent deliveries',async()=>{
 for(const delivery of [null,{skipped:true}]){let sent=0;const worker=createValidationWorker({pool:{query:async()=>({rows:[{delivery}]})},send:async()=>{sent++;return true}});await worker.tick();assert.equal(sent,0)}
});

test('Central 054 is explicit, checksum-pinned, and follows 053 without changing old entrypoints',()=>{
 const migration=require('../src/security/centralMigrationManifest');
 const pack=require('../src/security/billingValidationMigrationPackage');
 assert.equal(migration.knownManifest.at(-1).version,'051_email_templates');
 assert.equal(migration.opportunityComplementManifest.at(-1).version,'053_opportunity_complement');
 assert.equal(migration.billingValidationManifest.at(-1).version,pack.entry.version);
 assert.equal(migration.supportsCentralVersion(pack.entry.version,'053_opportunity_complement'),true);
 assert.equal(migration.migrationSql(pack.entry.version,'up').checksum,pack.entry.upChecksum);
});
