'use strict';
const queries={
 get:`SELECT * FROM public.organization_registration WHERE organization_id=$1`,
 seed:`INSERT INTO public.organization_registration(organization_id,fields,source_revision,source_digest) VALUES($1,$2,$3,$4) RETURNING *`,
 save:`UPDATE public.organization_registration SET fields=fields || $2::jsonb,revision=revision+1,updated_at=clock_timestamp() WHERE organization_id=$1 AND revision=$3 RETURNING *`,
 receipt:`SELECT * FROM public.organization_registration_receipt WHERE organization_id=$1 AND request_key=$2`,
 remember:`INSERT INTO public.organization_registration_receipt(organization_id,request_key,actor_id,intent_digest,result) VALUES($1,$2,$3,$4,$5)`,
 session:`SELECT s.selected_organization_id,s.selected_membership_id,s.selected_membership_version FROM public.application_session s JOIN public.global_user u ON u.id=s.global_user_id JOIN public.organization_membership m ON m.id=s.selected_membership_id AND m.organization_id=s.selected_organization_id AND m.global_user_id=u.id JOIN public.organization o ON o.id=m.organization_id WHERE s.sid=$1 AND u.id=$2 AND s.status='ACTIVE' AND u.status='ACTIVE' AND s.expires_at>clock_timestamp() AND s.revocation_version=u.session_revocation_version AND m.status='ACTIVE' AND m.membership_version=s.selected_membership_version AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()) AND o.status='ACTIVE' FOR SHARE OF s,u,m,o`
};
module.exports=Object.freeze(Object.fromEntries(Object.entries(queries).map(([k,v])=>[k,v.replace(/\s+/g,' ').trim()])));
