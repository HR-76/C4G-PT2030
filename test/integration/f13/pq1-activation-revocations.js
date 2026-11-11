'use strict';
const assert=require('node:assert/strict'),{randomUUID:id}=require('node:crypto');
async function run({databases,central,call,ok,root,control}){
 const db=databases[0];
 const effects=async()=>(await db.pool.query("SELECT (SELECT count(*) FROM organization_profile.pq1_effective_snapshot) snapshots,(SELECT count(*) FROM organization_profile.pq1_activation) activations,(SELECT count(*) FROM audit.event WHERE event_code='PROFILE_COHORT_ACTIVATED') events")).rows[0];
 for(const kind of ['grant','membership','session'])for(const first of [true,false]){
  const actor=await central.user(db.org,id(),id()),grants=['organization_profile.read','organization_profile.activate'].map(permission=>({permission,scope:{type:'ORGANIZATION',id:db.org,organizationId:db.org}}));
  const version=await central.data.change({organizationId:db.org,membershipId:actor.membershipId,expectedVersion:1,grants,assuranceRequirements:central.requirement});control.register(actor);
  const preview=await ok(root+'/preview',actor,{versionId:db.versionId});
  const input={versionId:db.versionId,previewToken:preview.concurrencyToken,expectedActivationId:preview.expectedActivationId,expectedGeneration:preview.expectedGeneration,reason:'Concurrent activation authority fixture',idempotencyKey:id()},before=await effects(),pause=control.pauseAt(first?'source':'final');
  const activation=call(root+'/activate',actor,input);await pause.reached;
  const writer=kind==='grant'?central.data.change({organizationId:db.org,membershipId:actor.membershipId,expectedVersion:version,grants:[],assuranceRequirements:central.requirement}):kind==='membership'?require('../../../backend/src/security/membershipRepository').createMembershipRepository(central.pool,central.coordinator).changeStatus({membershipId:actor.membershipId,status:'REMOVED'}):central.registry.revokeSession(actor.sid);
  writer.catch(()=>{});
  try{if(first)await writer;else{const end=Date.now()+8000;let waiting=false;while(Date.now()<end){waiting=(await central.pool.query("SELECT 1 FROM public.authority_write_request WHERE state='WAITING' AND scope_keys && $1::text[]",[[`MEMBER:${actor.membershipId}`,central.coordinator.sessionKey(actor.sid)]])).rowCount>0;if(waiting)break;await new Promise(setImmediate);}assert(waiting);}
   pause.release();const result=await activation;await writer;if(first){assert(result.status>=400,JSON.stringify(result));assert.deepEqual(await effects(),before);}else assert(result.status<300,JSON.stringify(result));
  }finally{pause.release();}
  console.log('PQ1_ACTIVATION_REVOCATION_'+kind+'_'+(first?'FIRST':'AFTER')+' PASS');
 }
}
module.exports={run};
