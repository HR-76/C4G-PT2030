'use strict';

const crypto=require('node:crypto');
const {createAuditEvent}=require('../audit/event');
const {createAppendService}=require('../audit/appendService');
const {PostgresAppendRepository}=require('../audit/postgresAppendRepository');
const {createUuidV7}=require('../audit/uuidV7');
const {createDocumentAuditPort}=require('./audit');

function identifier(value){if(!/^[a-z][a-z0-9_]{0,62}$/.test(value||''))throw new TypeError('Document worker role is invalid.');return `"${value}"`;}
function transaction(pool,role,organizationId,work){return(async()=>{const client=await pool.connect();let began=false,broken;try{await client.query('BEGIN');began=true;await client.query(`SET LOCAL ROLE ${identifier(role)}`);await client.query("SELECT set_config('app.organization_id',$1,true)",[organizationId]);const value=await work(client);await client.query('COMMIT');began=false;return value;}catch(error){if(began){try{await client.query('ROLLBACK');}catch(rollbackError){broken=rollbackError;}}throw error;}finally{client.release(broken);}})();}

function createPostgresDocumentWorkerPorts({pool,organizationId,tenantId,clock=()=>new Date(),telemetry=null}){
 if(!pool||typeof pool.connect!=='function'||typeof organizationId!=='string'||typeof tenantId!=='string')throw new TypeError('Document worker PostgreSQL ports are invalid.');
 const append=createAppendService({appendPort:new PostgresAppendRepository(),telemetryPort:telemetry});
 const sink=Object.freeze({async accept(input){
  if(!input||typeof input.eventCode!=='string'||input.organizationId!==organizationId)throw new TypeError('Document worker audit input is invalid.');
  const now=clock(),actorCode=input.actor?.serviceActorCode||'F11_DOCUMENT_WORKER',versionId=input.versionId||null;
  const event=createAuditEvent({trustedContext:{organizationId,tenantId,operationAuthority:'TENANT',operationCode:'F11_DOCUMENT_WORKER',source:'WORKER',channel:'APPLICATION',synchronous:true},input:{eventCode:input.eventCode,actor:{type:'SERVICE',id:actorCode,membershipId:null,serviceActorCode:actorCode,supportGrantId:null},subject:null,resource:versionId?{type:'DOCUMENT_VERSION',id:versionId}:null,decision:'ACCEPT',outcome:'SUCCESS',observedAt:now.toISOString(),correlationId:createUuidV7({now:()=>now.getTime()}),causationId:null,idempotencyKey:`doc-worker:${input.eventCode}:${versionId||'organization'}:${input.result||'NONE'}`,streamType:'DATA',payload:{detailCode:String(input.detailCode||input.result||input.eventCode).toUpperCase().replace(/[^A-Z0-9_]/g,'_').slice(0,64),catalogVersion:'f12-events-v2'}},clock:()=>now});
  return transaction(pool,'c4g_document_worker_runtime',organizationId,client=>append.append(event,client));
 }});
 const audit=createDocumentAuditPort(sink);
 const reconciliation=Object.freeze({async record(input){
  if(!input||input.organizationId!==organizationId||typeof input.code!=='string')throw new TypeError('Document reconciliation input is invalid.');
  const material=JSON.stringify({organizationId,versionId:input.versionId||null,code:input.code});
  const digest=crypto.createHash('sha256').update(material).digest('hex');
  return transaction(pool,'c4g_document_runtime',organizationId,async client=>{await client.query(`INSERT INTO document_storage.reconciliation_finding(finding_id,organization_id,version_id,finding_code,state,finding_digest) VALUES($1,$2,$3,$4,'OPEN',$5) ON CONFLICT(organization_id,finding_code,finding_digest) DO NOTHING`,[crypto.randomUUID(),organizationId,input.versionId||null,input.code,digest]);return Object.freeze({status:'RECORDED'});});
 }});
 return Object.freeze({audit,reconciliation});
}

module.exports={createPostgresDocumentWorkerPorts,transaction};
