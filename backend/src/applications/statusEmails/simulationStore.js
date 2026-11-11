"use strict";
// transaction(org, work) must commit/rollback a tenant-scoped, isolated DB client.
function createSimulationStore({transaction,isolated=false}){
 if(isolated!==true||typeof transaction!=='function')throw TypeError('ISOLATED_TRANSACTION_REQUIRED');
 const read=`SELECT d.event_id,d.membership_id,e.snapshot,s.state,s.message,s.first_attempt_at,s.lease_until,s.fence
 FROM opportunity_catalog.application_status_delivery d JOIN opportunity_catalog.application_status_event e USING(organization_id,event_id)
 LEFT JOIN opportunity_catalog.application_status_simulation s USING(organization_id,delivery_id)
 WHERE d.organization_id=$1 AND d.delivery_id=$2`;
 async function row(c,org,delivery){return (await c.query(read,[org,delivery])).rows[0];}
 return Object.freeze({
 load:(org,delivery)=>transaction(org,async c=>{const r=await row(c,org,delivery);return r?{snapshot:r.snapshot,membershipId:r.membership_id,state:r.state||'PENDING',attempted:!!r.first_attempt_at}:null;}),
 skip:(org,delivery,reason)=>transaction(org,c=>c.query(`INSERT INTO opportunity_catalog.application_status_simulation(organization_id,delivery_id,event_id,state,reason) SELECT organization_id,delivery_id,event_id,'SKIPPED',$3 FROM opportunity_catalog.application_status_delivery WHERE organization_id=$1 AND delivery_id=$2 ON CONFLICT DO NOTHING`,[org,delivery,reason])),
 reserve:(org,delivery,message,now)=>transaction(org,async c=>{
  // Serialize the organization's simulation reservations, including address dedup.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,43101))',[org]);
  const r=await row(c,org,delivery);if(!r)return {status:'HOLD'};
  if(['ACCEPTED','SKIPPED','FAILED'].includes(r.state))return {status:'TERMINAL'};
  if(r.first_attempt_at&&(now-new Date(r.first_attempt_at)>=86400000||['to','subject','html','text'].some(k=>r.message[k]!==message[k])))return {status:'HOLD'};
  if(r.lease_until&&new Date(r.lease_until)>now)return {status:'BUSY'};
  const duplicate=(await c.query('SELECT delivery_id FROM opportunity_catalog.application_status_simulation WHERE organization_id=$1 AND event_id=$2 AND destination=$3 AND delivery_id<>$4',[org,r.event_id,message.to,delivery])).rows;
  if(duplicate.length)return {status:'HOLD'};
  const earlier=(await c.query(`SELECT 1 FROM opportunity_catalog.application_status_delivery d JOIN opportunity_catalog.application_status_event e USING(organization_id,event_id) LEFT JOIN opportunity_catalog.application_status_simulation s USING(organization_id,delivery_id) WHERE d.organization_id=$1 AND e.application_id=$2 AND e.revision<$3 AND d.membership_id=$4 AND COALESCE(s.state,'PENDING') NOT IN ('ACCEPTED','SKIPPED','FAILED') LIMIT 1`,[org,r.snapshot.applicationId,r.snapshot.revision,r.membership_id])).rows;
  if(earlier.length)return {status:'BUSY'};
  const saved=(await c.query(`INSERT INTO opportunity_catalog.application_status_simulation(organization_id,delivery_id,event_id,state,message,destination,first_attempt_at,lease_until) VALUES($1,$2,$3,'RESERVED',$4::jsonb,$5,$6,$7) ON CONFLICT(organization_id,delivery_id) DO UPDATE SET state='RESERVED',fence=application_status_simulation.fence+1,lease_until=EXCLUDED.lease_until RETURNING fence,message`,[org,delivery,r.event_id,JSON.stringify(message),message.to,now,new Date(now.getTime()+30000)])).rows[0];
  return {status:'RESERVED',fence:Number(saved.fence),message:saved.message};
 }),
 finish:(org,delivery,fence,state,reason)=>transaction(org,async c=>(await c.query(`UPDATE opportunity_catalog.application_status_simulation SET state=$4,reason=$5,lease_until=NULL WHERE organization_id=$1 AND delivery_id=$2 AND fence=$3 AND state='RESERVED'`,[org,delivery,fence,state,reason])).rowCount===1)
 });
}
module.exports={createSimulationStore};
