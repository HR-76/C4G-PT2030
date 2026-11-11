const { assertQueuePort } = require('../queuePort');
const { EXPECTED, assertPgBossCompatibility } = require('../pgBossVersionGuard');
const { validateEnvelope } = require('../envelope');
const crypto=require('node:crypto');
function normalizeClaimedJob(raw,type,lineage=null){
  if(!raw||typeof raw!=='object'||typeof raw.id!=='string'||raw.id.length<1)throw new TypeError('Queue delivery is invalid.');
  const envelope=raw.data;const validated=validateEnvelope(envelope,{supports:()=>true});
  if(validated.envelope.jobType!==type)throw new TypeError('Queue delivery type conflicts with validated envelope.');
  const retries=Number.isInteger(raw.retryCount)&&raw.retryCount>=0?raw.retryCount:0;
  if(lineage){const replay=lineage.deliveryKind==='REPLAY';if(lineage.lineageVersion!==1||lineage.executionId!==validated.envelope.executionId||lineage.organizationId!==validated.envelope.organizationId||lineage.jobType!==type||!['INITIAL','RETRY','REPLAY'].includes(lineage.deliveryKind)||!Number.isInteger(lineage.attempt)||lineage.attempt<1||lineage.attempt>5||lineage.contentDigest!==validated.contentDigest||lineage.envelopeDigest!==validated.envelopeDigest||replay!==Boolean(lineage.replayRequestId))throw new TypeError('Queue lineage metadata is incompatible.');return Object.freeze({id:raw.id,envelope:validated.envelope,attempt:lineage.attempt,redelivery:retries>0,replay,rootExecutionId:lineage.rootExecutionId});}
  return Object.freeze({id:raw.id,envelope:validated.envelope,attempt:retries+1,redelivery:retries>0,replay:false});
}
function sanitized(error) { const e=new Error('ASYNC_QUEUE_OPERATION_FAILED'); e.causeCode='QUEUE_ADAPTER'; return e; }
async function createPgBossQueueAdapter({ connectionString, options, queueMap, inspectSchema, lineagePort = null, load = () => import('pg-boss') }) {
  if (typeof connectionString!=='string' || !queueMap || typeof inspectSchema!=='function') throw new TypeError('Queue adapter configuration is invalid.');
  const inspection=await inspectSchema(); assertPgBossCompatibility({...inspection,packageVersion:EXPECTED.packageVersion,schema:EXPECTED.schema});
  const { PgBoss }=await load();
  const boss=new PgBoss({ connectionString, options, schema:EXPECTED.schema, createSchema:false, migrate:false, supervise:false, schedule:false });
  const nameFor=t=>{const n=queueMap[t]; if(!n) throw new TypeError('Job type is not allowlisted.'); return n;};
  await boss.start({ supervise:false, schedule:false });
  const call=async fn=>{try{return await fn();}catch(e){throw sanitized(e);}};
  return assertQueuePort({
    publish:({type,envelope,envelopeDigest})=>{const validated=validateEnvelope(envelope,{supports:()=>true});if(validated.envelope.jobType!==type)throw new TypeError('Queue type conflicts with validated envelope.');if(typeof envelopeDigest!=='string'||!/^[a-f0-9]{64}$/.test(envelopeDigest)||!crypto.timingSafeEqual(Buffer.from(envelopeDigest,'hex'),Buffer.from(validated.envelopeDigest,'hex')))throw new TypeError('Queue envelope digest is invalid.');return call(()=>boss.send(nameFor(type),validated.envelope,{retryLimit:0}));},
    claim:({type,batchSize=10})=>call(async()=>{const rows=await boss.fetch(nameFor(type),{batchSize:Math.min(10,batchSize),includeMetadata:true});return Promise.all((rows||[]).map(async row=>normalizeClaimedJob(row,type,lineagePort?await lineagePort.load(row.data?.executionId):null)));}),
    heartbeat:({type,id})=>call(()=>boss.touch(nameFor(type),id)),
    complete:({type,id,result})=>call(()=>boss.complete(nameFor(type),id,result)),
    fail:({type,id,result})=>call(()=>boss.fail(nameFor(type),id,result)),
    cancel:({type,id})=>call(()=>boss.cancel(nameFor(type),id)),
    deadLetter:({type,id,result})=>call(()=>boss.fail(nameFor(type),id,result)),
    getState:({type,id})=>call(()=>boss.findJobs(nameFor(type),{id})),
    shutdown:()=>call(()=>boss.stop({graceful:true,timeout:30000}))
  });
}
module.exports = { createPgBossQueueAdapter, normalizeClaimedJob };
