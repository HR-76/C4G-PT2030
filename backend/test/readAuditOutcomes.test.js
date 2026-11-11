'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createAuditCoordinator,AUDIT_CLASSES}=require('../src/authorization/audit');
function event(eventType){return {eventId:'synthetic-event',schemaVersion:'f5-audit-v1',occurredAt:'2026-10-27T00:00:00.000Z',
 eventType,actorType:'HUMAN',actorId:'synthetic-actor',organizationId:'synthetic-org',operationCode:'APPLICATION_READ',
 permissionCode:'application.read',result:'ALLOW',reasonCode:'AUTHORIZED',correlationId:'synthetic-correlation'};}

test('staged observations report transaction-pending rather than durable acceptance',async()=>{
 const audit=createAuditCoordinator({port:{accept:async()=> 'TRANSACTION_PENDING'},timeoutMs:100});
 assert.deepEqual(await audit.emit(event('AUTHORIZATION_ALLOWED')),
  {auditClass:AUDIT_CLASSES.OBSERVATIONAL,outcome:'TRANSACTION_PENDING'});
});

test('pending audit evidence never authorizes a critical or export effect',async()=>{
 const audit=createAuditCoordinator({port:{accept:async()=> 'TRANSACTION_PENDING'},timeoutMs:100});
 for(const code of ['SENSITIVE_ACTION_ALLOWED','EXPORT_ALLOWED','DOCUMENT_ALLOWED'])
  await assert.rejects(()=>audit.emit(event(code)),{code:'AUDIT_CRITICAL_UNAVAILABLE'});
 const denied=await audit.emit(event('AUTHORIZATION_DENIED'));
 assert.equal(denied.auditClass,AUDIT_CLASSES.DENY);assert.equal(denied.outcome,'REJECTED');
});

test('immediate critical acceptance and unknown audit outcomes retain their contracts',async()=>{
 const accepted=createAuditCoordinator({port:{accept:async()=> 'ACCEPTED'},timeoutMs:100});
 assert.equal((await accepted.emit(event('EXPORT_ALLOWED'))).outcome,'ACCEPTED');
 const unknown=createAuditCoordinator({port:{accept:async()=> 'UNRECOGNIZED'},timeoutMs:100});
 assert.equal((await unknown.emit(event('AUTHORIZATION_ALLOWED'))).outcome,'REJECTED');
 await assert.rejects(()=>unknown.emit(event('EXPORT_ALLOWED')),{code:'AUDIT_CRITICAL_UNAVAILABLE'});
});
