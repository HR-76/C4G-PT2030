'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {validateEnvelope}=require('../src/async/envelope');
const registry={supports:()=>true};
function envelope(){return {envelopeVersion:3,authority:'CENTRAL',jobType:'funding_tenders.refresh',jobVersion:1,payloadVersion:1,organizationId:null,actor:{kind:'SERVICE',serviceActorCode:'FUNDING_TENDERS_CENTRAL'},operation:'opportunity.central.manage',correlationId:randomUUID(),causationId:randomUUID(),executionId:randomUUID(),idempotencyKey:randomUUID(),createdAt:'2026-10-17T10:00:00Z',deadlineAt:'2026-10-17T10:05:00Z',payload:{runId:randomUUID()},observability:{version:1,traceparent:null,tracestate:null}}}
test('null tenant is confined to the explicit central funding service envelope',()=>{
 const good=envelope();assert.equal(validateEnvelope(good,registry).envelope.organizationId,null);
 for(const delta of [{authority:'TENANT'},{jobType:'other.refresh'},{operation:'application.create'},{organizationId:randomUUID()},{actor:{kind:'SERVICE',serviceActorCode:'OTHER_SERVICE'}},{payload:{runId:randomUUID(),organizationId:randomUUID()}},{payload:{runId:'invalid'}}])assert.throws(()=>validateEnvelope({...good,...delta},registry));
 const {authority,...old}=good;assert.throws(()=>validateEnvelope({...old,envelopeVersion:2},registry));
});
test('central application input cannot supply a tenant or a private evaluation',()=>{
 const {command}=require('../src/applications/contracts');
 const input={origin:'CENTRAL',centralRevisionId:randomUUID(),opportunityId:randomUUID(),evaluationId:null,title:'Private application',responsibleMembershipId:randomUUID(),deadline:'2027-01-01',idempotencyKey:randomUUID()};
 assert.equal(command('create',input).origin,'CENTRAL');
 for(const extra of [{organizationId:randomUUID()},{evaluationId:randomUUID()},{centralRevisionId:null}])assert.throws(()=>command('create',{...input,...extra}));
});
