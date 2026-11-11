'use strict';
// Pure public projection: paths, process identity and installation keys stay private.
function workerHealth(heartbeat,{now=Date.now(),installationId}={}){
 const valid=heartbeat&&heartbeat.installationId===installationId&&Number.isSafeInteger(heartbeat.at)&&heartbeat.at>0&&heartbeat.at<=now;
 const age=valid?now-heartbeat.at:null;
 const euWriter=valid&&heartbeat.euWriterSupported===true&&heartbeat.euWriterPolicyVersion==='eu-existing-v2.0'&&/^[a-f0-9]{64}$/.test(heartbeat.euWriterMappingDigest||'')
  ?{euWriterSupported:true,euWriterPolicyVersion:heartbeat.euWriterPolicyVersion,euWriterMappingDigest:heartbeat.euWriterMappingDigest}:{};
 let state='OFFLINE';
 if(valid&&age<=10000){
  if(heartbeat.mode==='STANDBY')state='STANDBY';
  else if(heartbeat.mode==='PROCESSING'){
   const poll=heartbeat.lastPollAt;
   state=!Number.isSafeInteger(poll)||poll<=0||poll>now?'UNKNOWN':now-poll>180000?'STALLED':heartbeat.consecutiveFailures>=3?'DEGRADED':'PROCESSING';
  }else state='UNKNOWN';
 }
 return Object.freeze({...euWriter,...(valid&&heartbeat.discoveryDetailSupported===true?{discoveryDetailSupported:true}:{}),...(valid&&heartbeat.enrichmentSupported===true?{enrichmentSupported:true}:{}),...(valid&&heartbeat.refreshSupported===true?{refreshSupported:true}:{}),...(valid&&heartbeat.resolutionSupported===true?{resolutionSupported:true}:{}),state,ready:state==='PROCESSING',coverageSupported:valid&&heartbeat.coverageSupported===true,lastHeartbeatAt:valid?new Date(heartbeat.at).toISOString():null,lastPollAt:valid&&Number.isSafeInteger(heartbeat.lastPollAt)&&heartbeat.lastPollAt>0&&heartbeat.lastPollAt<=now?new Date(heartbeat.lastPollAt).toISOString():null});
}
module.exports={workerHealth};
