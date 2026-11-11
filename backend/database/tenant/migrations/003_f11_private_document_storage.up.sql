DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_document_owner') THEN CREATE ROLE c4g_document_owner NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_document_runtime') THEN CREATE ROLE c4g_document_runtime NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_document_migrator') THEN CREATE ROLE c4g_document_migrator NOLOGIN NOINHERIT; END IF;
END $$;
ALTER TABLE audit.event_identity DROP CONSTRAINT event_identity_event_code_check;
ALTER TABLE audit.event_identity ADD CONSTRAINT event_identity_event_code_check CHECK(event_code IN (
  'AUTHORIZATION_ALLOWED','AUTHORIZATION_DENIED','AUTHORIZATION_POLICY_INVALID','AUTHORIZATION_MFA_REQUIRED','AUTHORIZATION_VERSION_ADVANCED','GRANT_CHANGED','PROFILE_CHANGED','SOD_CHANGED','SENSITIVE_ACTION_ALLOWED','SUPPORT_GRANTED','SUPPORT_STARTED','SUPPORT_USED','SUPPORT_REVOKED','SUPPORT_EXPIRED','SERVICE_JOB_DISPATCHED','SERVICE_JOB_COMPLETED','EXPORT_ALLOWED','EXPORT_COMPLETED','DOCUMENT_ALLOWED','DOCUMENT_COMPLETED','ASYNC_EFFECT_AUTHORIZED','ASYNC_REPLAY_AUTHORIZED','ASYNC_AUTHORIZATION_DENIED','ASYNC_JOB_OBSERVED','ASYNC_RECONCILIATION_REQUIRED','DOCUMENT_UPLOAD_INTENT_ACCEPTED','DOCUMENT_UPLOAD_CONFIRMED','DOCUMENT_SCAN_COMPLETED','DOCUMENT_ACCESS_CAPABILITY_ISSUED','DOCUMENT_VERSION_CREATED','DOCUMENT_ACCESS_BLOCKED','DOCUMENT_RECONCILIATION_DETECTED','DOCUMENT_UPLOAD_CANCELLED','DOCUMENT_LIFECYCLE_REQUESTED'));
ALTER TABLE audit.event DROP CONSTRAINT event_event_code_check;
ALTER TABLE audit.event ADD CONSTRAINT event_event_code_check CHECK(event_code IN (
  'AUTHORIZATION_ALLOWED','AUTHORIZATION_DENIED','AUTHORIZATION_POLICY_INVALID','AUTHORIZATION_MFA_REQUIRED','AUTHORIZATION_VERSION_ADVANCED','GRANT_CHANGED','PROFILE_CHANGED','SOD_CHANGED','SENSITIVE_ACTION_ALLOWED','SUPPORT_GRANTED','SUPPORT_STARTED','SUPPORT_USED','SUPPORT_REVOKED','SUPPORT_EXPIRED','SERVICE_JOB_DISPATCHED','SERVICE_JOB_COMPLETED','EXPORT_ALLOWED','EXPORT_COMPLETED','DOCUMENT_ALLOWED','DOCUMENT_COMPLETED','ASYNC_EFFECT_AUTHORIZED','ASYNC_REPLAY_AUTHORIZED','ASYNC_AUTHORIZATION_DENIED','ASYNC_JOB_OBSERVED','ASYNC_RECONCILIATION_REQUIRED','DOCUMENT_UPLOAD_INTENT_ACCEPTED','DOCUMENT_UPLOAD_CONFIRMED','DOCUMENT_SCAN_COMPLETED','DOCUMENT_ACCESS_CAPABILITY_ISSUED','DOCUMENT_VERSION_CREATED','DOCUMENT_ACCESS_BLOCKED','DOCUMENT_RECONCILIATION_DETECTED','DOCUMENT_UPLOAD_CANCELLED','DOCUMENT_LIFECYCLE_REQUESTED'));
