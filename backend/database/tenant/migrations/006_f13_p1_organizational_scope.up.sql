DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_organizational_scope_owner') THEN CREATE ROLE c4g_organizational_scope_owner NOLOGIN NOINHERIT; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_organizational_scope_runtime') THEN CREATE ROLE c4g_organizational_scope_runtime NOLOGIN NOINHERIT; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_organizational_scope_migrator') THEN CREATE ROLE c4g_organizational_scope_migrator NOLOGIN NOINHERIT; END IF;
END $$;
GRANT c4g_organizational_scope_owner TO c4g_organizational_scope_migrator;
CREATE SCHEMA organizational_scope AUTHORIZATION c4g_organizational_scope_owner;
REVOKE ALL ON SCHEMA organizational_scope FROM PUBLIC;
GRANT USAGE ON SCHEMA organizational_scope TO c4g_organizational_scope_runtime;
SET ROLE c4g_organizational_scope_owner;

CREATE TABLE organizational_scope.scope (
 scope_id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 scope_type text NOT NULL CHECK(scope_type IN ('UNIT','TEAM')),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 256 AND label=btrim(label)),
 stable_code text COLLATE "C",
 parent_scope_id uuid,
 lifecycle text NOT NULL DEFAULT 'ACTIVE' CHECK(lifecycle IN ('ACTIVE','ARCHIVED')),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 provenance jsonb NOT NULL CHECK(jsonb_typeof(provenance)='object'),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 created_by_actor_type text NOT NULL CHECK(created_by_actor_type IN ('HUMAN','SERVICE')),
 created_by_actor_id uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 updated_by_actor_type text NOT NULL CHECK(updated_by_actor_type IN ('HUMAN','SERVICE')),
 updated_by_actor_id uuid NOT NULL,
 archived_at timestamptz,
 archived_by_actor_id uuid,
 archive_reason_code text,
 UNIQUE(organization_id,scope_id),
 CHECK(parent_scope_id IS NULL OR parent_scope_id<>scope_id),
 CHECK(stable_code IS NULL OR (length(stable_code) BETWEEN 1 AND 64 AND stable_code ~ '^[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)*$')),
 CHECK((lifecycle='ACTIVE' AND archived_at IS NULL AND archived_by_actor_id IS NULL AND archive_reason_code IS NULL)
    OR (lifecycle='ARCHIVED' AND archived_at IS NOT NULL AND archived_by_actor_id IS NOT NULL
        AND archive_reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$')),
 FOREIGN KEY(organization_id,parent_scope_id) REFERENCES organizational_scope.scope(organization_id,scope_id)
   ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX scope_stable_code_unique ON organizational_scope.scope(organization_id,stable_code COLLATE "C") WHERE stable_code IS NOT NULL;
CREATE INDEX scope_parent_lookup ON organizational_scope.scope(organization_id,parent_scope_id,scope_id);
CREATE INDEX scope_active_keyset ON organizational_scope.scope(organization_id,scope_type,label,scope_id) WHERE lifecycle='ACTIVE';

CREATE TABLE organizational_scope.idempotency_record (
 organization_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('CREATE','RENAME_LABEL','REPARENT','ARCHIVE')),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 128),
 intention_digest char(64) NOT NULL CHECK(intention_digest ~ '^[a-f0-9]{64}$'),
 scope_id uuid NOT NULL,
 result_projection jsonb NOT NULL CHECK(jsonb_typeof(result_projection)='object'),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,operation,idempotency_key),
 FOREIGN KEY(organization_id,scope_id) REFERENCES organizational_scope.scope(organization_id,scope_id)
   ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE FUNCTION organizational_scope.lock_scope_tree_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE context_organization_id uuid;
BEGIN
 context_organization_id := NULLIF(current_setting('app.organization_id',true),'')::uuid;
 IF context_organization_id IS NULL THEN
   RAISE EXCEPTION 'ORGANIZATIONAL_SCOPE_CONTEXT_REQUIRED';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('F13-P1:' || context_organization_id::text,43001301));
 RETURN NULL;
END $$;
CREATE TRIGGER scope_tree_mutation_lock BEFORE INSERT OR UPDATE OR DELETE ON organizational_scope.scope
FOR EACH STATEMENT EXECUTE FUNCTION organizational_scope.lock_scope_tree_mutation();

