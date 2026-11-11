-- Central jobs have explicit platform authority, never a synthetic tenant.
ALTER TABLE async_exec.outbox ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE async_exec.outbox DROP CONSTRAINT outbox_organization_id_logical_id_key;
ALTER TABLE async_exec.outbox ADD CONSTRAINT outbox_organization_id_logical_id_key UNIQUE NULLS NOT DISTINCT(organization_id,logical_id);
ALTER TABLE async_exec.outbox ADD CONSTRAINT funding_central_outbox_scope CHECK(organization_id IS NOT NULL OR (envelope->>'envelopeVersion'='3' AND envelope->>'authority'='CENTRAL' AND envelope->>'jobType'='funding_tenders.refresh'));
ALTER TABLE async_exec.inbox DROP CONSTRAINT inbox_pkey;
ALTER TABLE async_exec.inbox ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE async_exec.inbox ADD CONSTRAINT inbox_scope_key UNIQUE NULLS NOT DISTINCT(consumer,job_type,job_version,organization_id,idempotency_key);
ALTER TABLE async_exec.inbox ADD CONSTRAINT funding_central_inbox_scope CHECK(organization_id IS NOT NULL OR job_type='funding_tenders.refresh');
ALTER TABLE async_exec.execution ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE async_exec.execution ADD CONSTRAINT funding_central_execution_scope CHECK(organization_id IS NOT NULL OR job_type='funding_tenders.refresh');
ALTER TABLE async_exec.dead_letter ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE async_exec.dead_letter ADD CONSTRAINT funding_central_dead_letter_scope CHECK(organization_id IS NOT NULL OR job_type='funding_tenders.refresh');

ALTER TABLE opportunity_catalog.provenance DROP CONSTRAINT provenance_source_type_check;
ALTER TABLE opportunity_catalog.provenance ADD CONSTRAINT provenance_source_type_check CHECK(source_type IN ('C4G_MANUAL','EU_FUNDING_API'));

CREATE TABLE opportunity_catalog.funding_run (
 run_id uuid PRIMARY KEY, request_id uuid UNIQUE NOT NULL, requested_by uuid NOT NULL REFERENCES public.global_user(id),
 source_code text NOT NULL DEFAULT 'EU_FUNDING_TENDERS' CHECK(source_code='EU_FUNDING_TENDERS'),
 status text NOT NULL CHECK(status IN ('QUEUED','RUNNING','SUCCESS','ERROR')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), started_at timestamptz, finished_at timestamptz,
 observed_at timestamptz, result_count integer NOT NULL DEFAULT 0 CHECK(result_count BETWEEN 0 AND 100),
 created_count integer NOT NULL DEFAULT 0 CHECK(created_count>=0), updated_count integer NOT NULL DEFAULT 0 CHECK(updated_count>=0),
 failed_count integer NOT NULL DEFAULT 0 CHECK(failed_count>=0), unchanged_count integer NOT NULL DEFAULT 0 CHECK(unchanged_count>=0),
 limited boolean NOT NULL DEFAULT false, error_code text, collected boolean NOT NULL DEFAULT false,
 fence bigint NOT NULL DEFAULT 0, lease_until timestamptz,
 CHECK(created_count+updated_count+failed_count+unchanged_count<=100)
);
CREATE UNIQUE INDEX funding_one_active_run ON opportunity_catalog.funding_run(source_code) WHERE status IN ('QUEUED','RUNNING');
CREATE TABLE opportunity_catalog.funding_run_item (
 run_id uuid NOT NULL REFERENCES opportunity_catalog.funding_run(run_id), external_identifier text NOT NULL,
 source_fields jsonb NOT NULL CHECK(jsonb_typeof(source_fields)='object' AND octet_length(source_fields::text)<=32768),
 result text CHECK(result IN ('CREATED','UPDATED','UNCHANGED','FAILED')), opportunity_id uuid,
 PRIMARY KEY(run_id,external_identifier)
);
CREATE TABLE opportunity_catalog.funding_identity (
 external_identifier text PRIMARY KEY CHECK(length(external_identifier) BETWEEN 1 AND 128),
 opportunity_id uuid NOT NULL UNIQUE REFERENCES opportunity_catalog.opportunity(opportunity_id),
 last_source_fields jsonb NOT NULL, corrections jsonb NOT NULL DEFAULT '{}', conflicts jsonb NOT NULL DEFAULT '[]',
 observed_at timestamptz NOT NULL, last_run_id uuid NOT NULL REFERENCES opportunity_catalog.funding_run(run_id)
);
CREATE TABLE opportunity_catalog.funding_observation (
 run_id uuid NOT NULL REFERENCES opportunity_catalog.funding_run(run_id), external_identifier text NOT NULL,
 opportunity_id uuid NOT NULL REFERENCES opportunity_catalog.opportunity(opportunity_id), revision_id uuid NOT NULL REFERENCES opportunity_catalog.revision(revision_id),
 observed_at timestamptz NOT NULL, source_fields jsonb NOT NULL, conflicts jsonb NOT NULL,
 PRIMARY KEY(run_id,external_identifier)
);
CREATE TRIGGER funding_observation_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.funding_observation FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
GRANT SELECT,INSERT,UPDATE ON opportunity_catalog.funding_run,opportunity_catalog.funding_run_item,opportunity_catalog.funding_identity TO c4g_opportunity_central_runtime;
GRANT SELECT,INSERT ON opportunity_catalog.funding_observation TO c4g_opportunity_central_runtime;

