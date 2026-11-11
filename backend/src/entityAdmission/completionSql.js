'use strict';
const q={
 get:`SELECT * FROM public.entity_admission_completion WHERE admission_id=$1 FOR UPDATE`,
 reserve:`INSERT INTO public.organization_fiscal_identity(country,nif,admission_id,organization_id) VALUES('PT',$1,$2,$3) ON CONFLICT(country,nif) DO NOTHING RETURNING organization_id`,
 occupied:`SELECT organization_id FROM public.organization_registration WHERE fields->>'nif'=$1 LIMIT 1`,
 create:`INSERT INTO public.entity_admission_completion(admission_id,organization_id,membership_id,actor_id,request_key,draft_revision,snapshot,snapshot_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
 registration:`INSERT INTO public.organization_registration(organization_id,fields,source_revision,source_digest) VALUES($1,$2,$3,$4)`,
 submitted:`UPDATE public.entity_admission SET phase='PREPARING',revision=revision+1 WHERE id=$1 AND phase='FILLING' RETURNING *`,
 jobs:`SELECT admission_id FROM public.entity_admission_completion WHERE phase IN ('TENANT','PROJECTION','ACTIVATION') AND (lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY created_at,admission_id LIMIT 20`,
 claim:`UPDATE public.entity_admission_completion SET fence=fence+1,lease_until=clock_timestamp()+interval '60 seconds',error_code=NULL,updated_at=clock_timestamp() WHERE admission_id=$1 AND phase IN ('TENANT','PROJECTION','ACTIVATION') AND (lease_until IS NULL OR lease_until<=clock_timestamp()) RETURNING *`,
 advance:`UPDATE public.entity_admission_completion SET phase=$3,lease_until=NULL,error_code=NULL,updated_at=clock_timestamp(),completed_at=CASE WHEN $3='COMPLETE' THEN clock_timestamp() ELSE NULL END WHERE admission_id=$1 AND fence=$2 AND lease_until>clock_timestamp() AND phase<>'CANCELLED' RETURNING *`,
 failed:`UPDATE public.entity_admission_completion SET lease_until=NULL,error_code='PREPARATION_UNCONFIRMED',updated_at=clock_timestamp() WHERE admission_id=$1 AND fence=$2 AND phase IN ('TENANT','PROJECTION','ACTIVATION') RETURNING *`,
 cancel:`UPDATE public.entity_admission_completion SET phase='CANCELLED',fence=fence+1,lease_until=NULL,updated_at=clock_timestamp() WHERE admission_id=$1 AND phase<>'COMPLETE' RETURNING *`,
 complete:`UPDATE public.entity_admission SET phase='COMPLETE',status='COMPLETE',revision=revision+1 WHERE id=$1 AND phase='PREPARING' RETURNING *`,
 readiness:`SELECT w.workload FROM public.tenant_workload_binding w JOIN public.tenant t ON t.tenant_id=w.tenant_id WHERE t.organization_id=$1 AND w.workload IN ('API','WORKER') AND w.lifecycle_status='AVAILABLE' AND w.compatibility_status='COMPATIBLE' AND w.provisioning_status='READY'`,
};
module.exports=Object.freeze(Object.fromEntries(Object.entries(q).map(([k,v])=>[k,v.replace(/\s+/g,' ').trim()])));
