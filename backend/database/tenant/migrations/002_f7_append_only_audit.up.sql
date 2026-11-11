DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_audit_owner') THEN CREATE ROLE c4g_audit_owner NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_audit_writer') THEN CREATE ROLE c4g_audit_writer NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_audit_reader') THEN CREATE ROLE c4g_audit_reader NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_audit_verifier') THEN CREATE ROLE c4g_audit_verifier NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_audit_migrator') THEN CREATE ROLE c4g_audit_migrator NOLOGIN NOINHERIT; END IF;
END $$;
GRANT c4g_audit_owner TO c4g_audit_migrator;

CREATE SCHEMA audit AUTHORIZATION c4g_audit_owner;
REVOKE ALL ON SCHEMA audit FROM PUBLIC;
GRANT USAGE ON SCHEMA audit TO c4g_audit_writer,c4g_audit_reader,c4g_audit_verifier;
ALTER DEFAULT PRIVILEGES FOR ROLE c4g_audit_owner IN SCHEMA audit REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE c4g_audit_owner IN SCHEMA audit REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE c4g_audit_owner IN SCHEMA audit REVOKE ALL ON SEQUENCES FROM PUBLIC;

SET ROLE c4g_audit_owner;
CREATE TYPE audit.actor_type AS ENUM ('HUMAN','SERVICE','SUPPORT');
CREATE TYPE audit.ledger_location AS ENUM ('CENTRAL','TENANT');

CREATE TABLE audit.event_identity (
  event_id uuid PRIMARY KEY,
  producer_code text NOT NULL,
  organization_id uuid NOT NULL,
  event_code text NOT NULL CHECK(event_code IN (
    'AUTHORIZATION_ALLOWED','AUTHORIZATION_DENIED','AUTHORIZATION_POLICY_INVALID','AUTHORIZATION_MFA_REQUIRED','AUTHORIZATION_VERSION_ADVANCED',
    'GRANT_CHANGED','PROFILE_CHANGED','SOD_CHANGED','SENSITIVE_ACTION_ALLOWED','SUPPORT_GRANTED','SUPPORT_STARTED','SUPPORT_USED','SUPPORT_REVOKED','SUPPORT_EXPIRED',
    'SERVICE_JOB_DISPATCHED','SERVICE_JOB_COMPLETED','EXPORT_ALLOWED','EXPORT_COMPLETED','DOCUMENT_ALLOWED','DOCUMENT_COMPLETED',
    'ASYNC_EFFECT_AUTHORIZED','ASYNC_REPLAY_AUTHORIZED','ASYNC_AUTHORIZATION_DENIED','ASYNC_JOB_OBSERVED','ASYNC_RECONCILIATION_REQUIRED'
  )),
  event_version integer NOT NULL CHECK(event_version=1),
  idempotency_key text NOT NULL,
  input_digest char(64) NOT NULL CHECK(input_digest ~ '^[a-f0-9]{64}$'),
  event_hash char(64) NOT NULL CHECK(event_hash ~ '^[a-f0-9]{64}$'),
  accepted_at timestamptz NOT NULL,
  UNIQUE(producer_code,organization_id,event_code,event_version,idempotency_key)
);

