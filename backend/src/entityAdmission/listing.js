'use strict';
function listingPage(query){const page=query?.page===undefined?'1':query.page;if(!query||Object.keys(query).some(k=>k!=='page')||typeof page!=='string'||!/^([1-9][0-9]{0,5})$/.test(page))require('../platformOnboarding/contracts').fail('ONBOARDING_INPUT_INVALID');return Number(page);}
// Internal read adapter; invoked only inside the service's current C4G authority.
function createAdmissionListing({pool}){
 return async page=>{
  const result=(await pool.query(`WITH selected AS (SELECT a.id,a.input->>'adminName' AS name,a.input->>'adminEmail' AS email,
   a.phase,a.created_at,u.display_name AS created_by,i.expires_at,i.status AS invitation_status
   FROM public.entity_admission a JOIN public.global_user u ON u.id=a.requested_by
   LEFT JOIN LATERAL(SELECT expires_at,status FROM public.entity_admission_invitation WHERE operation_id=a.id ORDER BY created_at DESC,id DESC LIMIT 1)i ON true
   ORDER BY a.created_at DESC,a.id DESC LIMIT 25 OFFSET $1)
   SELECT (SELECT count(*)::int FROM public.entity_admission) AS total,COALESCE(jsonb_agg(selected ORDER BY created_at DESC,id DESC),'[]'::jsonb) AS items FROM selected`,[(page-1)*25])).rows[0];
  return {page,pageSize:25,total:result.total,items:result.items.map(r=>({id:r.id,name:r.name,email:r.email,phase:r.phase,createdAt:r.created_at,createdBy:r.created_by,expiresAt:r.expires_at,invitationStatus:r.invitation_status}))};
 };
}
module.exports={createAdmissionListing,listingPage};
