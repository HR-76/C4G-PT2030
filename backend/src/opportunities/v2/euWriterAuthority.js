'use strict';
const {cloneData,deepFreeze}=require('./data');
const WRITER_MODE='CANONICAL_V2',WRITER_POLICY='eu-existing-v2.0',SERVICE='FUNDING_TENDERS_CENTRAL';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
const fail=()=>{throw Object.assign(new Error('OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'),{code:'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'});};
function writerCapability(raw){
 let v;try{v=cloneData(raw,{maxBytes:1024});}catch{fail();}
 if(!v||Array.isArray(v)||Object.keys(v).length!==3||v.mode!==WRITER_MODE||v.policyVersion!==WRITER_POLICY||!SHA.test(v.mappingDigest))fail();
 return deepFreeze(v);
}
function execution(raw){
 let v;try{v=cloneData(raw,{maxBytes:2048});}catch{fail();}
 const keys=['runId','runFence','sourceFence','executionId','inboxFence','workerId','consumer'];
 if(!v||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||!UUID.test(v.runId)||!UUID.test(v.executionId)
 ||['runFence','sourceFence','inboxFence'].some(k=>!Number.isSafeInteger(v[k])||v[k]<1)||v.consumer!=='funding-central-v1'||typeof v.workerId!=='string'||! /^[A-Za-z0-9:_.-]{1,128}$/.test(v.workerId))fail();
 return v;
}
function scope(raw){
 let v;try{v=cloneData(raw,{maxBytes:2048});}catch{fail();}
 const keys=['externalIdentifier','payloadDigest','opportunityId','revisionId','rowVersion','decision'];
 if(!v||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||typeof v.externalIdentifier!=='string'||!v.externalIdentifier||v.externalIdentifier.length>128||/[\u0000-\u001f]/.test(v.externalIdentifier)||!SHA.test(v.payloadDigest))fail();
 if(!['ACCEPTED','REVIEW'].includes(v.decision))fail();
 if(v.opportunityId===null){if(v.revisionId!==null||v.rowVersion!==null||v.decision!=='REVIEW')fail();}
 else if(!UUID.test(v.opportunityId)||!UUID.test(v.revisionId)||!Number.isSafeInteger(v.rowVersion)||v.rowVersion<1)fail();
 return v;
}
function createEuWriterAuthorityV2({policyVersion,mappingDigest}={}){
 const capability=writerCapability({mode:WRITER_MODE,policyVersion,mappingDigest}),permits=new WeakMap();
 async function helper(client,sql,params){
  if(!client||typeof client.query!=='function')fail();
  let previous;
  try{
   previous=(await client.query("SELECT current_setting('role') AS role")).rows[0]?.role;
   if(typeof previous!=='string'||! /^(none|[a-z_][a-z0-9_]*)$/.test(previous))fail();
   await client.query('SET LOCAL ROLE c4g_eu_writer_runtime');
   const value=(await client.query(sql,params)).rows[0]?.permit;
   await client.query(previous==='none'?'SET LOCAL ROLE NONE':'SET LOCAL ROLE '+previous);
   return value;
  }catch{fail();}
 }
 const args=v=>[v.runId,v.runFence,v.sourceFence,v.executionId,v.inboxFence,v.workerId,v.consumer,capability.policyVersion,capability.mappingDigest];
 async function assertExecution(client,raw){
  const v=execution(raw),proof=await helper(client,'SELECT opportunity_catalog.assert_eu_writer_execution_v2($1::uuid,$2::bigint,$3::integer,$4::uuid,$5::bigint,$6::text,$7::text,$8::text,$9::text) AS permit',args(v));
  if(!proof||proof.runId!==v.runId||Number(proof.runFence)!==v.runFence||proof.sourceFence!==v.sourceFence||proof.executionId!==v.executionId||Number(proof.inboxFence)!==v.inboxFence||proof.policyVersion!==capability.policyVersion||proof.mappingDigest!==capability.mappingDigest)fail();
  return deepFreeze({...proof,actor:{type:'SERVICE',id:SERVICE}});
 }
 async function claimRun(client,raw){
  let value;try{value=cloneData(raw,{maxBytes:2048});}catch{fail();}
  if(!value||Object.hasOwn(value,'runFence'))fail();
  const v=execution({...value,runFence:1});
  const row=await helper(client,'SELECT opportunity_catalog.claim_eu_writer_run_v2($1::uuid,$2::integer,$3::uuid,$4::bigint,$5::text,$6::text,$7::text,$8::text) AS permit',[v.runId,v.sourceFence,v.executionId,v.inboxFence,v.workerId,v.consumer,capability.policyVersion,capability.mappingDigest]);
  if(!row||row.run_id!==v.runId||row.status!=='RUNNING'||!Number.isSafeInteger(Number(row.fence))||Number(row.fence)<1||row.eu_source_fence!==v.sourceFence||row.eu_writer_mode!==WRITER_MODE||row.eu_writer_policy!==capability.policyVersion||row.eu_writer_mapping_digest!==capability.mappingDigest)fail();
  return row;
 }
 async function releaseRetry(client,raw){
  const v=execution(raw),proof=await helper(client,'SELECT opportunity_catalog.release_eu_writer_retry_v2($1::uuid,$2::bigint,$3::integer,$4::uuid,$5::bigint,$6::text,$7::text,$8::text,$9::text) AS permit',args(v));
  if(!proof||proof.runId!==v.runId||Number(proof.runFence)!==v.runFence||proof.sourceFence!==v.sourceFence||proof.executionId!==v.executionId||Number(proof.inboxFence)!==v.inboxFence||proof.policyVersion!==capability.policyVersion||proof.mappingDigest!==capability.mappingDigest)fail();
  return true;
 }
 async function authorize(client,raw,rawScope){
  const v=execution(raw),s=scope(rawScope),proof=await helper(client,'SELECT opportunity_catalog.begin_eu_writer_v2($1::uuid,$2::bigint,$3::integer,$4::uuid,$5::bigint,$6::text,$7::text,$8::text,$9::text,$10::text,$11::text,$12::uuid,$13::uuid,$14::bigint,$15::text) AS permit',[...args(v),s.externalIdentifier,s.payloadDigest,s.opportunityId,s.revisionId,s.rowVersion,s.decision]);
  if(!proof||!UUID.test(proof.permitId)||proof.runId!==v.runId||proof.sourceFence!==v.sourceFence||proof.policyVersion!==capability.policyVersion||proof.mappingDigest!==capability.mappingDigest||proof.opportunityId!==s.opportunityId)fail();
  const permit=deepFreeze({...proof,actor:{type:'SERVICE',id:SERVICE}});permits.set(permit,{client,id:proof.permitId});return permit;
 }
 async function assertCurrent(client,permit){
  const bound=permit&&permits.get(permit);if(!bound||bound.client!==client)fail();
  const proof=await helper(client,'SELECT opportunity_catalog.assert_eu_writer_permit_v2($1::uuid) AS permit',[bound.id]);
  if(!proof||proof.permitId!==bound.id||proof.runId!==permit.runId||proof.sourceFence!==permit.sourceFence||proof.policyVersion!==capability.policyVersion||proof.mappingDigest!==capability.mappingDigest)fail();
  return true;
 }
 return Object.freeze({capability,authorize,assertExecution,claimRun,releaseRetry,assertCurrent,close:assertCurrent});
}
module.exports={WRITER_MODE,WRITER_POLICY,SERVICE,writerCapability,createEuWriterAuthorityV2};
