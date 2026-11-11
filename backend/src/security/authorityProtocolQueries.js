'use strict';
const {createHash}=require('node:crypto');
const {prepareValue}=require('pg/lib/utils');
const intentionLookupQuery="SELECT guard_id,protected_operations,intention_digest,deadline,source_binding,state,reconciliation_result FROM public.authority_commit_guard WHERE organization_id=$1 AND subject_id=$2 AND idempotency_key=$3 AND source_binding->>'sourceOperation'=$4 AND $4 IN ('PROFILE_DRAFT_CREATE','PROFILE_DRAFT_EDIT','EDITORIAL_SUBMIT','EDITORIAL_APPROVE','EDITORIAL_PUBLISH') AND EXISTS (SELECT 1 FROM jsonb_array_elements(protected_operations) p WHERE p->>'resourceId'=$5) ORDER BY authority_epoch LIMIT 101";
const criteriaLookupQuery="SELECT guard_id,protected_operations,intention_digest,deadline,source_binding,state,reconciliation_result FROM public.authority_commit_guard WHERE organization_id=$1 AND subject_id=$2 AND idempotency_key=$3 AND source_binding->>'sourceOperation'=$4 AND $4 IN ('CRITERIA_SAVE','CRITERIA_CONFIRM') AND EXISTS (SELECT 1 FROM jsonb_array_elements(protected_operations) p WHERE p->>'resourceId'=$5) ORDER BY authority_epoch LIMIT 101";
const pq1DecisionLookupQuery="SELECT guard_id,protected_operations,intention_digest,deadline,source_binding,state,reconciliation_result FROM public.authority_commit_guard WHERE organization_id=$1 AND subject_id=$2 AND idempotency_key=$3 AND source_binding->>'sourceOperation'=$4 AND $4 IN ('PQ1_DECIDE') AND EXISTS (SELECT 1 FROM jsonb_array_elements(protected_operations) p WHERE p->>'resourceId'=$5) ORDER BY authority_epoch LIMIT 101";
const pq1EffectiveLookupQuery="SELECT guard_id,protected_operations,intention_digest,deadline,source_binding,state,reconciliation_result FROM public.authority_commit_guard WHERE organization_id=$1 AND subject_id=$2 AND idempotency_key=$3 AND source_binding->>'sourceOperation'=$4 AND $4 IN ('PQ1_ACTIVATE','PQ1_EVALUATE') AND EXISTS (SELECT 1 FROM jsonb_array_elements(protected_operations) p WHERE p->>'resourceId'=$5) ORDER BY authority_epoch LIMIT 101";
const pq1LookupQuery="SELECT guard_id,protected_operations,intention_digest,deadline,source_binding,state,reconciliation_result FROM public.authority_commit_guard WHERE organization_id=$1 AND subject_id=$2 AND idempotency_key=$3 AND source_binding->>'sourceOperation'=$4 AND $4 IN ('PQ1_UI_CREATE_DRAFT','PQ1_UI_EDIT_ITEMS','PQ1_UI_SET_COMPETENCIES','PQ1_UI_SET_EXPERIENCES','PQ1_UI_ATTACH_EVIDENCE','PQ1_UI_VERIFY','PQ1_UI_REVOKE_VERIFICATION','PQ1_UI_SUBMIT','PQ1_UI_APPROVE','PQ1_UI_PUBLISH') AND EXISTS (SELECT 1 FROM jsonb_array_elements(protected_operations) p WHERE p->>'resourceId'=$5) ORDER BY authority_epoch LIMIT 101";
const queries=Object.freeze([...new Set([
  ...Object.values(require('./identityQueries')),
  ...Object.values(require('../applications/responsibleQueries')),
  require('../applications/statusEmails/capture').SQL,
  ...Object.values(require('../entityAdmission/sql')),
  ...Object.values(require('../entityAdmission/draftSql')),
  ...Object.values(require('../entityAdmission/registrationSql')),
  ...Object.values(require('../entityAdmission/completionSql')),
  ...Object.values(require('../platformOnboarding/memberSql')),
  ...Object.values(require('../platformOnboarding/sql')),
  ...Object.values(require('../organizationDirectory/accessSql')),
  ...Object.values(require('../platformBilling/sql')),
  "SELECT m.* FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id WHERE m.id=$1 AND m.organization_id=$2 AND u.status='ACTIVE' AND m.status IN ('ACTIVE','SUSPENDED') FOR UPDATE OF m",
  "UPDATE public.organization_membership SET status=$3,membership_version=membership_version+1,status_reason=$4, suspended_at=CASE WHEN $3='SUSPENDED' THEN clock_timestamp() ELSE suspended_at END,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2",
  "SELECT * FROM audit.prepare_append_v1($1::uuid,$2::text)",
  "SELECT * FROM audit.append_event_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)",
  pq1DecisionLookupQuery,
  pq1EffectiveLookupQuery,
  pq1LookupQuery,
  criteriaLookupQuery,
  intentionLookupQuery,
  "SELECT om.id AS membership_id, om.organization_id, om.membership_version, om.base_role_code, org.display_name, org.slug FROM public.organization_membership om INNER JOIN public.global_user gu ON gu.id = om.global_user_id INNER JOIN public.organization org ON org.id = om.organization_id WHERE om.global_user_id = $1 AND gu.status = 'ACTIVE' AND org.status = 'ACTIVE' AND om.status = 'ACTIVE' AND om.valid_from <= $2 AND (om.valid_until IS NULL OR om.valid_until > $2) ORDER BY org.display_name ASC, org.id ASC",
  "SELECT om.id AS membership_id, om.organization_id, om.membership_version, om.base_role_code, org.display_name, org.slug FROM public.organization_membership om INNER JOIN public.global_user gu ON gu.id = om.global_user_id INNER JOIN public.organization org ON org.id = om.organization_id WHERE om.global_user_id = $1 AND om.organization_id = $3 AND gu.status = 'ACTIVE' AND org.status = 'ACTIVE' AND om.status = 'ACTIVE' AND om.valid_from <= $2 AND (om.valid_until IS NULL OR om.valid_until > $2) FOR SHARE OF gu, org, om",
  "SELECT om.id AS membership_id, om.organization_id, om.membership_version, om.base_role_code, org.display_name, org.slug FROM public.organization_membership om INNER JOIN public.global_user gu ON gu.id = om.global_user_id INNER JOIN public.organization org ON org.id = om.organization_id WHERE om.id = $1 AND om.organization_id = $3 AND om.membership_version = $4 AND gu.status = 'ACTIVE' AND org.status = 'ACTIVE' AND om.status = 'ACTIVE' AND om.valid_from <= $2 AND (om.valid_until IS NULL OR om.valid_until > $2) FOR SHARE OF gu, org, om",
  "SELECT EXISTS(SELECT 1 FROM public.c4g_database_identity WHERE product_code='C4G' AND database_role='CENTRAL') AS valid",
  "SELECT * FROM public.authority_commit_guard WHERE guard_id=$1 FOR UPDATE",
  "UPDATE public.authority_commit_guard SET state=$2,reconciliation_result=$3, updated_at=clock_timestamp(),resolved_at=clock_timestamp() WHERE guard_id=$1 RETURNING *",
  "SELECT * FROM public.authority_commit_guard WHERE guard_id=$1",
  "INSERT INTO public.authority_write_request(request_id,scope_keys,epoch,state,deadline) VALUES($1,$2,nextval('public.authority_epoch_seq'),'WAITING',$3)",
  "INSERT INTO public.authority_write_permit(transaction_id,backend_pid,scope_keys,epoch,request_id,phase) SELECT txid_current(),pg_backend_pid(),scope_keys,epoch,request_id,'REGISTER' FROM public.authority_write_request WHERE request_id=$1",
  "INSERT INTO public.authority_scope_epoch(scope_key,epoch) SELECT key,r.epoch FROM public.authority_write_request r CROSS JOIN unnest(r.scope_keys) AS key WHERE request_id=$1 ON CONFLICT(scope_key) DO UPDATE SET epoch=EXCLUDED.epoch",
  "DELETE FROM public.authority_write_permit WHERE transaction_id=txid_current()",
  "SELECT state,deadline FROM public.authority_write_request WHERE request_id=$1 FOR UPDATE",
  "UPDATE public.authority_write_request SET state='CANCELLED',finished_at=clock_timestamp() WHERE state='WAITING' AND deadline<=clock_timestamp()",
  "SELECT request_id FROM public.authority_write_request WHERE state='WAITING' AND scope_keys && $1::text[] AND epoch<(SELECT epoch FROM public.authority_write_request WHERE request_id=$2)",
  "SELECT guard_id,deadline FROM public.authority_commit_guard WHERE state IN ('PREPARED','TENANT_COMMIT_UNKNOWN') AND scope_keys && $1::text[] ORDER BY authority_epoch",
  "INSERT INTO public.authority_write_permit(transaction_id,backend_pid,scope_keys,epoch,request_id,phase) SELECT txid_current(),pg_backend_pid(),scope_keys,epoch,request_id,'APPLY' FROM public.authority_write_request WHERE request_id=$1",
  "UPDATE public.authority_write_request SET state='APPLIED',finished_at=clock_timestamp() WHERE request_id=$1",
  "UPDATE public.authority_write_request SET state='CANCELLED',finished_at=clock_timestamp() WHERE request_id=$1 AND state='WAITING'",
  "SELECT request_id FROM public.authority_write_request WHERE state='WAITING' AND scope_keys && $1::text[]",
  "SELECT scope_key,epoch::text FROM public.authority_scope_epoch WHERE scope_key=ANY($1::text[]) ORDER BY scope_key",
  "INSERT INTO public.authority_commit_guard(guard_id,organization_id,tenant_id,subject_id, membership_id,session_digest,scope_keys,protected_operations,authority_versions,normalized_assurance,authority_epoch, transaction_id,correlation_id,idempotency_key,intention_digest,source_binding,state,deadline,finalization_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,nextval('public.authority_epoch_seq'),$11,$12,$13,$14,$15,'PREPARED',$16,$17) RETURNING *",
  "UPDATE public.authority_commit_guard SET state='TENANT_COMMIT_UNKNOWN',updated_at=clock_timestamp() WHERE guard_id=$1 AND state='PREPARED'",
  "SELECT guard_id FROM public.authority_commit_guard WHERE state IN ('PREPARED','TENANT_COMMIT_UNKNOWN') AND deadline<=clock_timestamp() ORDER BY authority_epoch LIMIT $1",
  "INSERT INTO public.oidc_transaction (sid, state, expires_at) VALUES ($1, $2, $3)",
  "UPDATE public.oidc_transaction SET consumed_at = $3 WHERE sid = $1 AND state = $2 AND consumed_at IS NULL AND expires_at > $3 RETURNING sid",
  "INSERT INTO public.application_session (sid, global_user_id, status, revocation_version, created_at, last_seen_at, expires_at) VALUES ($1, $2, 'ACTIVE', $3, NOW(), NOW(), $4) ON CONFLICT (sid) DO UPDATE SET global_user_id = EXCLUDED.global_user_id, status = 'ACTIVE', revocation_version = EXCLUDED.revocation_version, last_seen_at = NOW(), expires_at = EXCLUDED.expires_at",
  "SELECT om.id FROM public.organization_membership om INNER JOIN public.global_user gu ON gu.id = om.global_user_id INNER JOIN public.organization org ON org.id = om.organization_id WHERE om.id = $1 AND om.global_user_id = $2 AND om.organization_id = $3 AND om.membership_version = $4 AND gu.status = 'ACTIVE' AND org.status = 'ACTIVE' AND om.status = 'ACTIVE' AND om.valid_from <= NOW() AND (om.valid_until IS NULL OR om.valid_until > NOW()) FOR SHARE OF om, gu, org",
  "INSERT INTO public.application_session ( sid, global_user_id, status, revocation_version, created_at, last_seen_at, expires_at, selected_organization_id, selected_membership_id, selected_membership_version ) VALUES ($1, $2, 'ACTIVE', $3, NOW(), NOW(), $4, $5, $6, $7) ON CONFLICT (sid) DO UPDATE SET global_user_id = EXCLUDED.global_user_id, status = 'ACTIVE', revocation_version = EXCLUDED.revocation_version, last_seen_at = NOW(), expires_at = EXCLUDED.expires_at, selected_organization_id = EXCLUDED.selected_organization_id, selected_membership_id = EXCLUDED.selected_membership_id, selected_membership_version = EXCLUDED.selected_membership_version, revoked_at = NULL, revocation_reason = NULL",
  "UPDATE public.application_session SET status = 'REVOKED', revoked_at = NOW(), revocation_reason = 'SESSION_ROTATED' WHERE sid = $1 AND status = 'ACTIVE'",
  "UPDATE public.application_session AS aps SET last_seen_at = $4 FROM public.global_user AS gu WHERE aps.sid = $1 AND aps.global_user_id = $2 AND gu.id = aps.global_user_id AND aps.status = 'ACTIVE' AND gu.status = 'ACTIVE' AND aps.revocation_version = $3 AND gu.session_revocation_version = $3 AND aps.expires_at > $4 RETURNING aps.sid",
  "SELECT aps.selected_organization_id, aps.selected_membership_id, aps.selected_membership_version, om.membership_version, om.base_role_code, om.status AS membership_status, om.valid_from, om.valid_until, org.status AS organization_status, org.display_name, org.slug, gu.status AS user_status, LEAST(aps.expires_at,ss.expire) AS session_expires_at FROM public.application_session aps INNER JOIN public.global_user gu ON gu.id = aps.global_user_id LEFT JOIN public.application_session_store ss ON ss.sid=aps.sid LEFT JOIN public.organization_membership om ON om.id = aps.selected_membership_id AND om.global_user_id = aps.global_user_id AND om.organization_id = aps.selected_organization_id LEFT JOIN public.organization org ON org.id = aps.selected_organization_id WHERE aps.sid = $1 AND aps.global_user_id = $2 AND aps.status = 'ACTIVE'",
  "UPDATE public.application_session SET status = 'REVOKED', revoked_at = NOW(), revocation_reason = $2 WHERE sid = $1 AND status = 'ACTIVE'",
  "UPDATE public.application_session SET status = 'EXPIRED' WHERE sid = $1 AND status = 'ACTIVE'",
  "UPDATE public.global_user SET session_revocation_version = session_revocation_version + 1, updated_at = NOW() WHERE id = $1 RETURNING session_revocation_version",
  "UPDATE public.application_session SET status = 'REVOKED', revoked_at = NOW(), revocation_reason = $2, revocation_version = $3 WHERE global_user_id = $1 AND status = 'ACTIVE' RETURNING sid",
  "DELETE FROM public.application_session_store WHERE sid = ANY($1::varchar[])",
  "DELETE FROM public.oidc_transaction WHERE expires_at <= $1",
  "UPDATE public.application_session SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND expires_at <= $1 RETURNING sid",
  "SELECT sid FROM public.application_session WHERE global_user_id=$1",
  "SELECT sid FROM public.application_session WHERE expires_at<=$1",
  "UPDATE public.organization_membership SET status = $2, membership_version = membership_version + 1, status_reason = $3, suspended_at = CASE WHEN $2 = 'SUSPENDED' THEN NOW() ELSE suspended_at END, removed_at = CASE WHEN $2 = 'REMOVED' THEN NOW() ELSE removed_at END, updated_at = NOW() WHERE id = $1 AND status <> 'REMOVED' RETURNING id, global_user_id, organization_id, membership_version",
  "SELECT f.organization_id,f.membership_id,f.authorization_version,f.policy_version,f.grants,f.assurance_requirements, m.membership_version,m.base_role_code FROM public.authority_f5_state f JOIN public.organization_membership m ON m.id=f.membership_id AND m.organization_id=f.organization_id WHERE f.organization_id=$1 AND f.membership_id=$2",
  "SELECT m.id,m.organization_id,m.global_user_id,m.membership_version,m.status,m.valid_until FROM public.organization_membership m JOIN public.organization o ON o.id=m.organization_id JOIN public.global_user u ON u.id=m.global_user_id WHERE m.id=$1 AND m.organization_id=$2 AND o.status='ACTIVE' AND u.status='ACTIVE' AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())",
  "SELECT id FROM public.organization_membership WHERE id=$1 AND organization_id=$2",
  "INSERT INTO public.authority_f5_state(organization_id,membership_id,authorization_version,policy_version,grants,assurance_requirements) SELECT $1,$2,1,$4,$5,$6 WHERE $3::bigint=0 ON CONFLICT(organization_id,membership_id) DO UPDATE SET authorization_version=authority_f5_state.authorization_version+1, policy_version=$4,grants=$5,assurance_requirements=$6,updated_at=clock_timestamp() WHERE authority_f5_state.authorization_version=$3 RETURNING authorization_version",
  "UPDATE public.authority_f5_state SET authorization_version=authorization_version+1, policy_version=$4,grants=$5,assurance_requirements=$6,updated_at=clock_timestamp() WHERE organization_id=$1 AND membership_id=$2 AND authorization_version=$3 RETURNING authorization_version",
  "SET CONSTRAINTS ALL IMMEDIATE",
  "SELECT sess FROM public.application_session_store WHERE sid=$1",
  "SELECT sess FROM \"public\".\"application_session_store\" WHERE sid = $1 AND expire >= to_timestamp($2)",
  "INSERT INTO \"public\".\"application_session_store\" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid",
  "DELETE FROM \"public\".\"application_session_store\" WHERE sid = $1",
  "UPDATE \"public\".\"application_session_store\" SET expire = to_timestamp($1) WHERE sid = $2 RETURNING sid"
]),require('./tenantDirectoryQueries').resolve]);
const normalize=sql=>sql.replace(/\s+/g,' ').trim();
const codes=new Map(queries.map(sql=>[sql,createHash('sha256').update(sql).digest('hex')]));
async function execute(client,sql,values=[],permit=null){
  const normalized=typeof sql==='string'?normalize(sql):null,code=codes.get(normalized);
  if(!code)throw Object.assign(new Error('AUTHORITY_QUERY_DENIED'),{code:'42501'});
  const response=await client.query('SELECT authority_api.execute($1,$2::text[],$3) AS result',[code,values.map(value=>prepareValue(value)),permit]);
  return response.rows[0].result;
}
module.exports={execute,queries,normalize,intentionLookupQuery,criteriaLookupQuery,pq1LookupQuery,pq1EffectiveLookupQuery,pq1DecisionLookupQuery};