CREATE TABLE audit.chain_head (
  stream_id text PRIMARY KEY,
  organization_id uuid NOT NULL,
  stream_type text NOT NULL CHECK(stream_type IN ('SECURITY','ACCESS','SUPPORT','ASYNC','DATA','OPERATIONS')),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK(last_sequence>=0),
  last_hash char(64) NOT NULL DEFAULT repeat('0',64) CHECK(last_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(organization_id,stream_type)
);

CREATE TABLE audit.event (
  accepted_at timestamptz NOT NULL,
  event_id uuid NOT NULL,
  event_version integer NOT NULL CHECK(event_version=1),
  catalog_version text NOT NULL CHECK(catalog_version='f7-events-v1'),
  event_code text NOT NULL CHECK(event_code IN (
    'AUTHORIZATION_ALLOWED','AUTHORIZATION_DENIED','AUTHORIZATION_POLICY_INVALID','AUTHORIZATION_MFA_REQUIRED','AUTHORIZATION_VERSION_ADVANCED',
    'GRANT_CHANGED','PROFILE_CHANGED','SOD_CHANGED','SENSITIVE_ACTION_ALLOWED','SUPPORT_GRANTED','SUPPORT_STARTED','SUPPORT_USED','SUPPORT_REVOKED','SUPPORT_EXPIRED',
    'SERVICE_JOB_DISPATCHED','SERVICE_JOB_COMPLETED','EXPORT_ALLOWED','EXPORT_COMPLETED','DOCUMENT_ALLOWED','DOCUMENT_COMPLETED',
    'ASYNC_EFFECT_AUTHORIZED','ASYNC_REPLAY_AUTHORIZED','ASYNC_AUTHORIZATION_DENIED','ASYNC_JOB_OBSERVED','ASYNC_RECONCILIATION_REQUIRED'
  )),
  audit_class text NOT NULL CHECK(audit_class IN ('CRITICAL_PRE_EFFECT','DENY_PRESERVING','OBSERVATIONAL_RECONCILABLE')),
  ledger_location audit.ledger_location NOT NULL,
  organization_id uuid NOT NULL,
  tenant_id uuid,
  actor_type audit.actor_type NOT NULL,
  actor_id text NOT NULL,
  stream_id text NOT NULL,
  stream_type text NOT NULL,
  sequence bigint NOT NULL CHECK(sequence>0),
  observed_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  idempotency_key text NOT NULL,
  input_digest char(64) NOT NULL CHECK(input_digest ~ '^[a-f0-9]{64}$'),
  previous_hash char(64) NOT NULL CHECK(previous_hash ~ '^[a-f0-9]{64}$'),
  event_hash char(64) NOT NULL CHECK(event_hash ~ '^[a-f0-9]{64}$'),
  canonicalization_version text NOT NULL CHECK(canonicalization_version='JCS-1'),
  hash_algorithm text NOT NULL CHECK(hash_algorithm='SHA-256'),
  event_data jsonb NOT NULL CHECK(jsonb_typeof(event_data)='object' AND octet_length(event_data::text)<=16384),
  PRIMARY KEY(accepted_at,event_id),
  UNIQUE(accepted_at,stream_id,sequence),
  CHECK((ledger_location='TENANT' AND tenant_id IS NOT NULL) OR (ledger_location='CENTRAL' AND tenant_id IS NULL))
) PARTITION BY RANGE(accepted_at);

CREATE TABLE audit.event_2026_10 PARTITION OF audit.event FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE audit.event_2026_11 PARTITION OF audit.event FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit.event_default PARTITION OF audit.event DEFAULT;
CREATE INDEX audit_event_org_page ON audit.event(organization_id,accepted_at DESC,event_id DESC);
CREATE INDEX audit_event_org_code_page ON audit.event(organization_id,event_code,accepted_at DESC,event_id DESC);
CREATE INDEX audit_event_correlation ON audit.event(organization_id,correlation_id);

CREATE TABLE audit.checkpoint (
  stream_id text NOT NULL,
  last_sequence bigint NOT NULL CHECK(last_sequence>0),
  first_sequence bigint NOT NULL CHECK(first_sequence>0 AND first_sequence<=last_sequence),
  first_hash char(64) NOT NULL CHECK(first_hash ~ '^[a-f0-9]{64}$'),
  last_hash char(64) NOT NULL CHECK(last_hash ~ '^[a-f0-9]{64}$'),
  sealed_month date,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(stream_id,last_sequence)
);

CREATE OR REPLACE FUNCTION audit.reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,audit AS $$
BEGIN RAISE EXCEPTION 'AUDIT_APPEND_ONLY' USING ERRCODE='42501'; END $$;
CREATE TRIGGER audit_event_no_update_delete BEFORE UPDATE OR DELETE ON audit.event FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit.event FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER audit_identity_no_update_delete BEFORE UPDATE OR DELETE ON audit.event_identity FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER audit_identity_no_truncate BEFORE TRUNCATE ON audit.event_identity FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER audit_checkpoint_no_update_delete BEFORE UPDATE OR DELETE ON audit.checkpoint FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER audit_checkpoint_no_truncate BEFORE TRUNCATE ON audit.checkpoint FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();

ALTER TABLE audit.event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.event FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_event_org_read ON audit.event FOR SELECT
  USING(organization_id::text=current_setting('app.organization_id',true));
CREATE POLICY audit_event_owner_append ON audit.event FOR INSERT TO c4g_audit_owner WITH CHECK(current_user='c4g_audit_owner');

CREATE OR REPLACE FUNCTION audit.prepare_append_v1(p_organization_id uuid,p_stream_type text)
RETURNS TABLE(stream_id text,sequence bigint,previous_hash text,accepted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,audit AS $$
DECLARE v_stream text; v_head audit.chain_head%ROWTYPE;
BEGIN
  IF p_stream_type NOT IN ('SECURITY','ACCESS','SUPPORT','ASYNC','DATA','OPERATIONS') THEN RAISE EXCEPTION 'AUDIT_STREAM_INVALID'; END IF;
  v_stream := p_organization_id::text || ':' || p_stream_type;
  INSERT INTO audit.chain_head(stream_id,organization_id,stream_type) VALUES(v_stream,p_organization_id,p_stream_type) ON CONFLICT DO NOTHING;
  SELECT * INTO v_head FROM audit.chain_head WHERE chain_head.stream_id=v_stream FOR UPDATE;
  RETURN QUERY SELECT v_stream,v_head.last_sequence+1,v_head.last_hash::text,date_trunc('milliseconds',transaction_timestamp());
END $$;

CREATE OR REPLACE FUNCTION audit.append_event_v1(
  p_event_id uuid,p_producer_code text,p_event_code text,p_event_version integer,p_catalog_version text,p_audit_class text,
  p_ledger_location audit.ledger_location,p_organization_id uuid,p_tenant_id uuid,p_actor_type audit.actor_type,p_actor_id text,
  p_stream_id text,p_stream_type text,p_sequence bigint,p_observed_at timestamptz,p_accepted_at timestamptz,
  p_correlation_id uuid,p_causation_id uuid,p_idempotency_key text,p_input_digest text,p_previous_hash text,p_event_hash text,p_event_data jsonb)
RETURNS TABLE(status text,event_id uuid,event_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,audit AS $$
DECLARE v_head audit.chain_head%ROWTYPE; v_existing audit.event_identity%ROWTYPE;
BEGIN
  SELECT * INTO v_existing FROM audit.event_identity i WHERE i.producer_code=p_producer_code AND i.organization_id=p_organization_id
    AND i.event_code=p_event_code AND i.event_version=p_event_version AND i.idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.input_digest<>p_input_digest THEN RAISE EXCEPTION 'AUDIT_DIGEST_MISMATCH' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT 'DUPLICATE',v_existing.event_id,v_existing.event_hash::text; RETURN;
  END IF;
  SELECT * INTO v_head FROM audit.chain_head h WHERE h.stream_id=p_stream_id FOR UPDATE;
  IF NOT FOUND OR v_head.organization_id<>p_organization_id OR v_head.stream_type<>p_stream_type OR v_head.last_sequence+1<>p_sequence
     OR v_head.last_hash<>p_previous_hash OR p_accepted_at<>date_trunc('milliseconds',transaction_timestamp()) THEN RAISE EXCEPTION 'AUDIT_CHAIN_POSITION_MISMATCH'; END IF;
  INSERT INTO audit.event_identity VALUES(p_event_id,p_producer_code,p_organization_id,p_event_code,p_event_version,p_idempotency_key,p_input_digest,p_event_hash,p_accepted_at);
  INSERT INTO audit.event VALUES(p_accepted_at,p_event_id,p_event_version,p_catalog_version,p_event_code,p_audit_class,p_ledger_location,
    p_organization_id,p_tenant_id,p_actor_type,p_actor_id,p_stream_id,p_stream_type,p_sequence,p_observed_at,p_correlation_id,p_causation_id,
    p_idempotency_key,p_input_digest,p_previous_hash,p_event_hash,'JCS-1','SHA-256',p_event_data);
  UPDATE audit.chain_head SET last_sequence=p_sequence,last_hash=p_event_hash,updated_at=transaction_timestamp() WHERE chain_head.stream_id=p_stream_id;
  RETURN QUERY SELECT 'APPENDED',p_event_id,p_event_hash;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA audit FROM PUBLIC,c4g_audit_writer,c4g_audit_reader,c4g_audit_verifier;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA audit FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.prepare_append_v1(uuid,text) TO c4g_audit_writer;
GRANT EXECUTE ON FUNCTION audit.append_event_v1(uuid,text,text,integer,text,text,audit.ledger_location,uuid,uuid,audit.actor_type,text,text,text,bigint,timestamptz,timestamptz,uuid,uuid,text,text,text,text,jsonb) TO c4g_audit_writer;
GRANT SELECT ON audit.event TO c4g_audit_reader,c4g_audit_verifier;
GRANT SELECT ON audit.checkpoint,audit.chain_head TO c4g_audit_verifier;
RESET ROLE;