ALTER TABLE audit.event DROP CONSTRAINT event_catalog_version_check;
ALTER TABLE audit.event ADD CONSTRAINT event_catalog_version_check CHECK(catalog_version IN ('f7-events-v1','f11-events-v2'));
GRANT c4g_document_owner TO c4g_document_migrator;
CREATE SCHEMA document_storage AUTHORIZATION c4g_document_owner;
REVOKE ALL ON SCHEMA document_storage FROM PUBLIC;
GRANT USAGE ON SCHEMA document_storage TO c4g_document_runtime;

SET ROLE c4g_document_owner;
CREATE TYPE document_storage.document_state AS ENUM ('PENDING','UPLOADING','UPLOADED','SCANNING','AVAILABLE','CANCELLED','EXPIRED','QUARANTINED','REJECTED','MISSING','SUPERSEDED','ARCHIVED','DELETE_PENDING','DELETED');
CREATE TYPE document_storage.scan_state AS ENUM ('NOT_REQUESTED','PENDING','CLEAN','INFECTED','ERROR');
CREATE TYPE document_storage.storage_class AS ENUM ('DOCUMENTS','QUARANTINE');

CREATE TABLE document_storage.document (
  document_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  resource_type text NOT NULL CHECK(resource_type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  resource_id uuid NOT NULL,
  current_version_id uuid,
  created_by_actor_id text NOT NULL CHECK(length(created_by_actor_id) BETWEEN 1 AND 128),
  correlation_id uuid NOT NULL,
  legal_hold_placeholder boolean NOT NULL DEFAULT false CHECK(legal_hold_placeholder=false),
  retention_policy_code text,
  lock_version bigint NOT NULL DEFAULT 0 CHECK(lock_version>=0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(organization_id,document_id)
);

CREATE TABLE document_storage.document_version (
  version_id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES document_storage.document(document_id),
  organization_id uuid NOT NULL,
  version_number integer NOT NULL CHECK(version_number>0),
  object_id uuid NOT NULL,
  storage_class document_storage.storage_class NOT NULL,
  expected_size bigint NOT NULL CHECK(expected_size>0 AND expected_size<=104857600),
  expected_file_class text NOT NULL CHECK(expected_file_class IN ('PDF','IMAGE','OOXML')),
  expected_sha256 char(64) NOT NULL CHECK(expected_sha256 ~ '^[a-f0-9]{64}$'),
  observed_size bigint CHECK(observed_size>0 AND observed_size<=104857600),
  declared_mime text NOT NULL CHECK(length(declared_mime)<=160),
  detected_mime text CHECK(length(detected_mime)<=160),
  display_filename text NOT NULL CHECK(length(display_filename) BETWEEN 1 AND 120 AND display_filename !~ '[\\/]'),
  sha256 char(64) CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  state document_storage.document_state NOT NULL,
  scan_state document_storage.scan_state NOT NULL,
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 128),
  correlation_id uuid NOT NULL,
  causation_id uuid,
  created_by_actor_id text NOT NULL CHECK(length(created_by_actor_id) BETWEEN 1 AND 128),
  lock_version bigint NOT NULL DEFAULT 0 CHECK(lock_version>=0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  confirmed_at timestamptz,
  UNIQUE(organization_id,document_id,version_number),
  UNIQUE(organization_id,document_id,version_id),
  UNIQUE(organization_id,object_id),
  UNIQUE(organization_id,idempotency_key),
  CHECK((state='AVAILABLE' AND scan_state='CLEAN' AND observed_size IS NOT NULL AND sha256 IS NOT NULL) OR state<>'AVAILABLE'),
  CHECK(state<>'DELETED')
);
ALTER TABLE document_storage.document ADD CONSTRAINT document_current_version_fk FOREIGN KEY(organization_id,document_id,current_version_id) REFERENCES document_storage.document_version(organization_id,document_id,version_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE document_storage.upload_capability (
  capability_id uuid PRIMARY KEY,
  version_id uuid NOT NULL REFERENCES document_storage.document_version(version_id),
  organization_id uuid NOT NULL,
  capability_digest char(64) NOT NULL CHECK(capability_digest ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(organization_id,capability_digest),
  CHECK(consumed_at IS NULL OR revoked_at IS NULL)
);

CREATE TABLE document_storage.multipart_part (
  version_id uuid NOT NULL REFERENCES document_storage.document_version(version_id),
  part_number smallint NOT NULL CHECK(part_number BETWEEN 1 AND 16),
  size_bytes integer NOT NULL CHECK(size_bytes>0 AND size_bytes<=8388608),
  sha256 char(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  completed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(version_id,part_number)
);

CREATE TABLE document_storage.scan_result (
  version_id uuid NOT NULL REFERENCES document_storage.document_version(version_id),
  attempt integer NOT NULL CHECK(attempt>0),
  result document_storage.scan_state NOT NULL CHECK(result<>'NOT_REQUESTED' AND result<>'PENDING'),
  result_code text NOT NULL CHECK(result_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  input_digest char(64) NOT NULL CHECK(input_digest ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz NOT NULL,
  PRIMARY KEY(version_id,attempt)
);

CREATE TABLE document_storage.reconciliation_finding (
  finding_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  version_id uuid,
  finding_code text NOT NULL CHECK(finding_code IN ('UPLOAD_EXPIRED','MULTIPART_ABANDONED','METADATA_WITHOUT_OBJECT','OBJECT_WITHOUT_METADATA','CHECKSUM_DIVERGED','SCAN_PENDING','VERSION_INCONSISTENT','CONFIRMATION_UNCERTAIN','PROVIDER_TIMEOUT')),
  state text NOT NULL CHECK(state IN ('OPEN','REPAIRED','AUTHORITY_REQUIRED')),
  finding_digest char(64) NOT NULL CHECK(finding_digest ~ '^[a-f0-9]{64}$'),
  detected_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  resolved_at timestamptz,
  UNIQUE(organization_id,finding_code,finding_digest)
);

CREATE INDEX document_org_resource ON document_storage.document(organization_id,resource_type,resource_id);
CREATE INDEX document_version_org_state ON document_storage.document_version(organization_id,state,updated_at);
CREATE INDEX document_capability_expiry ON document_storage.upload_capability(expires_at) WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX document_scan_pending ON document_storage.document_version(organization_id,updated_at) WHERE scan_state='PENDING';
CREATE INDEX document_reconciliation_open ON document_storage.reconciliation_finding(organization_id,detected_at) WHERE state='OPEN';

CREATE FUNCTION document_storage.consume_upload_capability(p_organization_id uuid,p_version_id uuid,p_digest char(64),p_now timestamptz) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,document_storage AS $$
  UPDATE document_storage.upload_capability SET consumed_at=p_now
  WHERE organization_id=p_organization_id AND p_organization_id=current_setting('app.organization_id',true)::uuid
    AND version_id=p_version_id AND capability_digest=p_digest AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>p_now
  RETURNING true
$$;

CREATE FUNCTION document_storage.transition_version(p_organization_id uuid,p_version_id uuid,p_from document_storage.document_state,p_to document_storage.document_state,p_scan document_storage.scan_state,p_lock bigint,p_size bigint,p_mime text,p_sha char(64)) RETURNS SETOF document_storage.document_version
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,document_storage AS $$
BEGIN
  IF p_organization_id<>current_setting('app.organization_id',true)::uuid OR NOT (
    (p_from='PENDING' AND p_to IN ('UPLOADING','CANCELLED','EXPIRED')) OR (p_from='UPLOADING' AND p_to IN ('UPLOADED','CANCELLED','EXPIRED','REJECTED')) OR
    (p_from='UPLOADED' AND p_to IN ('SCANNING','QUARANTINED','REJECTED')) OR (p_from='SCANNING' AND p_to IN ('AVAILABLE','QUARANTINED','REJECTED')) OR
    (p_from='AVAILABLE' AND p_to IN ('SUPERSEDED','ARCHIVED','QUARANTINED')) OR (p_from='QUARANTINED' AND p_to IN ('SCANNING','REJECTED')) OR (p_from='MISSING' AND p_to='QUARANTINED')
  ) OR (p_to='AVAILABLE' AND p_scan<>'CLEAN') THEN RETURN; END IF;
  RETURN QUERY UPDATE document_storage.document_version SET state=p_to,scan_state=COALESCE(p_scan,scan_state),observed_size=COALESCE(p_size,observed_size),detected_mime=COALESCE(p_mime,detected_mime),sha256=COALESCE(p_sha,sha256),lock_version=lock_version+1,updated_at=transaction_timestamp()
    WHERE organization_id=p_organization_id AND version_id=p_version_id AND state=p_from AND lock_version=p_lock RETURNING *;
END $$;
CREATE FUNCTION document_storage.confirm_version(p_organization_id uuid,p_version_id uuid,p_sha char(64),p_size bigint) RETURNS SETOF document_storage.document_version
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,document_storage AS $$
  UPDATE document_storage.document_version SET confirmed_at=transaction_timestamp()
  WHERE organization_id=p_organization_id AND p_organization_id=current_setting('app.organization_id',true)::uuid
    AND version_id=p_version_id AND sha256=p_sha AND observed_size=p_size AND confirmed_at IS NULL
  RETURNING *
$$;

ALTER TABLE document_storage.document ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_storage.document_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_storage.upload_capability ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_storage.reconciliation_finding ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_org_isolation ON document_storage.document USING (organization_id=current_setting('app.organization_id',true)::uuid) WITH CHECK (organization_id=current_setting('app.organization_id',true)::uuid);
CREATE POLICY document_version_org_isolation ON document_storage.document_version USING (organization_id=current_setting('app.organization_id',true)::uuid) WITH CHECK (organization_id=current_setting('app.organization_id',true)::uuid);
CREATE POLICY document_capability_org_isolation ON document_storage.upload_capability USING (organization_id=current_setting('app.organization_id',true)::uuid) WITH CHECK (organization_id=current_setting('app.organization_id',true)::uuid);
CREATE POLICY document_reconciliation_org_isolation ON document_storage.reconciliation_finding USING (organization_id=current_setting('app.organization_id',true)::uuid) WITH CHECK (organization_id=current_setting('app.organization_id',true)::uuid);

GRANT SELECT,INSERT ON document_storage.document,document_storage.document_version,document_storage.upload_capability,document_storage.multipart_part,document_storage.scan_result,document_storage.reconciliation_finding TO c4g_document_runtime;
GRANT EXECUTE ON FUNCTION document_storage.consume_upload_capability(uuid,uuid,char,timestamptz),document_storage.transition_version(uuid,uuid,document_storage.document_state,document_storage.document_state,document_storage.scan_state,bigint,bigint,text,char) TO c4g_document_runtime;
REVOKE ALL ON FUNCTION document_storage.consume_upload_capability(uuid,uuid,char,timestamptz),document_storage.transition_version(uuid,uuid,document_storage.document_state,document_storage.document_state,document_storage.scan_state,bigint,bigint,text,char) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION document_storage.confirm_version(uuid,uuid,char,bigint) TO c4g_document_runtime;
REVOKE ALL ON FUNCTION document_storage.confirm_version(uuid,uuid,char,bigint) FROM PUBLIC;
REVOKE DELETE,TRUNCATE ON ALL TABLES IN SCHEMA document_storage FROM c4g_document_runtime;
RESET ROLE;
COMMENT ON SCHEMA document_storage IS 'F11 tenant-local metadata only; no object bytes, URLs, credentials, or legal retention behavior.';
