-- Additive 043. The registered 036--042 package remains byte-for-byte intact.
CREATE ROLE c4g_eu_writer_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA opportunity_catalog TO c4g_eu_writer_runtime;
ALTER TABLE opportunity_catalog.eu_source_control_v2 ADD COLUMN eu_writer_mode text NOT NULL DEFAULT 'LEGACY_V1' CHECK(eu_writer_mode IN ('LEGACY_V1','CANONICAL_V2')),
 ADD COLUMN eu_writer_policy text,ADD COLUMN eu_writer_mapping_digest text,
 ADD CONSTRAINT eu_source_writer_binding CHECK((eu_writer_mode='LEGACY_V1' AND eu_writer_policy IS NULL AND eu_writer_mapping_digest IS NULL) OR (eu_writer_mode='CANONICAL_V2' AND eu_writer_policy IS NOT NULL AND eu_writer_mapping_digest IS NOT NULL AND eu_writer_policy='eu-existing-v2.0' AND eu_writer_mapping_digest ~ '^[a-f0-9]{64}$'));
ALTER TABLE opportunity_catalog.funding_run ADD COLUMN eu_writer_mode text NOT NULL DEFAULT 'LEGACY_V1' CHECK(eu_writer_mode IN ('LEGACY_V1','CANONICAL_V2')),
 ADD COLUMN eu_writer_policy text,ADD COLUMN eu_writer_mapping_digest text,
 ADD COLUMN review_count integer NOT NULL DEFAULT 0 CHECK(review_count>=0),
 ADD CONSTRAINT funding_run_writer_binding CHECK((eu_writer_mode='LEGACY_V1' AND eu_writer_policy IS NULL AND eu_writer_mapping_digest IS NULL) OR (eu_writer_mode='CANONICAL_V2' AND source_code IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') AND eu_writer_policy IS NOT NULL AND eu_writer_mapping_digest IS NOT NULL AND eu_writer_policy='eu-existing-v2.0' AND eu_writer_mapping_digest ~ '^[a-f0-9]{64}$'));
ALTER TABLE opportunity_catalog.funding_cycle ADD COLUMN review_count integer NOT NULL DEFAULT 0 CHECK(review_count>=0);
-- A human-accepted v2 identity need not have legacy ingestion metadata.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM opportunity_catalog.funding_refresh_target t WHERE NOT EXISTS(SELECT 1 FROM opportunity_catalog.funding_identity f WHERE f.external_identifier=t.external_identifier)
 AND NOT EXISTS(SELECT 1 FROM opportunity_catalog.source_identity_v2 i JOIN opportunity_catalog.opportunity o USING(opportunity_id) WHERE i.source_namespace='EU_FUNDING_TENDERS' AND i.external_identifier=t.external_identifier AND o.current_schema_version=2)) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_TARGET_INVALID'; END IF;
END $$;
ALTER TABLE opportunity_catalog.funding_refresh_target DROP CONSTRAINT funding_refresh_target_external_identifier_fkey;
CREATE FUNCTION opportunity_catalog.guard_eu_writer_target_identity_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM opportunity_catalog.funding_identity WHERE external_identifier=NEW.external_identifier FOR KEY SHARE;
 IF FOUND THEN RETURN NEW; END IF;
 PERFORM 1 FROM opportunity_catalog.source_identity_v2 i JOIN opportunity_catalog.opportunity o USING(opportunity_id) WHERE i.source_namespace='EU_FUNDING_TENDERS' AND i.external_identifier=NEW.external_identifier AND o.current_schema_version=2 FOR KEY SHARE OF i,o;
 IF NOT FOUND THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_TARGET_INVALID' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION opportunity_catalog.guard_eu_writer_legacy_identity_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF (TG_OP='DELETE' OR NEW.external_identifier IS DISTINCT FROM OLD.external_identifier) AND EXISTS(SELECT 1 FROM opportunity_catalog.funding_refresh_target WHERE external_identifier=OLD.external_identifier) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_TARGET_INVALID' USING ERRCODE='23503'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER eu_writer_target_identity_guard BEFORE INSERT OR UPDATE OF external_identifier ON opportunity_catalog.funding_refresh_target FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_eu_writer_target_identity_v2();
CREATE TRIGGER eu_writer_legacy_identity_guard BEFORE DELETE OR UPDATE OF external_identifier ON opportunity_catalog.funding_identity FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_eu_writer_legacy_identity_v2();
ALTER TABLE opportunity_catalog.funding_run_item DROP CONSTRAINT funding_run_item_result_check;
ALTER TABLE opportunity_catalog.funding_run_item ADD CONSTRAINT funding_run_item_result_check CHECK(result IN ('CREATED','UPDATED','UNCHANGED','FAILED','REVIEW'));
ALTER TABLE opportunity_catalog.funding_refresh_target DROP CONSTRAINT funding_refresh_target_state_check;
ALTER TABLE opportunity_catalog.funding_refresh_target ADD CONSTRAINT funding_refresh_target_state_check CHECK(state IN ('PENDING','DISCOVERED','STAGED','CREATED','UNCHANGED','UPDATED','CONFLICT','ABSENT','ERROR','REVIEW'));
ALTER TABLE opportunity_catalog.eu_source_control_receipt_v2 DROP CONSTRAINT eu_source_control_receipt_v2_action_check;
ALTER TABLE opportunity_catalog.eu_source_control_receipt_v2 ADD CONSTRAINT eu_source_control_receipt_v2_action_check CHECK(action IN ('SUSPEND','QUIESCE','RESUME','CONFIGURE'));
GRANT UPDATE(eu_writer_mode,eu_writer_policy,eu_writer_mapping_digest) ON opportunity_catalog.eu_source_control_v2 TO c4g_opportunity_central_runtime;

CREATE TABLE opportunity_catalog.eu_writer_permit_v2 (
 permit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),transaction_id bigint NOT NULL,backend_pid integer NOT NULL,
 run_id uuid NOT NULL REFERENCES opportunity_catalog.funding_run(run_id),run_fence bigint NOT NULL,source_fence integer NOT NULL,
 execution_id uuid NOT NULL,inbox_fence bigint NOT NULL,worker_id text NOT NULL,consumer text NOT NULL CHECK(consumer='funding-central-v1'),
 policy_version text NOT NULL CHECK(policy_version='eu-existing-v2.0'),mapping_digest text NOT NULL CHECK(mapping_digest ~ '^[a-f0-9]{64}$'),
 external_identifier text NOT NULL,payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 opportunity_id uuid,revision_id uuid,row_version bigint,decision text NOT NULL CHECK(decision IN ('ACCEPTED','REVIEW')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(transaction_id,backend_pid),
 FOREIGN KEY(run_id,external_identifier) REFERENCES opportunity_catalog.funding_candidate_v2(run_id,external_identifier),
 CHECK((opportunity_id IS NULL AND revision_id IS NULL AND row_version IS NULL) OR (opportunity_id IS NOT NULL AND revision_id IS NOT NULL AND row_version>0)),
 CHECK(decision='REVIEW' OR opportunity_id IS NOT NULL)
);
CREATE TABLE opportunity_catalog.eu_writer_decision_v2 (
 run_id uuid NOT NULL REFERENCES opportunity_catalog.funding_run(run_id),external_identifier text NOT NULL,
 policy_version text NOT NULL CHECK(policy_version='eu-existing-v2.0'),mapping_digest text NOT NULL CHECK(mapping_digest ~ '^[a-f0-9]{64}$'),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),intent_digest text NOT NULL CHECK(intent_digest ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL CHECK(decision IN ('ACCEPTED','REVIEW')),reason_codes jsonb NOT NULL CHECK(jsonb_typeof(reason_codes)='array' AND octet_length(reason_codes::text)<=8192),
 expected jsonb,result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=32768),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(run_id,external_identifier),FOREIGN KEY(run_id,external_identifier) REFERENCES opportunity_catalog.funding_candidate_v2(run_id,external_identifier)
);
ALTER TABLE opportunity_catalog.eu_writer_permit_v2 OWNER TO c4g_opportunity_central_owner;
ALTER TABLE opportunity_catalog.eu_writer_decision_v2 OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON opportunity_catalog.eu_writer_permit_v2,opportunity_catalog.eu_writer_decision_v2 FROM PUBLIC,c4g_catalog_reader,c4g_eu_writer_runtime,c4g_opportunity_central_runtime;
GRANT SELECT,INSERT ON opportunity_catalog.eu_writer_decision_v2 TO c4g_opportunity_central_runtime;
CREATE TRIGGER eu_writer_permit_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.eu_writer_permit_v2 FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER eu_writer_permit_no_truncate BEFORE TRUNCATE ON opportunity_catalog.eu_writer_permit_v2 FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER eu_writer_decision_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.eu_writer_decision_v2 FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER eu_writer_decision_no_truncate BEFORE TRUNCATE ON opportunity_catalog.eu_writer_decision_v2 FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();

