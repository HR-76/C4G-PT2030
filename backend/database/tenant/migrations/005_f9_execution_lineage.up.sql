LOCK TABLE async_exec.outbox, async_exec.inbox IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM async_exec.outbox WHERE state NOT IN ('PUBLISHED','FAILED','CANCELLED'))
     OR EXISTS (SELECT 1 FROM async_exec.inbox WHERE state NOT IN ('COMPLETED','FAILED','CANCELLED')) THEN
    RAISE EXCEPTION 'F9_LINEAGE_DRAIN_REQUIRED';
  END IF;
END $$;
CREATE TYPE async_exec.delivery_kind AS ENUM ('INITIAL','RETRY','REPLAY');
ALTER TABLE async_exec.outbox
  ADD COLUMN lineage_version smallint,
  ADD COLUMN delivery_kind async_exec.delivery_kind,
  ADD COLUMN attempt integer,
  ADD COLUMN root_execution_id uuid,
  ADD COLUMN previous_execution_id uuid,
  ADD COLUMN content_digest char(64),
  ADD COLUMN envelope_digest char(64),
  ADD COLUMN replay_request_id uuid;
UPDATE async_exec.outbox SET lineage_version=0;
ALTER TABLE async_exec.outbox ALTER COLUMN lineage_version SET NOT NULL;
ALTER TABLE async_exec.outbox ADD CONSTRAINT outbox_lineage_version_check CHECK(lineage_version IN (0,1));
ALTER TABLE async_exec.outbox ADD CONSTRAINT outbox_lineage_shape_check CHECK(
 (lineage_version=0 AND state IN ('PUBLISHED','FAILED','CANCELLED') AND delivery_kind IS NULL AND attempt IS NULL AND root_execution_id IS NULL AND previous_execution_id IS NULL AND content_digest IS NULL AND envelope_digest IS NULL AND replay_request_id IS NULL)
 OR
 (lineage_version=1 AND delivery_kind IS NOT NULL AND attempt BETWEEN 1 AND 5 AND root_execution_id IS NOT NULL
  AND content_digest ~ '^[a-f0-9]{64}$' AND envelope_digest ~ '^[a-f0-9]{64}$'
  AND (envelope->>'executionId')::uuid<>COALESCE(previous_execution_id,'00000000-0000-0000-0000-000000000000'::uuid)
  AND ((delivery_kind='INITIAL' AND attempt=1 AND root_execution_id=(envelope->>'executionId')::uuid AND previous_execution_id IS NULL AND replay_request_id IS NULL)
    OR (delivery_kind='RETRY' AND attempt BETWEEN 2 AND 5 AND previous_execution_id IS NOT NULL AND replay_request_id IS NULL)
    OR (delivery_kind='REPLAY' AND attempt=1 AND previous_execution_id IS NOT NULL AND replay_request_id IS NOT NULL)))) NOT VALID;
ALTER TABLE async_exec.outbox VALIDATE CONSTRAINT outbox_lineage_shape_check;
CREATE UNIQUE INDEX f9_tenant_outbox_execution_v1 ON async_exec.outbox(((envelope->>'executionId')::uuid)) WHERE lineage_version=1;
CREATE UNIQUE INDEX f9_tenant_outbox_replay_request_v1 ON async_exec.outbox(organization_id,replay_request_id) WHERE lineage_version=1 AND replay_request_id IS NOT NULL;
CREATE INDEX f9_tenant_outbox_previous_v1 ON async_exec.outbox(organization_id,previous_execution_id) WHERE lineage_version=1 AND previous_execution_id IS NOT NULL;
CREATE FUNCTION async_exec.guard_outbox_lineage_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,async_exec AS $$
DECLARE prior async_exec.outbox%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND (OLD.lineage_version,OLD.delivery_kind,OLD.attempt,OLD.root_execution_id,OLD.previous_execution_id,OLD.content_digest,OLD.envelope_digest,OLD.replay_request_id,OLD.envelope)
   IS DISTINCT FROM (NEW.lineage_version,NEW.delivery_kind,NEW.attempt,NEW.root_execution_id,NEW.previous_execution_id,NEW.content_digest,NEW.envelope_digest,NEW.replay_request_id,NEW.envelope) THEN RAISE EXCEPTION 'F9_LINEAGE_IMMUTABLE'; END IF;
 IF TG_OP='INSERT' AND NEW.lineage_version<>1 THEN RAISE EXCEPTION 'F9_NEW_LINEAGE_REQUIRED'; END IF;
 IF NEW.lineage_version=1 AND NEW.previous_execution_id IS NOT NULL THEN
   SELECT * INTO prior FROM async_exec.outbox WHERE organization_id=NEW.organization_id AND lineage_version=1 AND (envelope->>'executionId')::uuid=NEW.previous_execution_id;
   IF NOT FOUND OR prior.root_execution_id<>NEW.root_execution_id OR prior.envelope->>'jobType'<>NEW.envelope->>'jobType'
      OR prior.envelope->>'idempotencyKey'<>NEW.envelope->>'idempotencyKey' OR prior.content_digest<>NEW.content_digest THEN RAISE EXCEPTION 'F9_LINEAGE_CONFLICT'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION async_exec.guard_outbox_lineage_v1() FROM PUBLIC;