CREATE FUNCTION organizational_scope.guard_scope_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,organizational_scope AS $$
DECLARE parent_row organizational_scope.scope%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ORGANIZATIONAL_SCOPE_DELETE_FORBIDDEN'; END IF;
 IF TG_OP='UPDATE' THEN
   IF OLD.scope_id<>NEW.scope_id OR OLD.organization_id<>NEW.organization_id OR OLD.scope_type<>NEW.scope_type
      OR OLD.stable_code IS DISTINCT FROM NEW.stable_code THEN RAISE EXCEPTION 'ORGANIZATIONAL_SCOPE_IMMUTABLE_FIELD'; END IF;
   IF OLD.lifecycle='ARCHIVED' THEN RAISE EXCEPTION 'ORGANIZATIONAL_SCOPE_ARCHIVED'; END IF;
   IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'ORGANIZATIONAL_SCOPE_REVISION_INVALID'; END IF;
   IF OLD.lifecycle='ACTIVE' AND NEW.lifecycle='ARCHIVED' AND EXISTS(
     WITH RECURSIVE descendants AS (
       SELECT s.scope_id,s.lifecycle FROM organizational_scope.scope s
        WHERE s.organization_id=NEW.organization_id AND s.parent_scope_id=NEW.scope_id
       UNION ALL
       SELECT s.scope_id,s.lifecycle FROM organizational_scope.scope s
        JOIN descendants d ON s.parent_scope_id=d.scope_id
        WHERE s.organization_id=NEW.organization_id
     ) SELECT 1 FROM descendants WHERE lifecycle='ACTIVE'
   ) THEN RAISE EXCEPTION 'ORGANIZATIONAL_SCOPE_ACTIVE_DESCENDANT'; END IF;
 END IF;
 IF NEW.parent_scope_id IS NOT NULL THEN
   SELECT * INTO parent_row FROM organizational_scope.scope
    WHERE organization_id=NEW.organization_id AND scope_id=NEW.parent_scope_id FOR SHARE;
   IF NOT FOUND OR parent_row.lifecycle<>'ACTIVE' OR parent_row.scope_type<>'UNIT' THEN
     RAISE EXCEPTION 'ORGANIZATIONAL_SCOPE_PARENT_INVALID';
   END IF;
 END IF;
 IF NEW.scope_type='TEAM' AND EXISTS(SELECT 1 FROM organizational_scope.scope child
    WHERE child.organization_id=NEW.organization_id AND child.parent_scope_id=NEW.scope_id) THEN
   RAISE EXCEPTION 'ORGANIZATIONAL_SCOPE_TEAM_HAS_CHILD';
 END IF;
 IF NEW.parent_scope_id IS NOT NULL AND EXISTS(
   WITH RECURSIVE descendants AS (
     SELECT s.scope_id FROM organizational_scope.scope s
      WHERE s.organization_id=NEW.organization_id AND s.parent_scope_id=NEW.scope_id
     UNION ALL
     SELECT s.scope_id FROM organizational_scope.scope s JOIN descendants d ON s.parent_scope_id=d.scope_id
      WHERE s.organization_id=NEW.organization_id
   ) SELECT 1 FROM descendants WHERE scope_id=NEW.parent_scope_id
 ) THEN RAISE EXCEPTION 'ORGANIZATIONAL_SCOPE_CYCLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scope_mutation_guard BEFORE INSERT OR UPDATE OR DELETE ON organizational_scope.scope
FOR EACH ROW EXECUTE FUNCTION organizational_scope.guard_scope_mutation();

CREATE FUNCTION organizational_scope.reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'ORGANIZATIONAL_SCOPE_HISTORY_IMMUTABLE'; END $$;
CREATE TRIGGER idempotency_immutable BEFORE UPDATE OR DELETE ON organizational_scope.idempotency_record
FOR EACH ROW EXECUTE FUNCTION organizational_scope.reject_history_mutation();

ALTER TABLE organizational_scope.scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizational_scope.scope FORCE ROW LEVEL SECURITY;
ALTER TABLE organizational_scope.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizational_scope.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY scope_isolation ON organizational_scope.scope
 USING(organization_id=current_setting('app.organization_id',true)::uuid)
 WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid);
CREATE POLICY scope_idempotency_isolation ON organizational_scope.idempotency_record
 USING(organization_id=current_setting('app.organization_id',true)::uuid)
 WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid);

GRANT SELECT,INSERT,UPDATE ON organizational_scope.scope TO c4g_organizational_scope_runtime;
GRANT SELECT,INSERT ON organizational_scope.idempotency_record TO c4g_organizational_scope_runtime;
REVOKE DELETE,TRUNCATE ON ALL TABLES IN SCHEMA organizational_scope FROM c4g_organizational_scope_runtime;
RESET ROLE;

GRANT USAGE ON SCHEMA audit TO c4g_organizational_scope_runtime;
GRANT EXECUTE ON FUNCTION audit.prepare_append_v1(uuid,text) TO c4g_organizational_scope_runtime;
GRANT EXECUTE ON FUNCTION audit.append_event_v1(uuid,text,text,integer,text,text,audit.ledger_location,uuid,uuid,audit.actor_type,text,text,text,bigint,timestamptz,timestamptz,uuid,uuid,text,text,text,text,jsonb) TO c4g_organizational_scope_runtime;

