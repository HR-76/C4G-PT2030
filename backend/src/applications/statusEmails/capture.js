"use strict";
const {event,id,email}=require('./contracts');
const SQL="SELECT o.id AS organization_id,o.display_name AS organization_name, u.id AS actor_id,u.primary_email AS actor_email, COALESCE((SELECT jsonb_agg(m.id ORDER BY m.id) FROM public.organization_membership m JOIN public.global_user recipient ON recipient.id=m.global_user_id WHERE m.organization_id=o.id AND m.id=ANY($3::uuid[]) AND m.status='ACTIVE' AND recipient.status='ACTIVE' AND m.valid_from<=statement_timestamp() AND (m.valid_until IS NULL OR m.valid_until>statement_timestamp()) AND m.global_user_id<>u.id AND lower(btrim(recipient.primary_email))<>lower(btrim(u.primary_email))), '[]'::jsonb) AS candidates FROM public.organization o CROSS JOIN public.global_user u WHERE cardinality($3::uuid[])<=1000 AND o.id=$1 AND u.id=$2 AND o.status='ACTIVE' AND u.status='ACTIVE'";
// Central identity data is read in one statement snapshot. Recipient read access
// is deliberately revalidated by the future consumer, not inferred from actor.
function createCapture({centralPool,organizationId,actorUserId,assertAuthorized}){
 const org=id(organizationId),actor=id(actorUserId);
 if(typeof centralPool?.query!=='function'||typeof assertAuthorized!=='function')throw TypeError('CAPTURE_AUTHORITY_REQUIRED');
 return async(client,change)=>{
  await assertAuthorized();
  const app=change.application;
  if(app.organization_id!==org)throw Error('STATUS_EMAIL_CONTEXT_CONFLICT');
  const history=(await client.query(`SELECT actor_subject_id,recorded_at FROM opportunity_catalog.application_change WHERE organization_id=$1 AND application_id=$2 AND revision=$3 AND kind='TRANSITION' AND from_status=$4 AND to_status=$5`,[org,app.application_id,change.revision,change.fromStatus,app.status])).rows;
  if(history.length!==1||history[0].actor_subject_id!==actor)throw Error('STATUS_EMAIL_HISTORY_CONFLICT');
  const team=(await client.query('SELECT membership_id FROM opportunity_catalog.application_participant WHERE organization_id=$1 AND application_id=$2 AND active',[org,app.application_id])).rows;
  const candidates=[...new Set([app.responsible_membership_id,...team.map(r=>r.membership_id)].map(id))];
  if(candidates.length>1000)throw Error('STATUS_EMAIL_CANDIDATE_LIMIT');
  const result=await centralPool.query(SQL,[org,actor,candidates]);
  if(result.rows.length!==1)throw Error('STATUS_EMAIL_AUTHORITY_UNAVAILABLE');
  const r=result.rows[0];
  if(r.organization_id!==org||r.actor_id!==actor||!Array.isArray(r.candidates)||r.candidates.some(m=>!candidates.includes(m)))throw Error('STATUS_EMAIL_AUTHORITY_INVALID');
  await assertAuthorized();
  return event({organizationId:org,applicationId:app.application_id,revision:Number(change.revision),actorUserId:actor,actorEmail:email(r.actor_email),occurredAt:new Date(history[0].recorded_at).toISOString(),organizationName:r.organization_name,title:app.title,fromStatus:change.fromStatus,toStatus:app.status,candidateMembershipIds:r.candidates});
 };
}
module.exports={createCapture,SQL};