-- Async authority is a current administrative dispatch, never a fabricated session.
CREATE FUNCTION authority_api.eu_writer_administrator_v2(p_actor uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM public.global_user WHERE id=p_actor AND status='ACTIVE' FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.platform_admin_assignment WHERE global_user_id=p_actor AND role_code='C4G_ADMIN' AND status='ACTIVE' FOR SHARE;
 RETURN FOUND;
END $$;
CREATE FUNCTION opportunity_catalog.guard_eu_writer_projection_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j jsonb;oldj jsonb;c opportunity_catalog.eu_source_control_v2%ROWTYPE;
BEGIN
 IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 j:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;oldj:=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE j END;
 IF TG_TABLE_NAME='revision_allocation_concept_v2' THEN j:=j||jsonb_build_object('opportunity_id',(SELECT opportunity_id FROM opportunity_catalog.revision WHERE revision_id=(j->>'revision_id')::uuid));END IF;
 IF TG_TABLE_NAME='eu_writer_decision_v2' THEN PERFORM opportunity_catalog.check_eu_writer_effect_v2(TG_TABLE_NAME,TG_OP,j,oldj);
 ELSIF EXISTS(SELECT 1 FROM opportunity_catalog.source_identity_v2 WHERE opportunity_id=(j->>'opportunity_id')::uuid AND source_namespace='EU_FUNDING_TENDERS') THEN
  SELECT * INTO STRICT c FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS' FOR SHARE;
  IF c.state='ACTIVE' AND c.eu_writer_mode='CANONICAL_V2' THEN PERFORM opportunity_catalog.check_eu_writer_effect_v2(TG_TABLE_NAME,TG_OP,j,oldj);
  ELSE PERFORM opportunity_catalog.assert_eu_quiescent_v2(c.fence);END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
-- A permit is minted only through the dedicated worker role and applies to one
-- archived candidate in one database transaction. No caller-set GUC is trusted.
CREATE FUNCTION opportunity_catalog.check_eu_writer_effect_v2(p_table text,p_operation text,p_new jsonb,p_old jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p opportunity_catalog.eu_writer_permit_v2%ROWTYPE;a opportunity_catalog.funding_candidate_v2%ROWTYPE;r opportunity_catalog.revision%ROWTYPE;
BEGIN
 SELECT * INTO p FROM opportunity_catalog.eu_writer_permit_v2 WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 IF p.permit_id IS NULL OR p_operation='DELETE' THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 PERFORM opportunity_catalog.assert_eu_writer_permit_v2(p.permit_id);
 SELECT * INTO STRICT a FROM opportunity_catalog.funding_candidate_v2 WHERE run_id=p.run_id AND external_identifier=p.external_identifier;
 IF p_table='eu_writer_decision_v2' THEN
  IF p_operation<>'INSERT' OR p_new->>'run_id'<>p.run_id::text OR p_new->>'external_identifier'<>p.external_identifier OR p_new->>'payload_digest'<>p.payload_digest OR p_new->>'mapping_digest'<>p.mapping_digest OR p_new->>'policy_version'<>p.policy_version OR p_new->>'decision'<>p.decision THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
  RETURN;
 END IF;
 IF p.decision<>'ACCEPTED' OR p.opportunity_id IS NULL THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 IF p_table='source_observation_v2' THEN
  IF p_operation<>'INSERT' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.canonical_snapshot#>'{provenance,observations}') x JOIN jsonb_array_elements(a.canonical_snapshot->'sourceRecords') s ON s->>'key'=x->>'sourceRecordKey' WHERE x=p_new->'observation' AND s->>'namespace'=p_new->>'source_namespace' AND s->>'externalId'=p_new->>'external_identifier' AND x->>'artifactSha256'=p_new->>'artifact_sha256') THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
  RETURN;
 END IF;
 IF p_new->>'opportunity_id' IS DISTINCT FROM p.opportunity_id::text THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 IF p_table='revision' THEN
  IF p_operation<>'INSERT' OR p_new->'snapshot' IS DISTINCT FROM a.canonical_snapshot OR p_new->>'content_digest'<>a.content_digest OR (p_new->>'row_version')::bigint<>p.row_version+1 OR (p_new->>'revision_number')::bigint<>(SELECT revision_number+1 FROM opportunity_catalog.revision WHERE revision_id=p.revision_id) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 ELSIF p_table='opportunity' THEN
  IF p_operation<>'UPDATE' OR (p_new-ARRAY['current_revision_id','revision_number','row_version','current_schema_version','title','funder_name','programme_name','call_reference','official_url','opening_date','closing_date','quality_score','quality_bucket','content_digest','normalization_version','quality_rule_version','updated_at','last_v2_observed_at']) IS DISTINCT FROM (p_old-ARRAY['current_revision_id','revision_number','row_version','current_schema_version','title','funder_name','programme_name','call_reference','official_url','opening_date','closing_date','quality_score','quality_bucket','content_digest','normalization_version','quality_rule_version','updated_at','last_v2_observed_at']) OR p_new->>'current_schema_version'<>'2' THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
  SELECT * INTO r FROM opportunity_catalog.revision WHERE revision_id=(p_new->>'current_revision_id')::uuid AND opportunity_id=p.opportunity_id;
  IF r.revision_id IS NULL OR r.content_digest<>a.content_digest OR (p_new->>'row_version')::bigint<>r.row_version OR (p_new->>'revision_number')::bigint<>r.revision_number OR p_new->>'content_digest'<>r.content_digest OR (r.revision_id<>p.revision_id AND (r.snapshot IS DISTINCT FROM a.canonical_snapshot OR r.row_version<>p.row_version+1)) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 ELSIF p_table='funding_identity' THEN
  IF p_new->>'external_identifier'<>p.external_identifier OR p_new->>'last_run_id'<>p.run_id::text OR p_new->'corrections'<>'{}'::jsonb OR (p_operation='UPDATE' AND (p_new-ARRAY['last_source_fields','observed_at','last_run_id','source_review','source_reviewed_at']) IS DISTINCT FROM (p_old-ARRAY['last_source_fields','observed_at','last_run_id','source_review','source_reviewed_at'])) OR (p_operation='INSERT' AND (p_new->'conflicts'<>'[]'::jsonb OR NOT EXISTS(SELECT 1 FROM opportunity_catalog.source_identity_v2 WHERE source_namespace='EU_FUNDING_TENDERS' AND external_identifier=p.external_identifier AND opportunity_id=p.opportunity_id))) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 ELSIF p_table='source_identity_v2' THEN
  IF p_operation<>'INSERT' OR p_new->>'source_namespace'<>'EU_FUNDING_TENDERS' OR p_new->>'external_identifier'<>p.external_identifier THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 ELSE
  SELECT * INTO r FROM opportunity_catalog.revision WHERE revision_id=(p_new->>'revision_id')::uuid AND opportunity_id=p.opportunity_id;
  IF p_operation<>'INSERT' OR r.revision_id IS NULL OR r.content_digest<>a.content_digest OR (r.revision_id<>p.revision_id AND r.snapshot IS DISTINCT FROM a.canonical_snapshot) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 END IF;
END $$;
ALTER FUNCTION authority_api.eu_writer_administrator_v2(uuid) OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION authority_api.eu_writer_administrator_v2(uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA authority_api TO c4g_opportunity_central_owner;
GRANT EXECUTE ON FUNCTION authority_api.eu_writer_administrator_v2(uuid) TO c4g_opportunity_central_owner;
GRANT SELECT ON opportunity_catalog.funding_run TO c4g_opportunity_central_owner;
GRANT SELECT ON async_exec.inbox,async_exec.outbox TO c4g_opportunity_central_owner;
GRANT UPDATE(lease_until) ON async_exec.inbox TO c4g_opportunity_central_owner;

CREATE FUNCTION opportunity_catalog.check_eu_writer_execution_v2(p_run uuid,p_run_fence bigint,p_source_fence integer,p_execution uuid,p_inbox_fence bigint,p_worker text,p_consumer text,p_policy text,p_mapping text,p_claim boolean,p_retry boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r opportunity_catalog.funding_run%ROWTYPE;c opportunity_catalog.eu_source_control_v2%ROWTYPE;i async_exec.inbox%ROWTYPE;o async_exec.outbox%ROWTYPE;
BEGIN
 IF p_run IS NULL OR p_run_fence IS NULL OR p_run_fence<0 OR (NOT p_claim AND p_run_fence<1) OR p_source_fence IS NULL OR p_source_fence<1 OR p_execution IS NULL OR p_inbox_fence IS NULL OR p_inbox_fence<1 OR p_mapping IS NULL OR p_mapping !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 SELECT * INTO r FROM opportunity_catalog.funding_run WHERE run_id=p_run FOR SHARE;
 SELECT * INTO c FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS' FOR SHARE;
 IF r.run_id IS NULL OR r.source_code NOT IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') OR r.fence<>p_run_fence OR (p_claim AND (r.status NOT IN ('QUEUED','RUNNING') OR r.lease_until>clock_timestamp())) OR (NOT p_claim AND (r.status<>'RUNNING' OR r.lease_until IS NULL OR r.lease_until<=clock_timestamp()))
 OR r.eu_writer_mode<>'CANONICAL_V2' OR r.eu_writer_policy IS DISTINCT FROM p_policy OR r.eu_writer_mapping_digest IS DISTINCT FROM p_mapping
 OR c.state<>'ACTIVE' OR c.eu_writer_mode<>'CANONICAL_V2' OR c.eu_writer_policy IS DISTINCT FROM p_policy OR c.eu_writer_mapping_digest IS DISTINCT FROM p_mapping
 OR c.fence IS DISTINCT FROM p_source_fence OR (NOT p_claim AND r.eu_source_fence IS DISTINCT FROM p_source_fence) OR p_policy IS DISTINCT FROM 'eu-existing-v2.0'
 OR p_consumer IS DISTINCT FROM 'funding-central-v1' OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 128
 OR NOT authority_api.eu_writer_administrator_v2(r.requested_by) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 SELECT * INTO i FROM async_exec.inbox WHERE organization_id IS NULL AND consumer=p_consumer AND job_type='funding_tenders.refresh' AND job_version=1 AND idempotency_key=p_run::text FOR SHARE;
 IF i.state::text IS DISTINCT FROM (CASE WHEN p_retry THEN 'UNCERTAIN' ELSE 'PROCESSING' END) OR i.execution_id IS DISTINCT FROM p_execution OR i.claim_owner IS DISTINCT FROM p_worker OR i.fence IS DISTINCT FROM p_inbox_fence OR (NOT p_retry AND (i.lease_until IS NULL OR i.lease_until<=clock_timestamp())) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 SELECT * INTO o FROM async_exec.outbox WHERE organization_id IS NULL AND envelope->>'executionId'=p_execution::text AND envelope#>>'{payload,runId}'=p_run::text AND lineage_version=1 ORDER BY attempt DESC LIMIT 1 FOR SHARE;
 IF o.outbox_id IS NULL OR o.envelope->>'authority' IS DISTINCT FROM 'CENTRAL' OR o.envelope->>'jobType' IS DISTINCT FROM 'funding_tenders.refresh' OR o.envelope->>'operation' IS DISTINCT FROM 'opportunity.central.manage'
 OR o.envelope#>>'{actor,kind}' IS DISTINCT FROM 'SERVICE' OR o.envelope#>>'{actor,serviceActorCode}' IS DISTINCT FROM 'FUNDING_TENDERS_CENTRAL'
 OR o.envelope->>'idempotencyKey' IS DISTINCT FROM p_run::text OR (o.envelope->>'deadlineAt')::timestamptz<=clock_timestamp() OR o.content_digest IS DISTINCT FROM i.digest_sha256
 OR o.state NOT IN ('PUBLISHED','CLAIMED','PENDING','UNCERTAIN') THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 RETURN jsonb_build_object('runId',p_run,'runFence',p_run_fence,'sourceFence',p_source_fence,'executionId',p_execution,'inboxFence',p_inbox_fence,'policyVersion',p_policy,'mappingDigest',p_mapping,'requestedBy',r.requested_by,'leaseUntil',r.lease_until,'deadlineAt',o.envelope->>'deadlineAt');
END $$;
CREATE TABLE opportunity_catalog.eu_writer_execution_v2 (
 transaction_id bigint NOT NULL,backend_pid integer NOT NULL,run_id uuid NOT NULL REFERENCES opportunity_catalog.funding_run(run_id),run_fence bigint NOT NULL,source_fence integer NOT NULL,
 execution_id uuid NOT NULL,inbox_fence bigint NOT NULL,worker_id text NOT NULL,consumer text NOT NULL,run_lease_until timestamptz NOT NULL,deadline_at timestamptz NOT NULL,operation text NOT NULL DEFAULT 'ASSERT' CHECK(operation IN ('ASSERT','CLAIM','RETRY')),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(transaction_id,backend_pid,run_id)
);
ALTER TABLE opportunity_catalog.eu_writer_execution_v2 OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON opportunity_catalog.eu_writer_execution_v2 FROM PUBLIC,c4g_catalog_reader,c4g_eu_writer_runtime,c4g_opportunity_central_runtime;
CREATE TRIGGER eu_writer_execution_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.eu_writer_execution_v2 FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER eu_writer_execution_no_truncate BEFORE TRUNCATE ON opportunity_catalog.eu_writer_execution_v2 FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE FUNCTION opportunity_catalog.assert_eu_writer_execution_v2(p_run uuid,p_run_fence bigint,p_source_fence integer,p_execution uuid,p_inbox_fence bigint,p_worker text,p_consumer text,p_policy text,p_mapping text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE proof jsonb;
BEGIN
 proof:=opportunity_catalog.check_eu_writer_execution_v2(p_run,p_run_fence,p_source_fence,p_execution,p_inbox_fence,p_worker,p_consumer,p_policy,p_mapping,false,false);
 INSERT INTO opportunity_catalog.eu_writer_execution_v2(transaction_id,backend_pid,run_id,run_fence,source_fence,execution_id,inbox_fence,worker_id,consumer,run_lease_until,deadline_at,operation)
 VALUES(txid_current(),pg_backend_pid(),p_run,p_run_fence,p_source_fence,p_execution,p_inbox_fence,p_worker,p_consumer,(proof->>'leaseUntil')::timestamptz,(proof->>'deadlineAt')::timestamptz,'ASSERT') ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM opportunity_catalog.eu_writer_execution_v2 WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND run_id=p_run AND run_fence=p_run_fence AND source_fence=p_source_fence AND execution_id=p_execution AND inbox_fence=p_inbox_fence AND worker_id=p_worker AND consumer=p_consumer) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 RETURN proof;
END $$;
CREATE FUNCTION opportunity_catalog.claim_eu_writer_run_v2(p_run uuid,p_source_fence integer,p_execution uuid,p_inbox_fence bigint,p_worker text,p_consumer text,p_policy text,p_mapping text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r opportunity_catalog.funding_run%ROWTYPE;proof jsonb;
BEGIN
 SELECT * INTO r FROM opportunity_catalog.funding_run WHERE run_id=p_run FOR UPDATE;
 proof:=opportunity_catalog.check_eu_writer_execution_v2(p_run,r.fence,p_source_fence,p_execution,p_inbox_fence,p_worker,p_consumer,p_policy,p_mapping,true,false);
 INSERT INTO opportunity_catalog.eu_writer_execution_v2(transaction_id,backend_pid,run_id,run_fence,source_fence,execution_id,inbox_fence,worker_id,consumer,run_lease_until,deadline_at,operation)
 VALUES(txid_current(),pg_backend_pid(),p_run,r.fence+1,p_source_fence,p_execution,p_inbox_fence,p_worker,p_consumer,clock_timestamp()+interval '150 seconds',(proof->>'deadlineAt')::timestamptz,'CLAIM');
 UPDATE opportunity_catalog.funding_run SET status='RUNNING',started_at=COALESCE(started_at,clock_timestamp()),fence=fence+1,lease_until=clock_timestamp()+interval '150 seconds' WHERE run_id=p_run RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;
CREATE FUNCTION opportunity_catalog.begin_eu_writer_v2(p_run uuid,p_run_fence bigint,p_source_fence integer,p_execution uuid,p_inbox_fence bigint,p_worker text,p_consumer text,p_policy text,p_mapping text,p_external text,p_payload text,p_opportunity uuid,p_revision uuid,p_row bigint,p_decision text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE proof jsonb;a opportunity_catalog.funding_candidate_v2%ROWTYPE;h opportunity_catalog.opportunity%ROWTYPE;p opportunity_catalog.eu_writer_permit_v2%ROWTYPE;
BEGIN
 proof:=opportunity_catalog.assert_eu_writer_execution_v2(p_run,p_run_fence,p_source_fence,p_execution,p_inbox_fence,p_worker,p_consumer,p_policy,p_mapping);
 SELECT * INTO a FROM opportunity_catalog.funding_candidate_v2 WHERE run_id=p_run AND external_identifier=p_external;
 IF a.run_id IS NULL OR a.payload_digest IS DISTINCT FROM p_payload OR a.source_selection IS DISTINCT FROM (SELECT source_code FROM opportunity_catalog.funding_run WHERE run_id=p_run) OR p_decision IS NULL OR p_decision NOT IN ('ACCEPTED','REVIEW') THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 IF p_decision='ACCEPTED' THEN
  SELECT * INTO h FROM opportunity_catalog.opportunity WHERE opportunity_id=p_opportunity FOR UPDATE;
  IF h.opportunity_id IS NULL OR h.current_schema_version<>2 OR h.lifecycle_state<>'ACTIVE' OR h.current_revision_id IS DISTINCT FROM p_revision OR h.row_version IS DISTINCT FROM p_row
  OR NOT EXISTS(SELECT 1 FROM opportunity_catalog.source_identity_v2 WHERE source_namespace='EU_FUNDING_TENDERS' AND external_identifier=p_external AND opportunity_id=p_opportunity)
  OR EXISTS(SELECT 1 FROM opportunity_catalog.funding_identity WHERE external_identifier=p_external AND (opportunity_id<>p_opportunity OR corrections<>'{}'::jsonb OR conflicts<>'[]'::jsonb))
  OR EXISTS(SELECT 1 FROM opportunity_catalog.funding_resolution WHERE opportunity_id=p_opportunity) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 END IF;
 INSERT INTO opportunity_catalog.eu_writer_permit_v2(transaction_id,backend_pid,run_id,run_fence,source_fence,execution_id,inbox_fence,worker_id,consumer,policy_version,mapping_digest,external_identifier,payload_digest,opportunity_id,revision_id,row_version,decision)
 VALUES(txid_current(),pg_backend_pid(),p_run,p_run_fence,p_source_fence,p_execution,p_inbox_fence,p_worker,p_consumer,p_policy,p_mapping,p_external,p_payload,p_opportunity,p_revision,p_row,p_decision) RETURNING * INTO p;
 RETURN proof||jsonb_build_object('permitId',p.permit_id,'opportunityId',p.opportunity_id,'decision',p.decision);
END $$;
CREATE FUNCTION opportunity_catalog.assert_eu_writer_permit_v2(p_permit uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p opportunity_catalog.eu_writer_permit_v2%ROWTYPE;proof jsonb;
BEGIN
 SELECT * INTO p FROM opportunity_catalog.eu_writer_permit_v2 WHERE permit_id=p_permit AND transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 IF p.permit_id IS NULL THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 proof:=opportunity_catalog.assert_eu_writer_execution_v2(p.run_id,p.run_fence,p.source_fence,p.execution_id,p.inbox_fence,p.worker_id,p.consumer,p.policy_version,p.mapping_digest);
 IF NOT EXISTS(SELECT 1 FROM opportunity_catalog.funding_candidate_v2 WHERE run_id=p.run_id AND external_identifier=p.external_identifier AND payload_digest=p.payload_digest) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 RETURN proof||jsonb_build_object('permitId',p.permit_id,'opportunityId',p.opportunity_id,'decision',p.decision);
END $$;
CREATE FUNCTION opportunity_catalog.guard_eu_writer_commit_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM opportunity_catalog.assert_eu_writer_permit_v2(NEW.permit_id);RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER eu_writer_commit_guard AFTER INSERT ON opportunity_catalog.eu_writer_permit_v2 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_eu_writer_commit_v2();

ALTER FUNCTION opportunity_catalog.eu_source_state_v2() RENAME TO eu_source_state_legacy_v2;
CREATE FUNCTION opportunity_catalog.eu_source_state_v2() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT opportunity_catalog.eu_source_state_legacy_v2()||jsonb_build_object('writerMode',c.eu_writer_mode,'writerPolicy',c.eu_writer_policy,'writerMappingDigest',c.eu_writer_mapping_digest,
 'incompatiblePendingRuns',(SELECT count(*)::int FROM opportunity_catalog.funding_run r WHERE r.source_code IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') AND r.status IN ('QUEUED','RUNNING') AND (r.eu_writer_mode<>c.eu_writer_mode OR r.eu_writer_policy IS DISTINCT FROM c.eu_writer_policy OR r.eu_writer_mapping_digest IS DISTINCT FROM c.eu_writer_mapping_digest)))
 FROM opportunity_catalog.eu_source_control_v2 c WHERE family='EU_FUNDING_TENDERS'
$$;
CREATE OR REPLACE FUNCTION opportunity_catalog.guard_eu_control_v2() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s jsonb;configuration boolean;
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'OPPORTUNITY_V2_SOURCE_CONTROL_INVALID'; END IF;
 configuration:=NEW.eu_writer_mode IS DISTINCT FROM OLD.eu_writer_mode OR NEW.eu_writer_policy IS DISTINCT FROM OLD.eu_writer_policy OR NEW.eu_writer_mapping_digest IS DISTINCT FROM OLD.eu_writer_mapping_digest;
 IF NEW.family<>OLD.family OR NEW.fence<>OLD.fence+1 OR NEW.changed_by IS NULL THEN RAISE EXCEPTION 'OPPORTUNITY_V2_SOURCE_CONTROL_INVALID'; END IF;
 s:=opportunity_catalog.eu_source_state_v2();
 IF configuration THEN
  IF OLD.state<>'QUIESCED' OR NEW.state<>'QUIESCED' OR NEW.eu_writer_mode<>'CANONICAL_V2' OR (s->>'pendingRuns')::integer<>0 THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_CONFIGURATION_INVALID'; END IF;
 ELSE
  IF NOT ((OLD.state='ACTIVE' AND NEW.state='SUSPEND_REQUESTED') OR (OLD.state='SUSPEND_REQUESTED' AND NEW.state='QUIESCED') OR (OLD.state IN ('SUSPEND_REQUESTED','QUIESCED') AND NEW.state='ACTIVE')) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_SOURCE_CONTROL_INVALID'; END IF;
 END IF;
 IF NEW.state IN ('QUIESCED','ACTIVE') AND (s->>'activeRunLeases')::integer+(s->>'activeOutboxLeases')::integer+(s->>'activeInboxLeases')::integer<>0 THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_NOT_QUIESCENT'; END IF;
 IF NEW.state='ACTIVE' AND ((NEW.eu_writer_mode='LEGACY_V1' AND (s->>'acceptedV2')::integer>0) OR (s->>'expiredPendingRuns')::integer>0 OR (s->>'unrecoverablePendingRuns')::integer>0 OR (s->>'incompatiblePendingRuns')::integer>0 OR ((s->>'pendingRuns')::integer>0 AND (s->>'otherPendingRuns')::integer>0)) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_LEGACY_RESUME_BLOCKED'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION opportunity_catalog.guard_eu_write_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j jsonb; oldj jsonb; src text; rid uuid; oid uuid; run_fence integer; current_fence integer; is_v2 boolean:=false; is_eu boolean:=false; c opportunity_catalog.eu_source_control_v2%ROWTYPE;
BEGIN
 IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'OPPORTUNITY_V2_SOURCE_CONTROL_INVALID'; END IF;
 j:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 oldj:=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE j END;
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

DO $writer_guards$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['eu_writer_decision_v2','revision_evidence_v2','revision_concept_v2','revision_allocation_v2','revision_financial_detail_v2','revision_allocation_concept_v2','revision_deadline_v2','accepted_receipt_v2'] LOOP
  EXECUTE format('CREATE TRIGGER eu_writer_projection_guard BEFORE INSERT OR UPDATE OR DELETE ON opportunity_catalog.%I FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_eu_writer_projection_v2()',t);
 END LOOP;
END $writer_guards$;
ALTER FUNCTION opportunity_catalog.assert_eu_writer_execution_v2(uuid,bigint,integer,uuid,bigint,text,text,text,text) OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.begin_eu_writer_v2(uuid,bigint,integer,uuid,bigint,text,text,text,text,text,text,uuid,uuid,bigint,text) OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.assert_eu_writer_permit_v2(uuid) OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.guard_eu_writer_commit_v2() OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.check_eu_writer_effect_v2(text,text,jsonb,jsonb) OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.guard_eu_writer_projection_v2() OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.eu_source_state_v2() OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON FUNCTION opportunity_catalog.assert_eu_writer_execution_v2(uuid,bigint,integer,uuid,bigint,text,text,text,text),opportunity_catalog.begin_eu_writer_v2(uuid,bigint,integer,uuid,bigint,text,text,text,text,text,text,uuid,uuid,bigint,text),opportunity_catalog.assert_eu_writer_permit_v2(uuid),opportunity_catalog.guard_eu_writer_commit_v2(),opportunity_catalog.check_eu_writer_effect_v2(text,text,jsonb,jsonb),opportunity_catalog.guard_eu_writer_projection_v2(),opportunity_catalog.eu_source_state_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opportunity_catalog.assert_eu_writer_execution_v2(uuid,bigint,integer,uuid,bigint,text,text,text,text),opportunity_catalog.begin_eu_writer_v2(uuid,bigint,integer,uuid,bigint,text,text,text,text,text,text,uuid,uuid,bigint,text),opportunity_catalog.assert_eu_writer_permit_v2(uuid) TO c4g_eu_writer_runtime;
GRANT EXECUTE ON FUNCTION opportunity_catalog.eu_source_state_v2() TO c4g_opportunity_central_runtime,c4g_central_runtime;

ALTER FUNCTION opportunity_catalog.check_eu_writer_execution_v2(uuid,bigint,integer,uuid,bigint,text,text,text,text,boolean,boolean) OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.claim_eu_writer_run_v2(uuid,integer,uuid,bigint,text,text,text,text) OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON FUNCTION opportunity_catalog.check_eu_writer_execution_v2(uuid,bigint,integer,uuid,bigint,text,text,text,text,boolean,boolean),opportunity_catalog.claim_eu_writer_run_v2(uuid,integer,uuid,bigint,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opportunity_catalog.claim_eu_writer_run_v2(uuid,integer,uuid,bigint,text,text,text,text) TO c4g_eu_writer_runtime;

CREATE FUNCTION opportunity_catalog.release_eu_writer_retry_v2(p_run uuid,p_run_fence bigint,p_source_fence integer,p_execution uuid,p_inbox_fence bigint,p_worker text,p_consumer text,p_policy text,p_mapping text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE proof jsonb;
BEGIN
 proof:=opportunity_catalog.check_eu_writer_execution_v2(p_run,p_run_fence,p_source_fence,p_execution,p_inbox_fence,p_worker,p_consumer,p_policy,p_mapping,false,true);
 IF NOT EXISTS(SELECT 1 FROM async_exec.outbox n JOIN async_exec.outbox old ON old.envelope->>'executionId'=p_execution::text
 WHERE n.organization_id IS NULL AND old.organization_id IS NULL AND n.delivery_kind='RETRY' AND n.previous_execution_id=p_execution AND n.attempt=old.attempt+1 AND n.root_execution_id=old.root_execution_id AND n.content_digest=old.content_digest AND n.envelope#>>'{payload,runId}'=p_run::text AND n.envelope->>'deadlineAt'=old.envelope->>'deadlineAt' AND n.state='PENDING') THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 INSERT INTO opportunity_catalog.eu_writer_execution_v2(transaction_id,backend_pid,run_id,run_fence,source_fence,execution_id,inbox_fence,worker_id,consumer,run_lease_until,deadline_at,operation)
 VALUES(txid_current(),pg_backend_pid(),p_run,p_run_fence,p_source_fence,p_execution,p_inbox_fence,p_worker,p_consumer,(proof->>'leaseUntil')::timestamptz,(proof->>'deadlineAt')::timestamptz,'RETRY');
 UPDATE opportunity_catalog.funding_run SET lease_until=clock_timestamp() WHERE run_id=p_run;
 RETURN proof;
END $$;
CREATE FUNCTION opportunity_catalog.guard_eu_writer_execution_commit_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r opportunity_catalog.funding_run%ROWTYPE;c opportunity_catalog.eu_source_control_v2%ROWTYPE;i async_exec.inbox%ROWTYPE;
BEGIN
 SELECT * INTO r FROM opportunity_catalog.funding_run WHERE run_id=NEW.run_id FOR SHARE;
 SELECT * INTO c FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS' FOR SHARE;
 SELECT * INTO i FROM async_exec.inbox WHERE organization_id IS NULL AND consumer=NEW.consumer AND job_type='funding_tenders.refresh' AND job_version=1 AND idempotency_key=NEW.run_id::text FOR SHARE;
 IF NEW.transaction_id<>txid_current() OR NEW.backend_pid<>pg_backend_pid() OR NEW.run_lease_until<=clock_timestamp() OR NEW.deadline_at<=clock_timestamp()
 OR r.fence IS DISTINCT FROM NEW.run_fence OR r.eu_source_fence IS DISTINCT FROM NEW.source_fence OR c.state<>'ACTIVE' OR c.fence IS DISTINCT FROM NEW.source_fence
 OR i.state::text IS DISTINCT FROM (CASE WHEN NEW.operation='RETRY' THEN 'UNCERTAIN' ELSE 'PROCESSING' END) OR i.execution_id IS DISTINCT FROM NEW.execution_id OR i.claim_owner IS DISTINCT FROM NEW.worker_id OR i.fence IS DISTINCT FROM NEW.inbox_fence OR (NEW.operation<>'RETRY' AND (i.lease_until IS NULL OR i.lease_until<=clock_timestamp()))
 OR NOT authority_api.eu_writer_administrator_v2(r.requested_by) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER eu_writer_execution_commit_guard AFTER INSERT ON opportunity_catalog.eu_writer_execution_v2 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_eu_writer_execution_commit_v2();
ALTER FUNCTION opportunity_catalog.release_eu_writer_retry_v2(uuid,bigint,integer,uuid,bigint,text,text,text,text) OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.guard_eu_writer_execution_commit_v2() OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON FUNCTION opportunity_catalog.release_eu_writer_retry_v2(uuid,bigint,integer,uuid,bigint,text,text,text,text),opportunity_catalog.guard_eu_writer_execution_commit_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opportunity_catalog.release_eu_writer_retry_v2(uuid,bigint,integer,uuid,bigint,text,text,text,text) TO c4g_eu_writer_runtime;
CREATE FUNCTION opportunity_catalog.eu_writer_terminal_cleanup_v2(p_table text,p_operation text,p_new jsonb,p_old jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE totals record;
BEGIN
 IF p_operation<>'UPDATE' THEN RETURN false; END IF;
 IF p_table='funding_refresh_target' THEN
  RETURN p_old->>'state' IN ('PENDING','DISCOVERED','STAGED') AND p_new->>'state'='ERROR' AND (p_new-ARRAY['state','run_id'])=(p_old-ARRAY['state','run_id']) AND EXISTS(
   SELECT 1 FROM opportunity_catalog.funding_run r JOIN opportunity_catalog.funding_batch b USING(run_id) WHERE r.run_id=(p_new->>'run_id')::uuid AND b.cycle_id=(p_new->>'cycle_id')::uuid AND b.input_cursor->>'phase'='KNOWN' AND b.input_cursor->>'externalIdentifier'=p_new->>'external_identifier' AND r.eu_writer_mode='CANONICAL_V2' AND r.status='ERROR' AND r.lease_until IS NULL AND r.finished_at IS NOT NULL);
 ELSIF p_table='funding_cycle' THEN
  IF p_old->>'status' NOT IN ('RUNNING','ERROR') OR p_new->>'status'<>'ERROR' OR p_new->>'finished_at' IS NULL OR (p_new-ARRAY['status','error_code','finished_at','created_count','updated_count','unchanged_count','failed_count','review_count']) IS DISTINCT FROM (p_old-ARRAY['status','error_code','finished_at','created_count','updated_count','unchanged_count','failed_count','review_count']) THEN RETURN false;END IF;
  IF NOT EXISTS(SELECT 1 FROM opportunity_catalog.funding_run r JOIN opportunity_catalog.funding_batch b USING(run_id) WHERE b.cycle_id=(p_new->>'cycle_id')::uuid AND r.eu_writer_mode='CANONICAL_V2' AND r.status='ERROR' AND r.lease_until IS NULL AND r.finished_at IS NOT NULL AND r.error_code IS NOT DISTINCT FROM p_new->>'error_code') THEN RETURN false;END IF;
  SELECT COALESCE(sum(r.created_count),0) AS created,COALESCE(sum(r.updated_count),0) AS updated,COALESCE(sum(r.unchanged_count),0) AS unchanged,COALESCE(sum(r.failed_count),0) AS failed,COALESCE(sum(r.review_count),0) AS review INTO totals FROM opportunity_catalog.funding_run r JOIN opportunity_catalog.funding_batch b USING(run_id) WHERE b.cycle_id=(p_new->>'cycle_id')::uuid AND (b.input_cursor->>'phase') IS DISTINCT FROM 'KNOWN';
  RETURN (p_new->>'created_count')::bigint=totals.created AND (p_new->>'updated_count')::bigint=totals.updated AND (p_new->>'unchanged_count')::bigint=totals.unchanged AND (p_new->>'failed_count')::bigint=totals.failed AND ((p_new->>'review_count')::bigint=totals.review OR p_new->'review_count'=p_old->'review_count');
 END IF;
 RETURN false;
END $$;
ALTER FUNCTION opportunity_catalog.eu_writer_terminal_cleanup_v2(text,text,jsonb,jsonb) OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.guard_eu_writer_target_identity_v2() OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.guard_eu_writer_legacy_identity_v2() OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON FUNCTION opportunity_catalog.eu_writer_terminal_cleanup_v2(text,text,jsonb,jsonb),opportunity_catalog.guard_eu_writer_target_identity_v2(),opportunity_catalog.guard_eu_writer_legacy_identity_v2() FROM PUBLIC;
