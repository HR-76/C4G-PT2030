'use strict';
const original=require('./sql');
// Separate journal for additional memberships; never overload entity onboarding.
const q={...original};
for(const [key,value] of Object.entries(q))q[key]=value.replaceAll('platform_onboarding_operation','platform_member_operation').replaceAll('platform_onboarding_invitation','platform_member_invitation');
Object.assign(q,{
 emailDelivery:`UPDATE public.platform_member_operation SET receipt=jsonb_set(receipt,'{activationEmail}',$2::jsonb),revision=revision+1 WHERE id=$1 AND phase='READY' AND EXISTS(SELECT 1 FROM public.platform_member_invitation WHERE id=$3::uuid AND operation_id=$1 AND status='OPEN') AND NOT COALESCE((receipt->'activationEmail'->>'invitationId'=$3::text AND receipt->'activationEmail'->>'status'='ACCEPTED' AND $2::jsonb->>'status'<>'ACCEPTED'),false)`,

 authorize:`SELECT u.id,CASE WHEN a.global_user_id IS NOT NULL THEN 'C4G_ADMIN' ELSE m.base_role_code END AS profile
 FROM public.application_session s JOIN public.global_user u ON u.id=s.global_user_id
 JOIN public.organization o ON o.id=$3 AND o.status='ACTIVE'
 LEFT JOIN public.platform_admin_assignment a ON a.global_user_id=u.id AND a.role_code='C4G_ADMIN' AND a.status='ACTIVE'
 LEFT JOIN public.organization_membership m ON m.id=s.selected_membership_id AND m.organization_id=o.id AND m.global_user_id=u.id AND m.membership_version=s.selected_membership_version AND m.status='ACTIVE' AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())
 WHERE s.sid=$1 AND u.id=$2 AND u.status='ACTIVE' AND s.status='ACTIVE' AND s.expires_at>clock_timestamp() AND s.revocation_version=u.session_revocation_version AND (a.global_user_id IS NOT NULL OR (s.selected_organization_id=o.id AND m.base_role_code IN ('ORG_ADMIN','FUNDING_MANAGER'))) FOR SHARE OF s,u,o`,
 eligibleIssuer:`SELECT u.id FROM public.global_user u JOIN public.organization o ON o.id=$2 AND o.status='ACTIVE'
 WHERE u.id=$1 AND u.status='ACTIVE' AND (EXISTS(SELECT 1 FROM public.platform_admin_assignment a WHERE a.global_user_id=u.id AND a.role_code='C4G_ADMIN' AND a.status='ACTIVE') OR EXISTS(SELECT 1 FROM public.organization_membership m WHERE m.global_user_id=u.id AND m.organization_id=o.id AND m.status='ACTIVE' AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()) AND (m.base_role_code='ORG_ADMIN' OR (m.base_role_code='FUNDING_MANAGER' AND $3='CONTRIBUTOR')))) FOR SHARE OF u,o`,
 create:`INSERT INTO public.platform_member_operation(id,organization_id,requested_by,request_key,intent_digest,input,global_user_id,membership_id,profile_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
 duplicate:`SELECT id FROM public.organization_membership WHERE organization_id=$1 AND global_user_id=$2`,
 pending:`INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status) VALUES($1,$2,$3,$4,'PENDING_PROJECTION')`,
 lookup:`SELECT i.*,o.organization_id,o.global_user_id,o.membership_id,o.receipt,o.phase,o.profile_code FROM public.platform_member_invitation i JOIN public.platform_member_operation o ON o.id=i.operation_id WHERE i.digest=$1 FOR UPDATE OF i,o`,
 activation:`SELECT i.*,o.organization_id,o.global_user_id,o.membership_id,o.receipt,o.phase,o.profile_code FROM public.platform_member_invitation i JOIN public.platform_member_operation o ON o.id=i.operation_id WHERE i.exchange_digest=$1 AND i.binding_digest=$2 AND i.exchange_until>clock_timestamp() FOR UPDATE OF i,o`,
 list:`SELECT id,organization_id,phase,status,revision,error_code,created_at,input,profile_code FROM public.platform_member_operation WHERE organization_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,
 claim:`UPDATE public.platform_member_operation SET fence=fence+1,lease_until=clock_timestamp()+interval '60 seconds',status='RUNNING',error_code=NULL,revision=revision+1 WHERE id=$1 AND (lease_until IS NULL OR lease_until<=clock_timestamp()) AND phase IN ('IDENTITY','PROJECTION') RETURNING *`,
 detail:`SELECT id,global_user_id,organization_id,base_role_code,status,membership_version,valid_from,valid_until,status_reason FROM public.organization_membership WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
 state:`SELECT * FROM public.authority_f5_state WHERE organization_id=$1 AND membership_id=$2`,
 grantsUpdate:`UPDATE public.authority_f5_state SET authorization_version=authorization_version+1,policy_version=$3,grants=$4,assurance_requirements=$5,updated_at=clock_timestamp() WHERE organization_id=$1 AND membership_id=$2 RETURNING authorization_version`,
 statusUpdate:`UPDATE public.organization_membership SET status=$3,membership_version=membership_version+1,status_reason=$4,suspended_at=CASE WHEN $3='SUSPENDED' THEN clock_timestamp() ELSE suspended_at END,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2`,
 accessList:require('../organizationDirectory/accessSql').list,
 profileUpdate:require('../organizationDirectory/accessSql').profile
});
delete q.org;delete q.activeOrg;
module.exports=Object.freeze(Object.fromEntries(Object.entries(q).map(([k,v])=>[k,v.replace(/\s+/g,' ').trim()])));