CREATE TRIGGER guard_outbox_lineage_v1 BEFORE INSERT OR UPDATE ON async_exec.outbox FOR EACH ROW EXECUTE FUNCTION async_exec.guard_outbox_lineage_v1();
REVOKE UPDATE,DELETE,TRUNCATE ON async_exec.outbox FROM c4g_tenant_runtime;
GRANT UPDATE(state,queue_id,available_at,claim_owner,lease_until,fence,updated_at,published_at) ON async_exec.outbox TO c4g_tenant_runtime;
GRANT USAGE ON SCHEMA async_exec TO c4g_opportunity_tenant_runtime;
GRANT SELECT,INSERT ON async_exec.outbox TO c4g_opportunity_tenant_runtime;
ALTER TABLE audit.event_identity DROP CONSTRAINT event_identity_event_code_check;
ALTER TABLE audit.event_identity ADD CONSTRAINT event_identity_event_code_check CHECK(event_code IN (
 'AUTHORIZATION_ALLOWED','AUTHORIZATION_DENIED','AUTHORIZATION_POLICY_INVALID','AUTHORIZATION_MFA_REQUIRED','AUTHORIZATION_VERSION_ADVANCED','GRANT_CHANGED','PROFILE_CHANGED','SOD_CHANGED','SENSITIVE_ACTION_ALLOWED','SUPPORT_GRANTED','SUPPORT_STARTED','SUPPORT_USED','SUPPORT_REVOKED','SUPPORT_EXPIRED','SERVICE_JOB_DISPATCHED','SERVICE_JOB_COMPLETED','EXPORT_ALLOWED','EXPORT_COMPLETED','DOCUMENT_ALLOWED','DOCUMENT_COMPLETED','ASYNC_EFFECT_AUTHORIZED','ASYNC_REPLAY_AUTHORIZED','ASYNC_REPLAY_REQUESTED','ASYNC_REPLAY_APPROVED','ASYNC_REPLAY_EXECUTION_CREATED','ASYNC_AUTHORIZATION_DENIED','ASYNC_JOB_OBSERVED','ASYNC_RECONCILIATION_REQUIRED','DOCUMENT_UPLOAD_INTENT_ACCEPTED','DOCUMENT_UPLOAD_CONFIRMED','DOCUMENT_SCAN_COMPLETED','DOCUMENT_ACCESS_CAPABILITY_ISSUED','DOCUMENT_VERSION_CREATED','DOCUMENT_ACCESS_BLOCKED','DOCUMENT_RECONCILIATION_DETECTED','DOCUMENT_UPLOAD_CANCELLED','DOCUMENT_LIFECYCLE_REQUESTED','OPPORTUNITY_CREATED','OPPORTUNITY_REVISION_CREATED','OPPORTUNITY_ARCHIVED','OPPORTUNITY_RESTORED','OPPORTUNITY_PROVENANCE_LINKED','OPPORTUNITY_QUALITY_EVALUATED','OPPORTUNITY_EXACT_DUPLICATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_CANDIDATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_DECISION_RECORDED','OPPORTUNITY_ACCESS_DENIED','OPPORTUNITY_RECONCILIATION_REQUIRED'));
ALTER TABLE audit.event DROP CONSTRAINT event_event_code_check,DROP CONSTRAINT event_catalog_version_check;
ALTER TABLE audit.event ADD CONSTRAINT event_event_code_check CHECK(event_code IN (
 'AUTHORIZATION_ALLOWED','AUTHORIZATION_DENIED','AUTHORIZATION_POLICY_INVALID','AUTHORIZATION_MFA_REQUIRED','AUTHORIZATION_VERSION_ADVANCED','GRANT_CHANGED','PROFILE_CHANGED','SOD_CHANGED','SENSITIVE_ACTION_ALLOWED','SUPPORT_GRANTED','SUPPORT_STARTED','SUPPORT_USED','SUPPORT_REVOKED','SUPPORT_EXPIRED','SERVICE_JOB_DISPATCHED','SERVICE_JOB_COMPLETED','EXPORT_ALLOWED','EXPORT_COMPLETED','DOCUMENT_ALLOWED','DOCUMENT_COMPLETED','ASYNC_EFFECT_AUTHORIZED','ASYNC_REPLAY_AUTHORIZED','ASYNC_REPLAY_REQUESTED','ASYNC_REPLAY_APPROVED','ASYNC_REPLAY_EXECUTION_CREATED','ASYNC_AUTHORIZATION_DENIED','ASYNC_JOB_OBSERVED','ASYNC_RECONCILIATION_REQUIRED','DOCUMENT_UPLOAD_INTENT_ACCEPTED','DOCUMENT_UPLOAD_CONFIRMED','DOCUMENT_SCAN_COMPLETED','DOCUMENT_ACCESS_CAPABILITY_ISSUED','DOCUMENT_VERSION_CREATED','DOCUMENT_ACCESS_BLOCKED','DOCUMENT_RECONCILIATION_DETECTED','DOCUMENT_UPLOAD_CANCELLED','DOCUMENT_LIFECYCLE_REQUESTED','OPPORTUNITY_CREATED','OPPORTUNITY_REVISION_CREATED','OPPORTUNITY_ARCHIVED','OPPORTUNITY_RESTORED','OPPORTUNITY_PROVENANCE_LINKED','OPPORTUNITY_QUALITY_EVALUATED','OPPORTUNITY_EXACT_DUPLICATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_CANDIDATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_DECISION_RECORDED','OPPORTUNITY_ACCESS_DENIED','OPPORTUNITY_RECONCILIATION_REQUIRED')),
 ADD CONSTRAINT event_catalog_version_check CHECK(catalog_version IN('f7-events-v1','f12-events-v1','f12-events-v2'));
