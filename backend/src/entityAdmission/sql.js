'use strict';
const original = require('../platformOnboarding/sql');
const q = Object.fromEntries(['admin','issuer','existing','nonRemovedMembership','identity','user','reference'].map(k => [k, original[k]]));
for (const key of ['operation','replay','claim','advance','failed','invite','issueReplay','issue','revoke','exchange','proof','valid','consume']) {
  q[key] = original[key].replaceAll('platform_onboarding_operation','entity_admission').replaceAll('platform_onboarding_invitation','entity_admission_invitation');
}
Object.assign(q, {
  create: `INSERT INTO public.entity_admission(id,requested_by,request_key,intent_digest,input,global_user_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
  claim: `UPDATE public.entity_admission SET fence=fence+1,lease_until=clock_timestamp()+interval '60 seconds',status='RUNNING',error_code=NULL,revision=revision+1 WHERE id=$1 AND (lease_until IS NULL OR lease_until<=clock_timestamp()) AND phase='IDENTITY' RETURNING *`,
  lookup: `SELECT i.*,o.global_user_id,o.receipt,o.phase FROM public.entity_admission_invitation i JOIN public.entity_admission o ON o.id=i.operation_id WHERE i.digest=$1 FOR UPDATE OF i,o`,
  activation: `SELECT i.*,o.global_user_id,o.receipt,o.phase FROM public.entity_admission_invitation i JOIN public.entity_admission o ON o.id=i.operation_id WHERE i.exchange_digest=$1 AND i.binding_digest=$2 AND i.exchange_until>clock_timestamp() FOR UPDATE OF i,o`,
  accept: `UPDATE public.entity_admission SET phase='FILLING',accepted_at=clock_timestamp(),revision=revision+1 WHERE id=$1 AND phase='READY' RETURNING *`,
  cancel: `UPDATE public.entity_admission SET phase='CANCELLED',status='WAITING',lease_until=NULL,cancelled_at=clock_timestamp(),revision=revision+1 WHERE id=$1 AND phase<>'CANCELLED' RETURNING *`,
  session: `SELECT u.id FROM public.application_session s JOIN public.global_user u ON u.id=s.global_user_id WHERE s.sid=$1 AND u.id=$2 AND s.status='ACTIVE' AND u.status='ACTIVE' AND s.expires_at>clock_timestamp() AND s.revocation_version=u.session_revocation_version FOR SHARE OF s,u`,
  mine: `SELECT id,phase,revision,created_at,accepted_at,cancelled_at FROM public.entity_admission WHERE global_user_id=$1 AND accepted_at IS NOT NULL ORDER BY created_at,id`,
  admissionOnly: `SELECT EXISTS(SELECT 1 FROM public.entity_admission WHERE global_user_id=$1 AND receipt->>'mode'='CREATED') AS admission_origin, EXISTS(SELECT 1 FROM public.platform_admin_assignment WHERE global_user_id=$1 AND role_code='C4G_ADMIN' AND status='ACTIVE') OR EXISTS(SELECT 1 FROM public.organization_membership m JOIN public.organization o ON o.id=m.organization_id WHERE m.global_user_id=$1 AND m.status='ACTIVE' AND o.status='ACTIVE' AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())) AS operational`,
});
module.exports = Object.freeze(Object.fromEntries(Object.entries(q).map(([k,v]) => [k,v.replace(/\s+/g,' ').trim()])));