-- Platform audit is an explicit null-organization stream; tenant audit remains scoped.
ALTER TABLE audit.event_identity ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE audit.chain_head ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE audit.event ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE audit.event ADD CONSTRAINT funding_platform_audit CHECK(organization_id IS NOT NULL OR (ledger_location='CENTRAL' AND tenant_id IS NULL AND event_data->>'operationCode'='OPPORTUNITY_CENTRAL_MANAGE'));
CREATE UNIQUE INDEX funding_platform_audit_identity ON audit.event_identity(producer_code,event_code,event_version,idempotency_key) WHERE organization_id IS NULL;
CREATE UNIQUE INDEX funding_platform_audit_stream ON audit.chain_head(stream_type) WHERE organization_id IS NULL;
SET ROLE c4g_audit_owner;
CREATE OR REPLACE FUNCTION audit.prepare_platform_append_v1(p_organization_id uuid,p_stream_type text)
RETURNS TABLE(stream_id text,sequence bigint,previous_hash text,accepted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,audit AS $$
DECLARE v_stream text; v_head audit.chain_head%ROWTYPE;
BEGIN
  IF p_organization_id IS NOT NULL THEN RAISE EXCEPTION 'PLATFORM_SCOPE_REQUIRED'; END IF;
  IF p_stream_type NOT IN ('SECURITY','ACCESS','SUPPORT','ASYNC','DATA','OPERATIONS') THEN RAISE EXCEPTION 'AUDIT_STREAM_INVALID'; END IF;
  v_stream := 'PLATFORM:' || p_stream_type;
  INSERT INTO audit.chain_head(stream_id,organization_id,stream_type) VALUES(v_stream,p_organization_id,p_stream_type) ON CONFLICT DO NOTHING;
  SELECT * INTO v_head FROM audit.chain_head WHERE chain_head.stream_id=v_stream FOR UPDATE;
  RETURN QUERY SELECT v_stream,v_head.last_sequence+1,v_head.last_hash::text,date_trunc('milliseconds',transaction_timestamp());
END $$;

CREATE OR REPLACE FUNCTION audit.append_platform_event_v1(
  p_event_id uuid,p_producer_code text,p_event_code text,p_event_version integer,p_catalog_version text,p_audit_class text,
  p_ledger_location audit.ledger_location,p_organization_id uuid,p_tenant_id uuid,p_actor_type audit.actor_type,p_actor_id text,
  p_stream_id text,p_stream_type text,p_sequence bigint,p_observed_at timestamptz,p_accepted_at timestamptz,
  p_correlation_id uuid,p_causation_id uuid,p_idempotency_key text,p_input_digest text,p_previous_hash text,p_event_hash text,p_event_data jsonb)
RETURNS TABLE(status text,event_id uuid,event_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,audit AS $$
DECLARE v_head audit.chain_head%ROWTYPE; v_existing audit.event_identity%ROWTYPE;
BEGIN
  IF p_organization_id IS NOT NULL OR p_ledger_location<>'CENTRAL' OR p_tenant_id IS NOT NULL OR p_event_data->>'operationCode' IS DISTINCT FROM 'OPPORTUNITY_CENTRAL_MANAGE' THEN RAISE EXCEPTION 'PLATFORM_SCOPE_REQUIRED'; END IF;
  SELECT * INTO v_existing FROM audit.event_identity i WHERE i.producer_code=p_producer_code AND i.organization_id IS NOT DISTINCT FROM p_organization_id
    AND i.event_code=p_event_code AND i.event_version=p_event_version AND i.idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.input_digest<>p_input_digest THEN RAISE EXCEPTION 'AUDIT_DIGEST_MISMATCH' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT 'DUPLICATE',v_existing.event_id,v_existing.event_hash::text; RETURN;
  END IF;
  SELECT * INTO v_head FROM audit.chain_head h WHERE h.stream_id=p_stream_id FOR UPDATE;
  IF NOT FOUND OR v_head.organization_id IS DISTINCT FROM p_organization_id OR v_head.stream_type<>p_stream_type OR v_head.last_sequence+1<>p_sequence
     OR v_head.last_hash<>p_previous_hash OR p_accepted_at<>date_trunc('milliseconds',transaction_timestamp()) THEN RAISE EXCEPTION 'AUDIT_CHAIN_POSITION_MISMATCH'; END IF;
  INSERT INTO audit.event_identity VALUES(p_event_id,p_producer_code,p_organization_id,p_event_code,p_event_version,p_idempotency_key,p_input_digest,p_event_hash,p_accepted_at);
  INSERT INTO audit.event VALUES(p_accepted_at,p_event_id,p_event_version,p_catalog_version,p_event_code,p_audit_class,p_ledger_location,
    p_organization_id,p_tenant_id,p_actor_type,p_actor_id,p_stream_id,p_stream_type,p_sequence,p_observed_at,p_correlation_id,p_causation_id,
    p_idempotency_key,p_input_digest,p_previous_hash,p_event_hash,'JCS-1','SHA-256',p_event_data);
  UPDATE audit.chain_head SET last_sequence=p_sequence,last_hash=p_event_hash,updated_at=transaction_timestamp() WHERE chain_head.stream_id=p_stream_id;
  RETURN QUERY SELECT 'APPENDED',p_event_id,p_event_hash;
END $$;

REVOKE ALL ON FUNCTION audit.prepare_platform_append_v1(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.append_platform_event_v1(uuid,text,text,integer,text,text,audit.ledger_location,uuid,uuid,audit.actor_type,text,text,text,bigint,timestamptz,timestamptz,uuid,uuid,text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.prepare_platform_append_v1(uuid,text) TO c4g_audit_writer;
GRANT EXECUTE ON FUNCTION audit.append_platform_event_v1(uuid,text,text,integer,text,text,audit.ledger_location,uuid,uuid,audit.actor_type,text,text,text,bigint,timestamptz,timestamptz,uuid,uuid,text,text,text,text,jsonb) TO c4g_audit_writer;
RESET ROLE;
