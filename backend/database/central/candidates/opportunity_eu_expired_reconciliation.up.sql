-- Additive 044: one authenticated administrative expiry, without source resume,
-- new delivery, target edits or changes to the historical 036--043 SQL.
CREATE ROLE c4g_eu_reconciliation_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA opportunity_catalog TO c4g_eu_reconciliation_runtime;
GRANT USAGE ON SCHEMA authority_api,audit TO c4g_opportunity_central_owner;
GRANT EXECUTE ON FUNCTION authority_api.opportunity_v2_administrator(text,uuid) TO c4g_opportunity_central_owner;
GRANT SELECT ON async_exec.outbox,async_exec.inbox,async_exec.execution TO c4g_opportunity_central_owner;
GRANT UPDATE(state,result_code,lease_until,fence,completed_at) ON async_exec.inbox TO c4g_opportunity_central_owner;
GRANT UPDATE(state,result_code,lease_until,fence,updated_at) ON async_exec.execution TO c4g_opportunity_central_owner;

CREATE TABLE opportunity_catalog.eu_expired_permit_v1 (
 plan_id uuid PRIMARY KEY,request_id uuid NOT NULL UNIQUE,actor_id uuid NOT NULL,
 transaction_id bigint NOT NULL,backend_pid integer NOT NULL,source_fence integer NOT NULL CHECK(source_fence>0),
 run_id uuid NOT NULL UNIQUE REFERENCES opportunity_catalog.funding_run(run_id),cycle_id uuid NOT NULL REFERENCES opportunity_catalog.funding_cycle(cycle_id),
 preview_digest text NOT NULL CHECK(preview_digest ~ '^[a-f0-9]{64}$'),plan_digest text NOT NULL CHECK(plan_digest ~ '^[a-f0-9]{64}$'),
 before_state jsonb NOT NULL,after_rows jsonb NOT NULL,authority_not_after timestamptz NOT NULL,
 approval_event_id uuid NOT NULL,approval_event_hash text NOT NULL CHECK(approval_event_hash ~ '^[a-f0-9]{64}$'),
 effect_event_id uuid NOT NULL,effect_event_hash text NOT NULL CHECK(effect_event_hash ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(transaction_id,backend_pid)
);
CREATE TABLE opportunity_catalog.eu_expired_reconciliation_v1 (
 plan_id uuid PRIMARY KEY REFERENCES opportunity_catalog.eu_expired_permit_v1(plan_id),request_id uuid NOT NULL UNIQUE,
 actor_id uuid NOT NULL,run_id uuid NOT NULL UNIQUE,cycle_id uuid NOT NULL,source_fence integer NOT NULL,
 preview_digest text NOT NULL,plan_digest text NOT NULL,approval_event_id uuid NOT NULL,approval_event_hash text NOT NULL,
 effect_event_id uuid NOT NULL,effect_event_hash text NOT NULL,result jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE opportunity_catalog.eu_expired_permit_v1 OWNER TO c4g_opportunity_central_owner;
ALTER TABLE opportunity_catalog.eu_expired_reconciliation_v1 OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON opportunity_catalog.eu_expired_permit_v1,opportunity_catalog.eu_expired_reconciliation_v1 FROM PUBLIC,c4g_catalog_reader,c4g_eu_writer_runtime,c4g_opportunity_central_runtime,c4g_central_runtime,c4g_eu_reconciliation_runtime;
CREATE TRIGGER eu_expired_permit_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.eu_expired_permit_v1 FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER eu_expired_permit_no_truncate BEFORE TRUNCATE ON opportunity_catalog.eu_expired_permit_v1 FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER eu_expired_receipt_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.eu_expired_reconciliation_v1 FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER eu_expired_receipt_no_truncate BEFORE TRUNCATE ON opportunity_catalog.eu_expired_reconciliation_v1 FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();

-- No general audit SELECT is granted. Only an exact, critical platform event
-- bound to the same actor, plan and preview can authorize this operation.
CREATE FUNCTION audit.eu_expired_event_v1(p_event uuid,p_hash text,p_actor uuid,p_plan uuid,p_preview text,p_plan_digest text,p_detail text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE at_time timestamptz;
BEGIN
 IF p_detail NOT IN ('EU_EXPIRED_RECONCILIATION_APPROVED','EU_EXPIRED_RECONCILIATION_APPLIED') THEN RAISE EXCEPTION 'OPPORTUNITY_V2_RECONCILIATION_APPROVAL_REQUIRED'; END IF;
 SELECT e.accepted_at INTO STRICT at_time FROM audit.event e WHERE e.event_id=p_event AND e.event_hash=p_hash
  AND e.actor_type='HUMAN' AND e.actor_id=p_actor::text AND e.organization_id IS NULL AND e.tenant_id IS NULL
  AND e.ledger_location='CENTRAL' AND e.stream_id='PLATFORM:OPERATIONS' AND e.stream_type='OPERATIONS'
  AND e.event_code='SENSITIVE_ACTION_ALLOWED' AND e.audit_class='CRITICAL_PRE_EFFECT'
  AND e.event_data->>'source'='EU_EXPIRED_RECONCILIATION' AND e.event_data->>'decision'='ACCEPT' AND e.event_data->>'outcome'='SUCCESS'
  AND e.event_data#>>'{resource,type}'='EU_EXPIRED_RECONCILIATION' AND e.event_data#>>'{resource,id}'=p_plan::text
  AND e.event_data#>>'{payload,detailCode}'=p_detail AND e.event_data#>>'{payload,scopeDigest}'=p_preview
  AND e.event_data#>>'{payload,semanticDigest}'=p_plan_digest AND e.event_data#>>'{payload,policyVersion}'='eu-expired-reconciliation-v1';
 IF at_time>clock_timestamp() THEN RAISE EXCEPTION 'OPPORTUNITY_V2_RECONCILIATION_APPROVAL_REQUIRED'; END IF;RETURN at_time;
 EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'OPPORTUNITY_V2_RECONCILIATION_APPROVAL_REQUIRED';
END $$;
ALTER FUNCTION audit.eu_expired_event_v1(uuid,text,uuid,uuid,text,text,text) OWNER TO c4g_audit_owner;
REVOKE ALL ON FUNCTION audit.eu_expired_event_v1(uuid,text,uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.eu_expired_event_v1(uuid,text,uuid,uuid,text,text,text) TO c4g_opportunity_central_owner;

-- FORCE RLS also applies to the audit owner. Admit only the two critical
-- platform decisions used by this exact verifier. The existing organizational
-- policy remains unchanged; no caller gains general SELECT or BYPASSRLS.
CREATE POLICY audit_eu_expired_read_v1 ON audit.event FOR SELECT TO c4g_audit_owner
 USING(current_user='c4g_audit_owner' AND organization_id IS NULL AND tenant_id IS NULL
  AND ledger_location='CENTRAL' AND stream_id='PLATFORM:OPERATIONS' AND stream_type='OPERATIONS'
  AND event_code='SENSITIVE_ACTION_ALLOWED' AND audit_class='CRITICAL_PRE_EFFECT'
  AND event_data->>'operationCode'='OPPORTUNITY_CENTRAL_MANAGE'
  AND event_data->>'source'='EU_EXPIRED_RECONCILIATION'
  AND event_data#>>'{resource,type}'='EU_EXPIRED_RECONCILIATION'
  AND event_data#>>'{payload,policyVersion}'='eu-expired-reconciliation-v1'
  AND event_data#>>'{payload,detailCode}' IN ('EU_EXPIRED_RECONCILIATION_APPROVED','EU_EXPIRED_RECONCILIATION_APPLIED')
  AND event_data->>'decision'='ACCEPT' AND event_data->>'outcome'='SUCCESS');

CREATE FUNCTION opportunity_catalog.allow_eu_expired_effect_v1(p_table text,p_operation text,p_new jsonb,p_old jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE permit opportunity_catalog.eu_expired_permit_v1%ROWTYPE; key text; source opportunity_catalog.eu_source_control_v2%ROWTYPE;
BEGIN
 IF p_operation<>'UPDATE' OR p_table NOT IN ('funding_run','funding_cycle','inbox','execution') THEN RETURN false; END IF;
 SELECT * INTO permit FROM opportunity_catalog.eu_expired_permit_v1 WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();IF NOT FOUND THEN RETURN false; END IF;
 key:=CASE p_table WHEN 'funding_run' THEN 'run' WHEN 'funding_cycle' THEN 'cycle' ELSE p_table END;
 SELECT * INTO STRICT source FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS' FOR SHARE;
 IF source.state<>'QUIESCED' OR source.fence<>permit.source_fence OR permit.authority_not_after<=clock_timestamp() THEN RAISE EXCEPTION 'OPPORTUNITY_V2_RECONCILIATION_STATE_CHANGED'; END IF;
 RETURN p_old=permit.before_state->key AND p_new=permit.after_rows->key;
END $$;
ALTER FUNCTION opportunity_catalog.allow_eu_expired_effect_v1(text,text,jsonb,jsonb) OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON FUNCTION opportunity_catalog.allow_eu_expired_effect_v1(text,text,jsonb,jsonb) FROM PUBLIC;

CREATE FUNCTION opportunity_catalog.eu_expired_preview_v1(p_cycle uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $preview$
SELECT to_jsonb(value) FROM (WITH pending AS (
 SELECT r.* FROM opportunity_catalog.funding_run r JOIN opportunity_catalog.funding_batch b USING(run_id)
 WHERE b.cycle_id=p_cycle AND r.status IN ('QUEUED','RUNNING')
), chosen AS (SELECT * FROM pending WHERE (SELECT count(*) FROM pending)=1),
published AS (SELECT o.* FROM async_exec.outbox o JOIN chosen r ON o.envelope#>>'{payload,runId}'=r.run_id::text WHERE o.organization_id IS NULL),
payload AS (SELECT jsonb_build_object(
 'cycleId',p_cycle::text,'source',opportunity_catalog.eu_source_state_v2(),
 'run',(SELECT to_jsonb(r) FROM chosen r),
 'cycle',(SELECT to_jsonb(c) FROM opportunity_catalog.funding_cycle c WHERE c.cycle_id=p_cycle),
 'batch',(SELECT to_jsonb(b) FROM opportunity_catalog.funding_batch b JOIN chosen r USING(run_id)),
 'inbox',(SELECT to_jsonb(i) FROM async_exec.inbox i JOIN chosen r ON i.idempotency_key=r.run_id::text WHERE i.organization_id IS NULL AND i.consumer='funding-central-v1' AND i.job_type='funding_tenders.refresh'),
 'outbox',(SELECT to_jsonb(o) FROM published o),
 'execution',(SELECT to_jsonb(e) FROM async_exec.execution e JOIN published o ON e.execution_id=(o.envelope->>'executionId')::uuid WHERE e.organization_id IS NULL),
 'expiry',jsonb_build_object(
 'runExpired',(SELECT r.created_at+interval '5 minutes'<=clock_timestamp() FROM chosen r),
 'runLeaseExpired',(SELECT r.lease_until IS NULL OR r.lease_until<=clock_timestamp() FROM chosen r),
 'inboxLeaseExpired',(SELECT i.lease_until IS NULL OR i.lease_until<=clock_timestamp() FROM async_exec.inbox i JOIN chosen r ON i.idempotency_key=r.run_id::text WHERE i.organization_id IS NULL AND i.consumer='funding-central-v1' AND i.job_type='funding_tenders.refresh'),
 'executionExpired',(SELECT e.deadline_at<=clock_timestamp() AND (e.lease_until IS NULL OR e.lease_until<=clock_timestamp()) FROM async_exec.execution e JOIN published o ON e.execution_id=(o.envelope->>'executionId')::uuid),
 'envelopeExpired',(SELECT (o.envelope->>'deadlineAt')::timestamptz<=clock_timestamp() FROM published o)),
 'counts',jsonb_build_object('pendingInCycle',(SELECT count(*) FROM pending),'outboxes',(SELECT count(*) FROM published),
 'successors',(SELECT count(*) FROM async_exec.execution e JOIN published o ON e.previous_execution_id=(o.envelope->>'executionId')::uuid)),
 'preservation',jsonb_build_object(
 'targets',(SELECT jsonb_build_object('count',count(*),'digest',encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.external_identifier),'[]'::jsonb)::text,'UTF8')),'hex')) FROM opportunity_catalog.funding_refresh_target t WHERE t.cycle_id=p_cycle),
 'archives',(SELECT jsonb_build_object('count',count(*),'digest',encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.run_id,a.external_identifier),'[]'::jsonb)::text,'UTF8')),'hex')) FROM opportunity_catalog.funding_candidate_v2 a JOIN opportunity_catalog.funding_batch b USING(run_id) WHERE b.cycle_id=p_cycle),
 'decisions',(SELECT jsonb_build_object('count',count(*),'digest',encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.run_id,d.external_identifier),'[]'::jsonb)::text,'UTF8')),'hex')) FROM opportunity_catalog.eu_writer_decision_v2 d JOIN opportunity_catalog.funding_batch b USING(run_id) WHERE b.cycle_id=p_cycle),
 'heads',(SELECT jsonb_build_object('count',count(*),'digest',encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.opportunity_id),'[]'::jsonb)::text,'UTF8')),'hex')) FROM opportunity_catalog.opportunity o),
 'revisions',(SELECT jsonb_build_object('count',count(*),'digest',encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.revision_id),'[]'::jsonb)::text,'UTF8')),'hex')) FROM opportunity_catalog.revision r)
 ),'proposedChanges','{"runStatus":"ERROR","cycleStatus":"ERROR","errorCode":"FUNDING_EXECUTION_EXPIRED","inboxState":"FAILED","inboxResult":"EXPIRED","executionState":"EXPIRED","outboxState":"PUBLISHED","targetsChanged":false}'::jsonb) AS preview)
