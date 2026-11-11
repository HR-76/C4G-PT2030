DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_opportunity_central_owner') THEN CREATE ROLE c4g_opportunity_central_owner NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_opportunity_central_runtime') THEN CREATE ROLE c4g_opportunity_central_runtime NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_opportunity_central_migrator') THEN CREATE ROLE c4g_opportunity_central_migrator NOLOGIN NOINHERIT; END IF;
END $$;
GRANT c4g_opportunity_central_owner TO c4g_opportunity_central_migrator;
CREATE SCHEMA opportunity_catalog AUTHORIZATION c4g_opportunity_central_owner;
REVOKE ALL ON SCHEMA opportunity_catalog FROM PUBLIC;
GRANT USAGE ON SCHEMA opportunity_catalog TO c4g_opportunity_central_runtime;
SET ROLE c4g_opportunity_central_owner;
CREATE TABLE opportunity_catalog.opportunity (
 opportunity_id uuid PRIMARY KEY, current_revision_id uuid NOT NULL, revision_number integer NOT NULL CHECK(revision_number>0), row_version bigint NOT NULL CHECK(row_version>0),
 lifecycle_state text NOT NULL CHECK(lifecycle_state IN ('DRAFT','ACTIVE','STALE','ARCHIVED')), validation_state text NOT NULL CHECK(validation_state IN ('PENDING_REVIEW','VALIDATED_MANUAL','CONFLICT')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 300), funder_name text NOT NULL CHECK(length(funder_name) BETWEEN 1 AND 200), programme_name text, call_reference text, official_url text,
 opening_date date, closing_date date, quality_score smallint NOT NULL CHECK(quality_score BETWEEN 0 AND 100), quality_bucket text NOT NULL CHECK(quality_bucket IN ('LOW','MEDIUM','HIGH','COMPLETE')),
 content_digest char(64) NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'), normalization_version text NOT NULL CHECK(normalization_version='opportunity-normalization-v1'), quality_rule_version text NOT NULL CHECK(quality_rule_version='opportunity-quality-v1'),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(), archived_at timestamptz,
 CHECK(closing_date IS NULL OR opening_date IS NULL OR closing_date>=opening_date)
);
CREATE TABLE opportunity_catalog.revision (
 revision_id uuid PRIMARY KEY, opportunity_id uuid NOT NULL REFERENCES opportunity_catalog.opportunity(opportunity_id), revision_number integer NOT NULL CHECK(revision_number>0), row_version bigint NOT NULL CHECK(row_version>0),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'), normalized_projection jsonb NOT NULL CHECK(jsonb_typeof(normalized_projection)='object'), quality_projection jsonb NOT NULL CHECK(jsonb_typeof(quality_projection)='object'), content_digest char(64) NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), UNIQUE(opportunity_id,revision_number), UNIQUE(opportunity_id,row_version)
);
ALTER TABLE opportunity_catalog.opportunity ADD CONSTRAINT opportunity_current_revision_fk FOREIGN KEY(current_revision_id) REFERENCES opportunity_catalog.revision(revision_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE opportunity_catalog.provenance (
 provenance_id uuid PRIMARY KEY, opportunity_id uuid NOT NULL REFERENCES opportunity_catalog.opportunity(opportunity_id), revision_id uuid NOT NULL REFERENCES opportunity_catalog.revision(revision_id), source_type text NOT NULL CHECK(source_type IN ('C4G_MANUAL')), source_namespace text NOT NULL CHECK(source_namespace ~ '^[A-Z][A-Z0-9_]{0,63}$'), external_identifier text, normalized_external_identifier text, source_url text, observed_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(), recorded_by_actor_type text NOT NULL CHECK(recorded_by_actor_type IN ('HUMAN','SERVICE')), recorded_by_actor_reference text NOT NULL CHECK(length(recorded_by_actor_reference) BETWEEN 1 AND 128), source_digest char(64) NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$')
);
CREATE TABLE opportunity_catalog.idempotency_record (operation text NOT NULL CHECK(operation IN ('CREATE','UPDATE','ARCHIVE','RESTORE','PROVENANCE_APPEND','QUALITY_RECOMPUTE','DUPLICATE_RECORD')), request_id text NOT NULL CHECK(length(request_id) BETWEEN 8 AND 128), request_digest char(64) NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'), opportunity_id uuid NOT NULL, revision_id uuid, result_projection jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), PRIMARY KEY(operation,request_id));
CREATE TABLE opportunity_catalog.duplicate_candidate (left_opportunity_id uuid NOT NULL REFERENCES opportunity_catalog.opportunity(opportunity_id), right_opportunity_id uuid NOT NULL REFERENCES opportunity_catalog.opportunity(opportunity_id), left_revision_id uuid NOT NULL, right_revision_id uuid NOT NULL, rule_version text NOT NULL CHECK(rule_version='opportunity-deduplication-v1'), classification text NOT NULL CHECK(classification IN ('EXACT','POSSIBLE','DISTINCT')), reason_codes text[] NOT NULL CHECK(cardinality(reason_codes) BETWEEN 1 AND 16), evidence_fields text[] NOT NULL CHECK(cardinality(evidence_fields)<=16), left_digest char(64) NOT NULL, right_digest char(64) NOT NULL, reconciliation_state text NOT NULL DEFAULT 'CURRENT' CHECK(reconciliation_state IN ('CURRENT','STALE','REQUIRES_RECONCILIATION')), observed_at timestamptz NOT NULL DEFAULT transaction_timestamp(), CHECK(left_opportunity_id<right_opportunity_id), PRIMARY KEY(left_opportunity_id,right_opportunity_id,rule_version));
CREATE INDEX opportunity_updated_keyset ON opportunity_catalog.opportunity(updated_at DESC,opportunity_id DESC);
CREATE INDEX opportunity_closing_keyset ON opportunity_catalog.opportunity(closing_date,opportunity_id);
CREATE INDEX opportunity_title_keyset ON opportunity_catalog.opportunity(title,opportunity_id);
CREATE INDEX provenance_opportunity_revision ON opportunity_catalog.provenance(opportunity_id,revision_id);
CREATE INDEX provenance_source_identity ON opportunity_catalog.provenance(source_namespace,normalized_external_identifier);
CREATE FUNCTION opportunity_catalog.reject_history_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'OPPORTUNITY_HISTORY_IMMUTABLE'; END $$;
CREATE TRIGGER revision_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.revision FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER provenance_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.provenance FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
GRANT SELECT,INSERT,UPDATE ON opportunity_catalog.opportunity TO c4g_opportunity_central_runtime;
GRANT SELECT,INSERT ON opportunity_catalog.revision,opportunity_catalog.provenance,opportunity_catalog.idempotency_record,opportunity_catalog.duplicate_candidate TO c4g_opportunity_central_runtime;
GRANT UPDATE ON opportunity_catalog.duplicate_candidate TO c4g_opportunity_central_runtime;
REVOKE DELETE,TRUNCATE ON ALL TABLES IN SCHEMA opportunity_catalog FROM c4g_opportunity_central_runtime;
RESET ROLE;
GRANT USAGE ON SCHEMA audit TO c4g_opportunity_central_runtime;
GRANT EXECUTE ON FUNCTION audit.prepare_append_v1(uuid,text) TO c4g_opportunity_central_runtime;
GRANT EXECUTE ON FUNCTION audit.append_event_v1(uuid,text,text,integer,text,text,audit.ledger_location,uuid,uuid,audit.actor_type,text,text,text,bigint,timestamptz,timestamptz,uuid,uuid,text,text,text,text,jsonb) TO c4g_opportunity_central_runtime;
ALTER TABLE audit.event_identity DROP CONSTRAINT event_identity_event_code_check;
ALTER TABLE audit.event_identity ADD CONSTRAINT event_identity_event_code_check CHECK(event_code IN ('AUTHORIZATION_ALLOWED','AUTHORIZATION_DENIED','AUTHORIZATION_POLICY_INVALID','AUTHORIZATION_MFA_REQUIRED','AUTHORIZATION_VERSION_ADVANCED','GRANT_CHANGED','PROFILE_CHANGED','SOD_CHANGED','SENSITIVE_ACTION_ALLOWED','SUPPORT_GRANTED','SUPPORT_STARTED','SUPPORT_USED','SUPPORT_REVOKED','SUPPORT_EXPIRED','SERVICE_JOB_DISPATCHED','SERVICE_JOB_COMPLETED','EXPORT_ALLOWED','EXPORT_COMPLETED','DOCUMENT_ALLOWED','DOCUMENT_COMPLETED','ASYNC_EFFECT_AUTHORIZED','ASYNC_REPLAY_AUTHORIZED','ASYNC_AUTHORIZATION_DENIED','ASYNC_JOB_OBSERVED','ASYNC_RECONCILIATION_REQUIRED','OPPORTUNITY_CREATED','OPPORTUNITY_REVISION_CREATED','OPPORTUNITY_ARCHIVED','OPPORTUNITY_RESTORED','OPPORTUNITY_PROVENANCE_LINKED','OPPORTUNITY_QUALITY_EVALUATED','OPPORTUNITY_EXACT_DUPLICATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_CANDIDATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_DECISION_RECORDED','OPPORTUNITY_ACCESS_DENIED','OPPORTUNITY_RECONCILIATION_REQUIRED'));
ALTER TABLE audit.event DROP CONSTRAINT event_event_code_check;
ALTER TABLE audit.event ADD CONSTRAINT event_event_code_check CHECK(event_code IN ('AUTHORIZATION_ALLOWED','AUTHORIZATION_DENIED','AUTHORIZATION_POLICY_INVALID','AUTHORIZATION_MFA_REQUIRED','AUTHORIZATION_VERSION_ADVANCED','GRANT_CHANGED','PROFILE_CHANGED','SOD_CHANGED','SENSITIVE_ACTION_ALLOWED','SUPPORT_GRANTED','SUPPORT_STARTED','SUPPORT_USED','SUPPORT_REVOKED','SUPPORT_EXPIRED','SERVICE_JOB_DISPATCHED','SERVICE_JOB_COMPLETED','EXPORT_ALLOWED','EXPORT_COMPLETED','DOCUMENT_ALLOWED','DOCUMENT_COMPLETED','ASYNC_EFFECT_AUTHORIZED','ASYNC_REPLAY_AUTHORIZED','ASYNC_AUTHORIZATION_DENIED','ASYNC_JOB_OBSERVED','ASYNC_RECONCILIATION_REQUIRED','OPPORTUNITY_CREATED','OPPORTUNITY_REVISION_CREATED','OPPORTUNITY_ARCHIVED','OPPORTUNITY_RESTORED','OPPORTUNITY_PROVENANCE_LINKED','OPPORTUNITY_QUALITY_EVALUATED','OPPORTUNITY_EXACT_DUPLICATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_CANDIDATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_DECISION_RECORDED','OPPORTUNITY_ACCESS_DENIED','OPPORTUNITY_RECONCILIATION_REQUIRED'));
ALTER TABLE audit.event DROP CONSTRAINT event_catalog_version_check;
ALTER TABLE audit.event ADD CONSTRAINT event_catalog_version_check CHECK(catalog_version IN ('f7-events-v1','f12-events-v2'));
