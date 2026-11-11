'use strict';
// Only called with the disposable fixture pool; never reads an application .env.
module.exports=async function seedAlerts(tenant){
 const client=await tenant.pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.organization_id',$1,true),set_config('app.membership_id',$2,true)",[tenant.organizationId,tenant.owner.membershipId]);
  const selected=(await client.query('SELECT application_id FROM opportunity_catalog.application WHERE organization_id=$1 ORDER BY title,application_id LIMIT 6',[tenant.organizationId])).rows.map(r=>r.application_id);
  await client.query("UPDATE opportunity_catalog.opportunity SET closing_date=(clock_timestamp() AT TIME ZONE 'Europe/Lisbon')::date+1 WHERE organization_id=$1 AND opportunity_id=$2",[tenant.organizationId,tenant.opportunityId]);
  await client.query("UPDATE opportunity_catalog.application SET status='PREPARATION' WHERE organization_id=$1 AND application_id=ANY($2::uuid[])",[tenant.organizationId,selected.slice(0,2)]);
  for(const [index,id] of selected.entries())await client.query(`INSERT INTO opportunity_catalog.application_alert(organization_id,alert_id,recipient_membership_id,application_id,event_key,type,title,message)
   VALUES($1,gen_random_uuid(),$2,$3,$4,'APPLICATION_STATUS_CHANGED','Synthetic notice','Synthetic private notification')`,[tenant.organizationId,tenant.owner.membershipId,id,'SYNTHETIC:'+index]);
  await client.query(`INSERT INTO opportunity_catalog.application_alert(organization_id,alert_id,recipient_membership_id,application_id,event_key,type,title,message)
   VALUES($1,gen_random_uuid(),gen_random_uuid(),$2,'OTHER_RECIPIENT','APPLICATION_STATUS_CHANGED','Hidden recipient','Must never be published')`,[tenant.organizationId,selected[0]]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
};
