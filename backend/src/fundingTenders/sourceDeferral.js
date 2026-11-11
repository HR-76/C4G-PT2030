'use strict';
const {validateEnvelope}=require('../async/envelope');
const EU=new Set(['EU_FUNDING_TENDERS','CORDIS','ERASMUS']);
const fail=()=>{throw Object.assign(Error('FUNDING_DEFERRED_PROOF_REQUIRED'),{code:'FUNDING_DEFERRED_PROOF_REQUIRED'});};
// Only the transport is acknowledged. The immutable original intent remains in
// the Central outbox and the source-control resume transaction re-arms it. No
// attempt, deadline, run, inbox, archive or source fact is rewritten here.
function createFundingSourceDeferral({transaction}){
 if(typeof transaction!=='function')throw new TypeError('Deferral requires a central transaction.');
 return Object.freeze({async defer({type,delivery}){
  const value=validateEnvelope(delivery.envelope,{supports:()=>true});
  if(type!=='funding_tenders.refresh'||value.envelope.jobType!==type||value.envelope.authority!=='CENTRAL')return false;
  return transaction(async client=>{
   const run=(await client.query('SELECT source_code,status,opportunity_catalog.eu_source_execution_allowed_v2(source_code) AS allowed FROM opportunity_catalog.funding_run WHERE run_id=$1',[value.envelope.payload.runId])).rows[0];
   if(!run||!EU.has(run.source_code)||run.allowed===true)return false;
   if(run.allowed!==false)fail();
   if(!['QUEUED','RUNNING'].includes(run.status))return false;
   const rows=(await client.query("SELECT envelope,envelope_digest FROM async_exec.outbox WHERE organization_id IS NULL AND envelope->>'jobType'=$1 AND envelope->>'executionId'=$2 AND envelope->'payload'->>'runId'=$3 AND state IN ('PUBLISHED','PENDING','UNCERTAIN','CLAIMED')",[type,value.envelope.executionId,value.envelope.payload.runId])).rows;
   if(rows.length!==1)fail();
   const durable=validateEnvelope(rows[0].envelope,{supports:()=>true});
   if(rows[0].envelope_digest!==value.envelopeDigest||durable.envelopeDigest!==value.envelopeDigest)fail();
   return true;
  });
 }});
}
module.exports={createFundingSourceDeferral};