SELECT preview,encode(sha256(convert_to(preview::text,'UTF8')),'hex') AS preview_digest,clock_timestamp() AS observed_at FROM payload) value;
$preview$;
ALTER FUNCTION opportunity_catalog.eu_expired_preview_v1(uuid) OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON FUNCTION opportunity_catalog.eu_expired_preview_v1(uuid) FROM PUBLIC;

CREATE FUNCTION opportunity_catalog.reconcile_eu_expired_v1(p_plan uuid,p_request uuid,p_actor uuid,p_sid text,p_preview jsonb,p_preview_digest text,p_plan_text text,p_approval uuid,p_approval_hash text,p_effect uuid,p_effect_hash text,p_not_after timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE auth jsonb; v jsonb; source jsonb; before_value jsonb; after_value jsonb; plan_value jsonb; p_plan_digest text; row_run opportunity_catalog.funding_run%ROWTYPE;
 row_cycle opportunity_catalog.funding_cycle%ROWTYPE; row_inbox async_exec.inbox%ROWTYPE; row_execution async_exec.execution%ROWTYPE;
 existing opportunity_catalog.eu_expired_reconciliation_v1%ROWTYPE; now_at timestamptz; deadline timestamptz; approval_at timestamptz; effect_at timestamptz; result_value jsonb;
BEGIN
 IF p_plan_text IS NULL OR octet_length(p_plan_text)>4194304 THEN RAISE EXCEPTION 'OPPORTUNITY_V2_RECONCILIATION_CHANGED'; END IF;
 plan_value:=p_plan_text::jsonb;p_plan_digest:=encode(sha256(convert_to(p_plan_text,'UTF8')),'hex');
 IF jsonb_typeof(plan_value) IS DISTINCT FROM 'object' OR plan_value->>'kind' IS DISTINCT FROM 'eu-expired-reconciliation-plan-v1'
 OR plan_value->>'planId' IS DISTINCT FROM p_plan::text OR plan_value->'preview' IS DISTINCT FROM p_preview OR plan_value->>'previewDigest' IS DISTINCT FROM p_preview_digest
 OR (plan_value->>'expiresAt')::timestamptz IS DISTINCT FROM p_not_after OR (plan_value->>'createdAt')::timestamptz>clock_timestamp()+interval '5 seconds'
 OR p_not_after>(plan_value->>'createdAt')::timestamptz+interval '1 hour' OR p_not_after<=(plan_value->>'createdAt')::timestamptz THEN RAISE EXCEPTION 'OPPORTUNITY_V2_RECONCILIATION_CHANGED'; END IF;
 LOCK TABLE opportunity_catalog.funding_run IN EXCLUSIVE MODE;
 SELECT authority INTO STRICT auth FROM authority_api.opportunity_v2_administrator(p_sid,p_actor);
 now_at:=clock_timestamp();
 IF auth->>'userId' IS DISTINCT FROM p_actor::text OR auth->>'storedUserId' IS DISTINCT FROM p_actor::text
 OR auth->'revocationVersion' IS DISTINCT FROM auth->'storedRevocationVersion' OR auth->>'policyVersion' IS DISTINCT FROM 'c4g-user-mfa-v1'
 OR auth#>>'{evidence,policyVersion}' IS DISTINCT FROM 'c4g-user-mfa-v1' OR jsonb_typeof(auth#>'{evidence,authTime}') IS DISTINCT FROM 'number'
 OR jsonb_typeof(auth->'absoluteExpiresAt') IS DISTINCT FROM 'number' OR jsonb_typeof(auth->'expiresAt') IS DISTINCT FROM 'number'
 OR (auth#>>'{evidence,authTime}')::numeric>extract(epoch FROM now_at) OR (auth#>>'{evidence,authTime}')::numeric+300<=extract(epoch FROM now_at)
 OR (auth->>'absoluteExpiresAt')::numeric<=extract(epoch FROM now_at)*1000 OR (auth->>'expiresAt')::numeric<=extract(epoch FROM now_at)*1000
 OR (auth->>'cookieExpires' IS NOT NULL AND (auth->>'cookieExpires')::timestamptz<=now_at)
 OR p_not_after IS NULL OR p_not_after<=now_at OR p_not_after>now_at+interval '1 hour' OR p_effect IS DISTINCT FROM p_request
 OR p_preview_digest !~ '^[a-f0-9]{64}$' OR p_plan_digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'OPPORTUNITY_V2_RECONCILIATION_APPROVAL_REQUIRED'; END IF;
 deadline:=LEAST(p_not_after,to_timestamp((auth#>>'{evidence,authTime}')::double precision+300),to_timestamp((auth->>'absoluteExpiresAt')::double precision/1000),to_timestamp((auth->>'expiresAt')::double precision/1000),COALESCE((auth->>'cookieExpires')::timestamptz,p_not_after));
 approval_at:=audit.eu_expired_event_v1(p_approval,p_approval_hash,p_actor,p_plan,p_preview_digest,p_plan_digest,'EU_EXPIRED_RECONCILIATION_APPROVED');
 effect_at:=audit.eu_expired_event_v1(p_effect,p_effect_hash,p_actor,p_plan,p_preview_digest,p_plan_digest,'EU_EXPIRED_RECONCILIATION_APPLIED');
 IF approval_at>effect_at OR approval_at<now_at-interval '1 hour' THEN RAISE EXCEPTION 'OPPORTUNITY_V2_RECONCILIATION_APPROVAL_REQUIRED'; END IF;
 PERFORM family FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS' FOR SHARE;
 source:=opportunity_catalog.eu_source_state_v2();
 IF source->>'state'<>'QUIESCED' OR source->'fence' IS DISTINCT FROM p_preview#>'{source,fence}'
 OR (source->>'activeRunLeases')::integer<>0 OR (source->>'activeInboxLeases')::integer<>0 OR (source->>'activeOutboxLeases')::integer<>0 OR (source->>'otherPendingRuns')::integer<>0 THEN RAISE EXCEPTION 'OPPORTUNITY_V2_RECONCILIATION_STATE_CHANGED'; END IF;
 SELECT * INTO existing FROM opportunity_catalog.eu_expired_reconciliation_v1 WHERE plan_id=p_plan OR request_id=p_request OR run_id=(p_preview#>>'{run,run_id}')::uuid;
 IF FOUND THEN
  IF existing.plan_id<>p_plan OR existing.request_id<>p_request OR existing.actor_id<>p_actor OR existing.preview_digest<>p_preview_digest OR existing.plan_digest<>p_plan_digest OR existing.approval_event_id<>p_approval OR existing.approval_event_hash<>p_approval_hash OR existing.effect_event_id<>p_effect OR existing.effect_event_hash<>p_effect_hash THEN RAISE EXCEPTION 'OPPORTUNITY_V2_RECONCILIATION_CHANGED'; END IF;
  RETURN jsonb_build_object('replayed',true,'result',existing.result);
 END IF;
 PERFORM 1 FROM opportunity_catalog.funding_cycle WHERE cycle_id=(p_preview->>'cycleId')::uuid FOR UPDATE;
 PERFORM 1 FROM async_exec.outbox WHERE outbox_id=(p_preview#>>'{outbox,outbox_id}')::uuid FOR UPDATE;
 PERFORM 1 FROM async_exec.inbox WHERE consumer='funding-central-v1' AND organization_id IS NULL AND job_type='funding_tenders.refresh' AND idempotency_key=p_preview#>>'{run,run_id}' FOR UPDATE;
 PERFORM 1 FROM async_exec.execution WHERE execution_id=(p_preview#>>'{execution,execution_id}')::uuid FOR UPDATE;
 v:=opportunity_catalog.eu_expired_preview_v1((p_preview->>'cycleId')::uuid);before_value:=v->'preview';
 IF before_value IS DISTINCT FROM p_preview OR v->>'preview_digest' IS DISTINCT FROM p_preview_digest
 OR p_preview#>>'{source,writerMode}'<>'CANONICAL_V2' OR p_preview#>>'{source,pendingRuns}'<>'1' OR p_preview#>>'{source,expiredPendingRuns}'<>'1' OR p_preview#>>'{source,unrecoverablePendingRuns}'<>'1'
 OR p_preview#>>'{source,incompatiblePendingRuns}'<>'0' OR p_preview#>>'{run,source_code}'<>'EU_FUNDING_TENDERS' OR p_preview#>>'{run,status}'<>'RUNNING' OR p_preview#>>'{run,eu_source_held}'<>'true'
 OR p_preview#>>'{run,eu_writer_mode}'<>'CANONICAL_V2' OR p_preview#>'{run,eu_writer_policy}' IS DISTINCT FROM p_preview#>'{source,writerPolicy}' OR p_preview#>'{run,eu_writer_mapping_digest}' IS DISTINCT FROM p_preview#>'{source,writerMappingDigest}'
 OR p_preview#>>'{cycle,status}'<>'RUNNING' OR p_preview#>>'{batch,cycle_id}'<>p_preview->>'cycleId' OR p_preview#>'{batch,run_id}' IS DISTINCT FROM p_preview#>'{run,run_id}'
 OR p_preview->'expiry'<>'{"runExpired":true,"runLeaseExpired":true,"inboxLeaseExpired":true,"executionExpired":true,"envelopeExpired":true}'::jsonb
 OR p_preview->'counts'<>'{"pendingInCycle":1,"outboxes":1,"successors":0}'::jsonb
 OR p_preview#>>'{outbox,state}'<>'PUBLISHED' OR p_preview#>>'{inbox,state}'<>'PROCESSING' OR p_preview#>>'{inbox,consumer}'<>'funding-central-v1'
 OR p_preview#>>'{execution,state}' NOT IN ('QUEUED','CLAIMED','RUNNING','RETRY_WAIT')
 OR p_preview#>'{inbox,execution_id}' IS DISTINCT FROM p_preview#>'{execution,execution_id}' OR p_preview#>'{outbox,envelope,executionId}' IS DISTINCT FROM p_preview#>'{execution,execution_id}'
 OR p_preview#>'{inbox,digest_sha256}' IS DISTINCT FROM p_preview#>'{outbox,digest_sha256}' OR p_preview#>'{execution,content_digest}' IS DISTINCT FROM p_preview#>'{outbox,digest_sha256}'
 OR p_preview#>'{execution,content_digest}' IS DISTINCT FROM p_preview#>'{outbox,content_digest}' OR p_preview#>'{execution,envelope_digest}' IS DISTINCT FROM p_preview#>'{outbox,envelope_digest}'
 OR (p_preview#>>'{execution,deadline_at}')::timestamptz IS DISTINCT FROM (p_preview#>>'{outbox,envelope,deadlineAt}')::timestamptz
 OR p_preview#>'{execution,job_type}' IS DISTINCT FROM p_preview#>'{outbox,envelope,jobType}'
 OR (p_preview#>'{execution,outbox_id}' IS DISTINCT FROM p_preview#>'{outbox,outbox_id}' AND NOT (p_preview#>'{execution,outbox_id}'='null'::jsonb AND p_preview#>>'{execution,delivery_kind}'='INITIAL' AND p_preview#>>'{execution,lineage_version}'='1' AND p_preview#>>'{execution,attempt}'='1' AND p_preview#>'{execution,root_execution_id}'=p_preview#>'{execution,execution_id}' AND p_preview#>'{execution,previous_execution_id}'='null'::jsonb AND p_preview#>'{execution,replay_request_id}'='null'::jsonb))
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['content_digest','envelope_digest','lineage_version','attempt','delivery_kind','root_execution_id','previous_execution_id','replay_request_id']) k WHERE p_preview->'execution'->k IS DISTINCT FROM p_preview->'outbox'->k)
 THEN RAISE EXCEPTION 'OPPORTUNITY_V2_RECONCILIATION_STATE_CHANGED'; END IF;
 now_at:=clock_timestamp();
 row_run:=jsonb_populate_record(NULL::opportunity_catalog.funding_run,p_preview->'run');row_run.status:='ERROR';row_run.error_code:='FUNDING_EXECUTION_EXPIRED';row_run.finished_at:=now_at;row_run.lease_until:=NULL;row_run.fence:=row_run.fence+1;
 row_cycle:=jsonb_populate_record(NULL::opportunity_catalog.funding_cycle,p_preview->'cycle');row_cycle.status:='ERROR';row_cycle.error_code:='FUNDING_EXECUTION_EXPIRED';row_cycle.finished_at:=now_at;
 row_inbox:=jsonb_populate_record(NULL::async_exec.inbox,p_preview->'inbox');row_inbox.state:='FAILED';row_inbox.result_code:='EXPIRED';row_inbox.lease_until:=NULL;row_inbox.completed_at:=now_at;row_inbox.fence:=row_inbox.fence+1;
 row_execution:=jsonb_populate_record(NULL::async_exec.execution,p_preview->'execution');row_execution.state:='EXPIRED';row_execution.result_code:='EXPIRED';row_execution.lease_until:=NULL;row_execution.updated_at:=now_at;row_execution.fence:=row_execution.fence+1;
 after_value:=jsonb_build_object('run',to_jsonb(row_run),'cycle',to_jsonb(row_cycle),'inbox',to_jsonb(row_inbox),'execution',to_jsonb(row_execution));
 INSERT INTO opportunity_catalog.eu_expired_permit_v1(plan_id,request_id,actor_id,transaction_id,backend_pid,source_fence,run_id,cycle_id,preview_digest,plan_digest,before_state,after_rows,authority_not_after,approval_event_id,approval_event_hash,effect_event_id,effect_event_hash)
 VALUES(p_plan,p_request,p_actor,txid_current(),pg_backend_pid(),(source->>'fence')::integer,row_run.run_id,row_cycle.cycle_id,p_preview_digest,p_plan_digest,p_preview,after_value,deadline,p_approval,p_approval_hash,p_effect,p_effect_hash);
 UPDATE opportunity_catalog.funding_run SET status=row_run.status,error_code=row_run.error_code,finished_at=row_run.finished_at,lease_until=NULL,fence=row_run.fence WHERE run_id=row_run.run_id;
 UPDATE opportunity_catalog.funding_cycle SET status=row_cycle.status,error_code=row_cycle.error_code,finished_at=row_cycle.finished_at WHERE cycle_id=row_cycle.cycle_id;
 UPDATE async_exec.inbox SET state=row_inbox.state,result_code=row_inbox.result_code,lease_until=NULL,completed_at=row_inbox.completed_at,fence=row_inbox.fence WHERE consumer=row_inbox.consumer AND job_type=row_inbox.job_type AND job_version=row_inbox.job_version AND organization_id IS NULL AND idempotency_key=row_inbox.idempotency_key;
 UPDATE async_exec.execution SET state=row_execution.state,result_code=row_execution.result_code,lease_until=NULL,updated_at=row_execution.updated_at,fence=row_execution.fence WHERE execution_id=row_execution.execution_id;
 result_value:=p_preview->'proposedChanges'||jsonb_build_object('source',jsonb_build_object('state','QUIESCED','fence',source->'fence'),'pendingRuns',0);
 INSERT INTO opportunity_catalog.eu_expired_reconciliation_v1(plan_id,request_id,actor_id,run_id,cycle_id,source_fence,preview_digest,plan_digest,approval_event_id,approval_event_hash,effect_event_id,effect_event_hash,result)
 VALUES(p_plan,p_request,p_actor,row_run.run_id,row_cycle.cycle_id,(source->>'fence')::integer,p_preview_digest,p_plan_digest,p_approval,p_approval_hash,p_effect,p_effect_hash,result_value);
 RETURN jsonb_build_object('replayed',false,'result',result_value);
 EXCEPTION WHEN no_data_found THEN RAISE EXCEPTION 'OPPORTUNITY_V2_RECONCILIATION_APPROVAL_REQUIRED';
END $$;
ALTER FUNCTION opportunity_catalog.reconcile_eu_expired_v1(uuid,uuid,uuid,text,jsonb,text,text,uuid,text,uuid,text,timestamptz) OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON FUNCTION opportunity_catalog.reconcile_eu_expired_v1(uuid,uuid,uuid,text,jsonb,text,text,uuid,text,uuid,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opportunity_catalog.reconcile_eu_expired_v1(uuid,uuid,uuid,text,jsonb,text,text,uuid,text,uuid,text,timestamptz) TO c4g_eu_reconciliation_runtime;

CREATE FUNCTION opportunity_catalog.guard_eu_expired_commit_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p opportunity_catalog.eu_expired_permit_v1%ROWTYPE; current_state jsonb; source jsonb;
BEGIN
 SELECT * INTO STRICT p FROM opportunity_catalog.eu_expired_permit_v1 WHERE plan_id=NEW.plan_id;
 IF p.transaction_id<>txid_current() OR p.backend_pid<>pg_backend_pid() OR p.authority_not_after<=clock_timestamp() THEN RAISE EXCEPTION 'OPPORTUNITY_V2_RECONCILIATION_APPROVAL_REQUIRED'; END IF;
 source:=opportunity_catalog.eu_source_state_v2();
 IF source->>'state'<>'QUIESCED' OR (source->>'fence')::integer<>p.source_fence OR (source->>'pendingRuns')::integer<>0 OR (source->>'activeRunLeases')::integer<>0 OR (source->>'activeInboxLeases')::integer<>0 OR (source->>'activeOutboxLeases')::integer<>0 THEN RAISE EXCEPTION 'OPPORTUNITY_V2_RECONCILIATION_STATE_CHANGED'; END IF;
 current_state:=jsonb_build_object('run',(SELECT to_jsonb(r) FROM opportunity_catalog.funding_run r WHERE r.run_id=p.run_id),'cycle',(SELECT to_jsonb(c) FROM opportunity_catalog.funding_cycle c WHERE c.cycle_id=p.cycle_id),'inbox',(SELECT to_jsonb(i) FROM async_exec.inbox i WHERE i.consumer='funding-central-v1' AND i.job_type='funding_tenders.refresh' AND i.organization_id IS NULL AND i.idempotency_key=p.run_id::text),'execution',(SELECT to_jsonb(e) FROM async_exec.execution e WHERE e.execution_id=(p.before_state#>>'{execution,execution_id}')::uuid));
 IF current_state IS DISTINCT FROM p.after_rows OR (SELECT to_jsonb(o) FROM async_exec.outbox o WHERE o.outbox_id=(p.before_state#>>'{outbox,outbox_id}')::uuid) IS DISTINCT FROM p.before_state->'outbox'
 OR opportunity_catalog.eu_expired_preview_v1(p.cycle_id)#>'{preview,preservation}' IS DISTINCT FROM p.before_state->'preservation' THEN RAISE EXCEPTION 'OPPORTUNITY_V2_RECONCILIATION_STATE_CHANGED'; END IF;
 PERFORM audit.eu_expired_event_v1(p.effect_event_id,p.effect_event_hash,p.actor_id,p.plan_id,p.preview_digest,p.plan_digest,'EU_EXPIRED_RECONCILIATION_APPLIED');RETURN NEW;
END $$;
ALTER FUNCTION opportunity_catalog.guard_eu_expired_commit_v1() OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON FUNCTION opportunity_catalog.guard_eu_expired_commit_v1() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER eu_expired_commit AFTER INSERT ON opportunity_catalog.eu_expired_reconciliation_v1 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_eu_expired_commit_v1();

CREATE OR REPLACE FUNCTION opportunity_catalog.guard_eu_write_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j jsonb; oldj jsonb; src text; rid uuid; oid uuid; run_fence integer; current_fence integer; is_v2 boolean:=false; is_eu boolean:=false; c opportunity_catalog.eu_source_control_v2%ROWTYPE;
BEGIN
 IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'OPPORTUNITY_V2_SOURCE_CONTROL_INVALID'; END IF;
 j:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 oldj:=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE j END;
 IF opportunity_catalog.allow_eu_expired_effect_v1(TG_TABLE_NAME,TG_OP,j,oldj) THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='funding_run' THEN
   src:=j->>'source_code';
   IF TG_OP='UPDATE' AND NEW.eu_writer_mode='CANONICAL_V2'
   AND NOT ((j-'eu_source_held')=(oldj-'eu_source_held') AND NEW.eu_source_held IS DISTINCT FROM OLD.eu_source_held)
   AND NOT (OLD.status IN ('QUEUED','RUNNING') AND NEW.status='ERROR' AND NEW.error_code='FUNDING_EXECUTION_EXPIRED' AND NEW.fence=OLD.fence+1 AND NEW.lease_until IS NULL AND NEW.finished_at IS NOT NULL AND (OLD.lease_until IS NULL OR OLD.lease_until<=clock_timestamp()) AND OLD.created_at+interval '5 minutes'<=clock_timestamp() AND (j-ARRAY['status','error_code','finished_at','lease_until','fence','eu_source_fence'])=(oldj-ARRAY['status','error_code','finished_at','lease_until','fence','eu_source_fence']))
   AND NOT EXISTS(SELECT 1 FROM opportunity_catalog.eu_writer_execution_v2 e WHERE e.transaction_id=txid_current() AND e.backend_pid=pg_backend_pid() AND e.run_id=NEW.run_id AND e.run_fence=NEW.fence) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
   IF TG_OP='UPDATE' AND (NEW.eu_writer_mode,NEW.eu_writer_policy,NEW.eu_writer_mapping_digest) IS DISTINCT FROM (OLD.eu_writer_mode,OLD.eu_writer_policy,OLD.eu_writer_mapping_digest) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_CONFIGURATION_INVALID'; END IF;
   IF src IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') THEN
    SELECT * INTO STRICT c FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS' FOR SHARE;
    IF (j->>'eu_writer_mode',j->>'eu_writer_policy',j->>'eu_writer_mapping_digest') IS DISTINCT FROM (c.eu_writer_mode,c.eu_writer_policy,c.eu_writer_mapping_digest) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_REQUIRED'; END IF;
   END IF;
   IF TG_OP='UPDATE' AND (j-'eu_source_held')=(oldj-'eu_source_held') AND j->'eu_source_held' IS DISTINCT FROM oldj->'eu_source_held' THEN
     SELECT * INTO STRICT c FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS' FOR SHARE;
     IF src NOT IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') OR NEW.eu_source_held IS DISTINCT FROM (c.state<>'ACTIVE') THEN RAISE EXCEPTION 'OPPORTUNITY_V2_SOURCE_CONTROL_INVALID'; END IF;
     RETURN NEW;
   END IF;
   IF oldj->>'source_code' IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') OR src IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') THEN
     IF TG_OP='UPDATE' AND src IS DISTINCT FROM oldj->>'source_code' THEN RAISE EXCEPTION 'OPPORTUNITY_V2_SOURCE_CONTROL_INVALID'; END IF;
     current_fence:=opportunity_catalog.assert_eu_active_v2('EU_FUNDING_TENDERS');
     IF TG_OP='UPDATE' AND NEW.eu_source_held THEN RAISE EXCEPTION 'OPPORTUNITY_V2_SOURCE_CONTROL_INVALID'; END IF;
     IF TG_OP='INSERT' THEN NEW.eu_source_fence:=current_fence; NEW.eu_source_held:=false;
     ELSIF TG_OP='UPDATE' AND OLD.status IN ('QUEUED','RUNNING') AND NEW.status='ERROR' AND NEW.error_code='FUNDING_EXECUTION_EXPIRED'
       AND NEW.fence=OLD.fence+1 AND NEW.lease_until IS NULL AND NEW.finished_at IS NOT NULL
       AND (OLD.lease_until IS NULL OR OLD.lease_until<=clock_timestamp()) AND OLD.created_at+interval '5 minutes'<=clock_timestamp()
       AND (j-ARRAY['status','error_code','finished_at','lease_until','fence','eu_source_fence'])=(oldj-ARRAY['status','error_code','finished_at','lease_until','fence','eu_source_fence']) THEN NEW.eu_source_fence:=current_fence;
     ELSIF TG_OP='UPDATE' AND OLD.status IN ('QUEUED','RUNNING') AND NEW.status='RUNNING' AND NEW.fence=OLD.fence+1
       AND (OLD.lease_until IS NULL OR OLD.lease_until<=clock_timestamp()) AND NEW.lease_until>clock_timestamp()
       AND NEW.started_at IS NOT NULL AND (OLD.started_at IS NULL OR NEW.started_at=OLD.started_at)
       AND (j-ARRAY['status','started_at','lease_until','fence','eu_source_fence'])=(oldj-ARRAY['status','started_at','lease_until','fence','eu_source_fence']) THEN NEW.eu_source_fence:=current_fence;
     ELSIF TG_OP='UPDATE' AND NEW.fence IS DISTINCT FROM OLD.fence THEN RAISE EXCEPTION 'OPPORTUNITY_V2_SOURCE_CONTROL_INVALID';
     ELSIF (j->>'eu_source_fence')::integer IS DISTINCT FROM current_fence OR (oldj->>'eu_source_fence')::integer IS DISTINCT FROM current_fence THEN RAISE EXCEPTION 'OPPORTUNITY_V2_SOURCE_FENCE_STALE'; END IF;
   END IF;
   RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 ELSIF TG_TABLE_NAME IN ('outbox','inbox','execution','dead_letter') THEN
   IF j->>'organization_id' IS NOT NULL THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
   IF TG_TABLE_NAME='outbox' THEN
     IF j#>>'{envelope,jobType}'<>'funding_tenders.refresh' THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
     rid:=NULLIF(j#>>'{envelope,payload,runId}','')::uuid;
   ELSIF TG_TABLE_NAME='inbox' THEN
     IF j->>'job_type'<>'funding_tenders.refresh' THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
     SELECT run_id INTO rid FROM opportunity_catalog.funding_run WHERE run_id::text=j->>'idempotency_key';
   ELSE
     IF j->>'job_type'<>'funding_tenders.refresh' THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
     SELECT NULLIF(o.envelope#>>'{payload,runId}','')::uuid INTO rid FROM async_exec.outbox o WHERE o.envelope->>'executionId'=j->>'execution_id' LIMIT 1;
   END IF;
 ELSIF TG_TABLE_NAME IN ('funding_run_item','funding_observation','funding_candidate_v2','funding_batch') THEN rid:=(j->>'run_id')::uuid;
 ELSIF TG_TABLE_NAME IN ('funding_cycle','funding_cycle_seen','funding_refresh_target') THEN rid:=(j->>'cycle_id')::uuid;
 ELSIF TG_TABLE_NAME IN ('funding_identity','funding_resolution') THEN is_eu:=j->>'external_identifier' !~ '^(INTERREG_EUROPE|POCTEP):2021-2027:CALL:[1-9][0-9]{0,2}$';
 ELSIF TG_TABLE_NAME='provenance' THEN is_eu:=j->>'source_namespace'='EU_FUNDING_TENDERS';
 ELSIF TG_TABLE_NAME IN ('source_identity_v2','source_observation_v2') THEN is_eu:=j->>'source_namespace'='EU_FUNDING_TENDERS'; is_v2:=true;
 ELSE
   oid:=(j->>'opportunity_id')::uuid;
   is_eu:=EXISTS(SELECT 1 FROM opportunity_catalog.funding_identity f WHERE f.opportunity_id=oid AND f.external_identifier !~ '^(INTERREG_EUROPE|POCTEP):2021-2027:CALL:[1-9][0-9]{0,2}$') OR EXISTS(SELECT 1 FROM opportunity_catalog.source_identity_v2 i WHERE i.opportunity_id=oid AND i.source_namespace='EU_FUNDING_TENDERS');
   IF TG_TABLE_NAME='revision' THEN is_v2:=j#>>'{snapshot,schemaVersion}'='2'; is_eu:=is_eu OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(j#>'{snapshot,sourceRecords}','[]'::jsonb)) x WHERE x->>'namespace'='EU_FUNDING_TENDERS');
   ELSE is_v2:=j->>'current_schema_version'='2'; END IF;
 END IF;
 IF rid IS NOT NULL THEN SELECT source_code,eu_source_fence INTO src,run_fence FROM opportunity_catalog.funding_run WHERE run_id=rid; is_eu:=src IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS'); END IF;
 IF is_eu THEN
   IF is_v2 THEN
     SELECT * INTO STRICT c FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS' FOR SHARE;
     IF c.state='ACTIVE' AND c.eu_writer_mode='CANONICAL_V2' THEN PERFORM opportunity_catalog.check_eu_writer_effect_v2(TG_TABLE_NAME,TG_OP,j,oldj);
     ELSE PERFORM opportunity_catalog.assert_eu_quiescent_v2(c.fence); END IF;
   ELSE
     current_fence:=opportunity_catalog.assert_eu_active_v2('EU_FUNDING_TENDERS');
     SELECT * INTO STRICT c FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS';
     IF c.eu_writer_mode='CANONICAL_V2' THEN
      IF TG_TABLE_NAME='funding_identity' THEN PERFORM opportunity_catalog.check_eu_writer_effect_v2(TG_TABLE_NAME,TG_OP,j,oldj);
      ELSIF TG_TABLE_NAME IN ('opportunity','revision','provenance','funding_resolution') THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_REQUIRED'; END IF;
      IF rid IS NOT NULL AND EXISTS(SELECT 1 FROM opportunity_catalog.funding_run r WHERE r.run_id=rid AND (r.eu_writer_mode<>c.eu_writer_mode OR r.eu_writer_policy IS DISTINCT FROM c.eu_writer_policy OR r.eu_writer_mapping_digest IS DISTINCT FROM c.eu_writer_mapping_digest)) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_REQUIRED'; END IF;
      IF rid IS NOT NULL AND TG_TABLE_NAME IN ('funding_run_item','funding_observation','funding_candidate_v2','funding_batch','funding_cycle','funding_cycle_seen','funding_refresh_target')
       AND NOT (TG_OP='INSERT' AND TG_TABLE_NAME IN ('funding_cycle','funding_batch','funding_refresh_target') AND EXISTS(SELECT 1 FROM opportunity_catalog.funding_run r WHERE r.run_id=rid AND r.status='QUEUED'))
       AND NOT (TG_OP='UPDATE' AND TG_TABLE_NAME='funding_cycle' AND j->'refresh_enabled'='true'::jsonb AND oldj->'refresh_enabled'='false'::jsonb AND (j-'refresh_enabled')=(oldj-'refresh_enabled') AND EXISTS(SELECT 1 FROM opportunity_catalog.funding_run r WHERE r.run_id=rid AND r.status='QUEUED'))
       AND NOT opportunity_catalog.eu_writer_terminal_cleanup_v2(TG_TABLE_NAME,TG_OP,j,oldj)
       AND NOT EXISTS(SELECT 1 FROM opportunity_catalog.eu_writer_execution_v2 e WHERE e.transaction_id=txid_current() AND e.backend_pid=pg_backend_pid() AND (e.run_id=rid OR EXISTS(SELECT 1 FROM opportunity_catalog.funding_batch b WHERE b.run_id=e.run_id AND b.cycle_id=rid))) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
     END IF;
     IF rid IS NOT NULL AND TG_TABLE_NAME IN ('funding_run_item','funding_observation','funding_candidate_v2','funding_batch') AND run_fence IS DISTINCT FROM current_fence THEN RAISE EXCEPTION 'OPPORTUNITY_V2_SOURCE_FENCE_STALE'; END IF;
   END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