ALTER TABLE audit.event_identity DROP CONSTRAINT event_identity_event_code_check;
ALTER TABLE audit.event_identity ADD CONSTRAINT event_identity_event_code_check CHECK(event_code IN (
 'AUTHORIZATION_ALLOWED','AUTHORIZATION_DENIED','AUTHORIZATION_POLICY_INVALID','AUTHORIZATION_MFA_REQUIRED','AUTHORIZATION_VERSION_ADVANCED','GRANT_CHANGED','PROFILE_CHANGED','SOD_CHANGED','SENSITIVE_ACTION_ALLOWED','SUPPORT_GRANTED','SUPPORT_STARTED','SUPPORT_USED','SUPPORT_REVOKED','SUPPORT_EXPIRED','SERVICE_JOB_DISPATCHED','SERVICE_JOB_COMPLETED','EXPORT_ALLOWED','EXPORT_COMPLETED','DOCUMENT_ALLOWED','DOCUMENT_COMPLETED','ASYNC_EFFECT_AUTHORIZED','ASYNC_REPLAY_AUTHORIZED','ASYNC_REPLAY_REQUESTED','ASYNC_REPLAY_APPROVED','ASYNC_REPLAY_EXECUTION_CREATED','ASYNC_AUTHORIZATION_DENIED','ASYNC_JOB_OBSERVED','ASYNC_RECONCILIATION_REQUIRED','DOCUMENT_UPLOAD_INTENT_ACCEPTED','DOCUMENT_UPLOAD_CONFIRMED','DOCUMENT_SCAN_COMPLETED','DOCUMENT_ACCESS_CAPABILITY_ISSUED','DOCUMENT_VERSION_CREATED','DOCUMENT_ACCESS_BLOCKED','DOCUMENT_RECONCILIATION_DETECTED','DOCUMENT_UPLOAD_CANCELLED','DOCUMENT_LIFECYCLE_REQUESTED','OPPORTUNITY_CREATED','OPPORTUNITY_REVISION_CREATED','OPPORTUNITY_ARCHIVED','OPPORTUNITY_RESTORED','OPPORTUNITY_PROVENANCE_LINKED','OPPORTUNITY_QUALITY_EVALUATED','OPPORTUNITY_EXACT_DUPLICATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_CANDIDATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_DECISION_RECORDED','OPPORTUNITY_ACCESS_DENIED','OPPORTUNITY_RECONCILIATION_REQUIRED','ORGANIZATIONAL_SCOPE_CREATED','ORGANIZATIONAL_SCOPE_RENAMED','ORGANIZATIONAL_SCOPE_REPARENTED','ORGANIZATIONAL_SCOPE_ARCHIVED'));
ALTER TABLE audit.event DROP CONSTRAINT event_event_code_check,DROP CONSTRAINT event_catalog_version_check;
ALTER TABLE audit.event ADD CONSTRAINT event_event_code_check CHECK(event_code IN (
 'AUTHORIZATION_ALLOWED','AUTHORIZATION_DENIED','AUTHORIZATION_POLICY_INVALID','AUTHORIZATION_MFA_REQUIRED','AUTHORIZATION_VERSION_ADVANCED','GRANT_CHANGED','PROFILE_CHANGED','SOD_CHANGED','SENSITIVE_ACTION_ALLOWED','SUPPORT_GRANTED','SUPPORT_STARTED','SUPPORT_USED','SUPPORT_REVOKED','SUPPORT_EXPIRED','SERVICE_JOB_DISPATCHED','SERVICE_JOB_COMPLETED','EXPORT_ALLOWED','EXPORT_COMPLETED','DOCUMENT_ALLOWED','DOCUMENT_COMPLETED','ASYNC_EFFECT_AUTHORIZED','ASYNC_REPLAY_AUTHORIZED','ASYNC_REPLAY_REQUESTED','ASYNC_REPLAY_APPROVED','ASYNC_REPLAY_EXECUTION_CREATED','ASYNC_AUTHORIZATION_DENIED','ASYNC_JOB_OBSERVED','ASYNC_RECONCILIATION_REQUIRED','DOCUMENT_UPLOAD_INTENT_ACCEPTED','DOCUMENT_UPLOAD_CONFIRMED','DOCUMENT_SCAN_COMPLETED','DOCUMENT_ACCESS_CAPABILITY_ISSUED','DOCUMENT_VERSION_CREATED','DOCUMENT_ACCESS_BLOCKED','DOCUMENT_RECONCILIATION_DETECTED','DOCUMENT_UPLOAD_CANCELLED','DOCUMENT_LIFECYCLE_REQUESTED','OPPORTUNITY_CREATED','OPPORTUNITY_REVISION_CREATED','OPPORTUNITY_ARCHIVED','OPPORTUNITY_RESTORED','OPPORTUNITY_PROVENANCE_LINKED','OPPORTUNITY_QUALITY_EVALUATED','OPPORTUNITY_EXACT_DUPLICATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_CANDIDATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_DECISION_RECORDED','OPPORTUNITY_ACCESS_DENIED','OPPORTUNITY_RECONCILIATION_REQUIRED','ORGANIZATIONAL_SCOPE_CREATED','ORGANIZATIONAL_SCOPE_RENAMED','ORGANIZATIONAL_SCOPE_REPARENTED','ORGANIZATIONAL_SCOPE_ARCHIVED')),
 ADD CONSTRAINT event_catalog_version_check CHECK(catalog_version IN('f7-events-v1','f12-events-v1','f12-events-v2','f13-p1-events-v1'));
