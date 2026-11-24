'use strict';
function listingPage(query){const page=query?.page===undefined?'1':query.page;if(!query||Object.keys(query).some(k=>k!=='page')||typeof page!=='string'||!/^([1-9][0-9]{0,5})$/.test(page))require('../platformOnboarding/contracts').fail('ONBOARDING_INPUT_INVALID');return Number(page);}

// What the administration shows for an invitation (context/features/entity-invitation-simplified.md). Decided here, from
// the internal phase and the latest link, so that the page never interprets phases on its own:
//   NOT_SENT   created, but no valid link went out yet (the sending stopped half-way)
//   SENT       a link is out and valid; detail FILLING once the person opened it and is filling the form
//   EXPIRED    the link ran out unused
//   ACCEPTED   the form was submitted; detail PREPARING until the entity is active
//   CANCELLED  cancelled by the administration
function invitationState({phase,invitationStatus,expiresAt},now=new Date()){
 if(phase==='CANCELLED')return {state:'CANCELLED',detail:null};
 if(phase==='COMPLETE')return {state:'ACCEPTED',detail:null};
 if(phase==='PREPARING')return {state:'ACCEPTED',detail:'PREPARING'};
 if(phase==='FILLING')return {state:'SENT',detail:'FILLING'};
 if(phase==='READY'&&invitationStatus==='OPEN'){
  const expiry=new Date(expiresAt);
  return Number.isFinite(expiry.getTime())&&expiry>now?{state:'SENT',detail:null}:{state:'EXPIRED',detail:null};
 }
 return {state:'NOT_SENT',detail:null};
}

// Internal read adapter; invoked only inside the service's current C4G authority.
function createAdmissionListing({pool,now=()=>new Date()}){
 return async page=>{
  const result=(await pool.query(`WITH selected AS (SELECT a.id,a.input->>'adminName' AS name,a.input->>'adminEmail' AS email,
   a.phase,a.created_at,u.display_name AS created_by,i.expires_at,i.status AS invitation_status
   FROM public.entity_admission a JOIN public.global_user u ON u.id=a.requested_by
   LEFT JOIN LATERAL(SELECT expires_at,status FROM public.entity_admission_invitation WHERE operation_id=a.id ORDER BY created_at DESC,id DESC LIMIT 1)i ON true
   ORDER BY a.created_at DESC,a.id DESC LIMIT 25 OFFSET $1)
   SELECT (SELECT count(*)::int FROM public.entity_admission) AS total,COALESCE(jsonb_agg(selected ORDER BY created_at DESC,id DESC),'[]'::jsonb) AS items FROM selected`,[(page-1)*25])).rows[0];
  const moment=now();
  return {page,pageSize:25,total:result.total,items:result.items.map(r=>({id:r.id,name:r.name,email:r.email,phase:r.phase,createdAt:r.created_at,createdBy:r.created_by,expiresAt:r.expires_at,invitationStatus:r.invitation_status,
   ...invitationState({phase:r.phase,invitationStatus:r.invitation_status,expiresAt:r.expires_at},moment)}))};
 };
}
module.exports={createAdmissionListing,listingPage,invitationState};
