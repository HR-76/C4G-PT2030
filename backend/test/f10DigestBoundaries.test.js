'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {OutboxRepository}=require('../src/async/outboxRepository');
const {InboxRepository}=require('../src/async/inboxRepository');
const {createEnvelope,createEnvelopeV2,createTrustedObservability}=require('../src/async/envelope');

const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const trustedContext={organizationId:ids[0],actor:{kind:'SERVICE',serviceActorCode:'SYNTHETIC_WORKER'},operation:'synthetic_resource.update',correlationId:ids[1],causationId:ids[2]};
const job={type:'synthetic_resource.update',version:1,payloadVersion:1,idempotencyKey:'stable-key'};
const registry={supports:()=>true};const clock=()=>new Date('2026-01-01T00:00:00Z');const id=()=>ids[0];
function v1(payload={value:1}){return createEnvelope({trustedContext,job,payload,registry,clock,id});}
function v2(traceparent){return createEnvelopeV2({trustedContext,job,payload:{value:1},registry,clock,id,observability:createTrustedObservability({traceparent,tracestate:null})});}

test('outbox recalculates v1/v2 digests and rejects caller substitution',async()=>{const seen=[];const client={query:async(_sql,params)=>{seen.push(params);return {rows:[{outbox_id:'opaque',digest_sha256:params[4]}]};}};const repository=new OutboxRepository({clock});const one=v1();await repository.enqueue(client,{organizationId:ids[0],logicalId:'one',envelope:one.envelope,digest:one.contentDigest});await assert.rejects(()=>repository.enqueue(client,{organizationId:ids[0],logicalId:'bad',envelope:one.envelope,digest:'a'.repeat(64)}),/DIGEST_CONFLICT/);const two=v2('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');const changed=v2('00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01');assert.equal(two.contentDigest,changed.contentDigest);assert.notEqual(two.envelopeDigest,changed.envelopeDigest);await repository.enqueue(client,{organizationId:ids[0],logicalId:'two',envelope:changed.envelope,contentDigest:two.contentDigest});await assert.rejects(()=>repository.enqueue(client,{organizationId:ids[0],logicalId:'functional',envelope:v1({value:2}).envelope,digest:one.contentDigest}),/DIGEST_CONFLICT/);assert.equal(seen.length,2);});

test('inbox derives effect identity from validated envelope',async()=>{let persisted=null;const client={query:async(sql,params)=>{if(sql.includes('INSERT INTO async_exec.inbox')){if(persisted)return {rows:[]};persisted={digest_sha256:params[5],state:'PROCESSING'};return {rows:[persisted]};}return {rows:[persisted]};}};const repository=new InboxRepository(),built=v1();const input={consumer:'worker',jobType:built.envelope.jobType,jobVersion:1,organizationId:ids[0],idempotencyKey:'stable-key',envelope:built.envelope,executionId:built.envelope.executionId,owner:'worker',leaseUntil:clock()};assert.equal((await repository.begin(client,input)).status,'CLAIMED');assert.equal((await repository.begin(client,input)).status,'BUSY');await assert.rejects(()=>repository.begin(client,{...input,envelope:v1({value:2}).envelope,contentDigest:built.contentDigest}),/DIGEST_CONFLICT/);await assert.rejects(()=>repository.begin(client,{...input,organizationId:ids[1]}),/CONTEXT_CONFLICT/);});
