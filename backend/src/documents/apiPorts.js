'use strict';
const crypto=require('node:crypto');
const {createAuditEvent}=require('../audit/event');
const {createUuidV7}=require('../audit/uuidV7');
const {createAppendService}=require('../audit/appendService');
const {PostgresAppendRepository}=require('../audit/postgresAppendRepository');
const {createDocumentAuditPort}=require('./audit');
const {OutboxRepository}=require('../async/outboxRepository');
const {createEnvelopeV2,createTrustedObservability,validateEnvelope}=require('../async/envelope');
const {createDocumentJobRegistry,JOBS,SERVICE_ACTORS}=require('./jobs');
const AUDIT_OPERATIONS=Object.freeze({DOCUMENT_UPLOAD_INTENT_ACCEPTED:'DOCUMENT_UPLOAD_INITIATE',DOCUMENT_UPLOAD_CONFIRMED:'DOCUMENT_UPLOAD_CONFIRM',DOCUMENT_ACCESS_CAPABILITY_ISSUED:'DOCUMENT_READ'});
async function withRole(pool,organizationId,role,work){
 const client=await pool.connect();let began=false;
 try{await client.query('BEGIN');began=true;await client.query(`SET LOCAL ROLE ${role}`);await client.query("SELECT set_config('app.organization_id',$1,true)",[organizationId]);const result=await work(client);await client.query('COMMIT');began=false;return result;}
 catch(error){if(began)try{await client.query('ROLLBACK');}catch(cleanup){throw new AggregateError([error,cleanup],'DOCUMENT_TRANSACTION_ROLLBACK_FAILED');}throw error;}
 finally{await client.release();}
}
function createDocumentApiPorts({pool,organizationId}){
 const append=createAppendService({appendPort:new PostgresAppendRepository()}),outbox=new OutboxRepository();
 const registry=createDocumentJobRegistry(Object.fromEntries(JOBS.map(type=>[type,()=>{throw Error('API_MUST_NOT_CONSUME_JOBS');}])));
 const audit=createDocumentAuditPort({async accept(input){return withRole(pool,organizationId,'c4g_opportunity_tenant_runtime',async client=>{
  const context=input.context||{},actor=context.actor||{},now=new Date(),correlationId=context.correlationId||createUuidV7();
  // Audit acceptance/access is per authorized request, not once per version.
  // The document operation keeps its separate, stable repository idempotency key.
  if(context.actor&&actor.organizationId!==organizationId)throw Error('DOCUMENT_AUDIT_ORGANIZATION_MISMATCH');
  const event=createAuditEvent({trustedContext:{organizationId,tenantId:client.tenantId,operationAuthority:'TENANT',operationCode:AUDIT_OPERATIONS[input.eventCode]||'DOCUMENT_READ',source:'API',channel:'APPLICATION',synchronous:true},
   input:{eventCode:input.eventCode,actor:actor.id?{type:'HUMAN',id:actor.id,membershipId:actor.membershipId||null,serviceActorCode:null,supportGrantId:null}:{type:'SERVICE',id:'F11_DOCUMENT_API',membershipId:null,serviceActorCode:'F11_DOCUMENT_API',supportGrantId:null},subject:null,resource:input.versionId?{type:'DOCUMENT_VERSION',id:input.versionId}:input.documentId?{type:'DOCUMENT',id:input.documentId}:null,decision:'ACCEPT',outcome:'SUCCESS',observedAt:now.toISOString(),correlationId,causationId:context.causationId||null,idempotencyKey:`doc-api:${input.eventCode}:${input.versionId||input.documentId||'access'}:${correlationId}`,streamType:'DATA',payload:{detailCode:input.eventCode}},clock:()=>now});
  return append.append(event,client);
 });}});
 const reconciliation={async record(input){if(input.organizationId!==organizationId)throw Error('DOCUMENT_RECONCILIATION_CONTEXT');const digest=crypto.createHash('sha256').update(JSON.stringify({organizationId,versionId:input.versionId||null,code:input.code})).digest('hex');return withRole(pool,organizationId,'c4g_document_runtime',async client=>{await client.query("INSERT INTO document_storage.reconciliation_finding(finding_id,organization_id,version_id,finding_code,state,finding_digest) VALUES($1,$2,$3,$4,'OPEN',$5) ON CONFLICT(organization_id,finding_code,finding_digest) DO NOTHING",[crypto.randomUUID(),organizationId,input.versionId||null,input.code,digest]);return{status:'RECORDED'};});}};
 const jobs={async enqueueScan(payload){if(payload.organizationId!==organizationId)throw Error('DOCUMENT_JOB_CONTEXT');const actor=SERVICE_ACTORS['document.scan'];const value=createEnvelopeV2({trustedContext:{organizationId,actor:{kind:'SERVICE',serviceActorCode:actor.code},operation:actor.operation,correlationId:payload.correlationId||crypto.randomUUID(),causationId:crypto.randomUUID()},job:{type:'document.scan',version:1,payloadVersion:1,idempotencyKey:`scan:${payload.versionId}`,deadlineMs:300000},payload,registry,observability:createTrustedObservability({traceparent:null,tracestate:null})}).envelope;
 const validated=validateEnvelope(value,registry);return withRole(pool,organizationId,'c4g_opportunity_tenant_runtime',client=>outbox.enqueueLineage(client,{organizationId,logicalId:`scan:${payload.versionId}`,envelope:value,lineage:{deliveryKind:'INITIAL',attempt:1,rootExecutionId:value.executionId,previousExecutionId:null,contentDigest:validated.contentDigest,envelopeDigest:validated.envelopeDigest,replayRequestId:null}}));}};
 return Object.freeze({audit,reconciliation,jobs});
}
module.exports={createDocumentApiPorts};
