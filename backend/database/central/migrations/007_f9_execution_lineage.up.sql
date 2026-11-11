LOCK TABLE async_exec.outbox,async_exec.inbox,async_exec.execution,async_exec.dead_letter IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM async_exec.outbox WHERE state NOT IN ('PUBLISHED','FAILED','CANCELLED'))
 OR EXISTS(SELECT 1 FROM async_exec.inbox WHERE state NOT IN ('COMPLETED','FAILED','CANCELLED'))
 OR EXISTS(SELECT 1 FROM async_exec.execution WHERE state NOT IN ('COMPLETED','FAILED','CANCELLED','EXPIRED','DEAD_LETTER')) THEN RAISE EXCEPTION 'F9_LINEAGE_DRAIN_REQUIRED'; END IF;
END $$;
CREATE TYPE async_exec.delivery_kind AS ENUM ('INITIAL','RETRY','REPLAY');
ALTER TABLE async_exec.outbox ADD COLUMN lineage_version smallint,ADD COLUMN delivery_kind async_exec.delivery_kind,ADD COLUMN attempt integer,
 ADD COLUMN root_execution_id uuid,ADD COLUMN previous_execution_id uuid,ADD COLUMN content_digest char(64),ADD COLUMN envelope_digest char(64),ADD COLUMN replay_request_id uuid;
UPDATE async_exec.outbox SET lineage_version=0;
ALTER TABLE async_exec.outbox ALTER COLUMN lineage_version SET NOT NULL;
ALTER TABLE async_exec.outbox ADD CONSTRAINT outbox_lineage_version_check CHECK(lineage_version IN(0,1));
ALTER TABLE async_exec.outbox ADD CONSTRAINT outbox_lineage_shape_check CHECK((lineage_version=0 AND state IN('PUBLISHED','FAILED','CANCELLED') AND delivery_kind IS NULL AND attempt IS NULL AND root_execution_id IS NULL AND previous_execution_id IS NULL AND content_digest IS NULL AND envelope_digest IS NULL AND replay_request_id IS NULL) OR (lineage_version=1 AND delivery_kind IS NOT NULL AND attempt BETWEEN 1 AND 5 AND root_execution_id IS NOT NULL AND content_digest~'^[a-f0-9]{64}$' AND envelope_digest~'^[a-f0-9]{64}$' AND ((delivery_kind='INITIAL' AND attempt=1 AND root_execution_id=(envelope->>'executionId')::uuid AND previous_execution_id IS NULL AND replay_request_id IS NULL) OR (delivery_kind='RETRY' AND attempt BETWEEN 2 AND 5 AND previous_execution_id IS NOT NULL AND replay_request_id IS NULL) OR (delivery_kind='REPLAY' AND attempt=1 AND previous_execution_id IS NOT NULL AND replay_request_id IS NOT NULL))));
CREATE UNIQUE INDEX f9_central_outbox_execution_v1 ON async_exec.outbox(((envelope->>'executionId')::uuid)) WHERE lineage_version=1;
CREATE UNIQUE INDEX f9_central_outbox_replay_request_v1 ON async_exec.outbox(organization_id,replay_request_id) WHERE lineage_version=1 AND replay_request_id IS NOT NULL;
ALTER TABLE async_exec.execution ALTER COLUMN attempt DROP NOT NULL;
ALTER TABLE async_exec.execution ADD COLUMN lineage_version smallint,ADD COLUMN delivery_kind async_exec.delivery_kind,ADD COLUMN root_execution_id uuid,ADD COLUMN previous_execution_id uuid,ADD COLUMN content_digest char(64),ADD COLUMN envelope_digest char(64),ADD COLUMN replay_request_id uuid;
UPDATE async_exec.execution SET lineage_version=0;
ALTER TABLE async_exec.execution ALTER COLUMN lineage_version SET NOT NULL;
ALTER TABLE async_exec.execution ADD CONSTRAINT execution_lineage_shape_check CHECK((lineage_version=0 AND state IN('COMPLETED','FAILED','CANCELLED','EXPIRED','DEAD_LETTER') AND attempt>=1 AND delivery_kind IS NULL AND root_execution_id IS NULL AND previous_execution_id IS NULL AND content_digest IS NULL AND envelope_digest IS NULL AND replay_request_id IS NULL) OR (lineage_version=1 AND delivery_kind IS NOT NULL AND attempt BETWEEN 1 AND 5 AND root_execution_id IS NOT NULL AND content_digest~'^[a-f0-9]{64}$' AND envelope_digest~'^[a-f0-9]{64}$' AND ((delivery_kind='INITIAL' AND attempt=1 AND root_execution_id=execution_id AND previous_execution_id IS NULL AND replay_request_id IS NULL) OR (delivery_kind='RETRY' AND attempt BETWEEN 2 AND 5 AND previous_execution_id IS NOT NULL AND replay_request_id IS NULL) OR (delivery_kind='REPLAY' AND attempt=1 AND previous_execution_id IS NOT NULL AND replay_request_id IS NOT NULL))));
CREATE UNIQUE INDEX f9_execution_replay_request_v1 ON async_exec.execution(organization_id,replay_request_id) WHERE lineage_version=1 AND replay_request_id IS NOT NULL;
CREATE FUNCTION async_exec.guard_execution_lineage_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,async_exec AS $$
BEGIN
 IF TG_OP='UPDATE' AND (OLD.execution_id,OLD.organization_id,OLD.job_type,OLD.lineage_version,OLD.delivery_kind,OLD.attempt,OLD.root_execution_id,OLD.previous_execution_id,OLD.content_digest,OLD.envelope_digest,OLD.replay_request_id)
  IS DISTINCT FROM (NEW.execution_id,NEW.organization_id,NEW.job_type,NEW.lineage_version,NEW.delivery_kind,NEW.attempt,NEW.root_execution_id,NEW.previous_execution_id,NEW.content_digest,NEW.envelope_digest,NEW.replay_request_id) THEN RAISE EXCEPTION 'F9_LINEAGE_IMMUTABLE'; END IF;
 IF TG_OP='INSERT' AND NEW.lineage_version<>1 THEN RAISE EXCEPTION 'F9_NEW_LINEAGE_REQUIRED'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION async_exec.guard_execution_lineage_v1() FROM PUBLIC;
CREATE TRIGGER guard_execution_lineage_v1 BEFORE INSERT OR UPDATE ON async_exec.execution FOR EACH ROW EXECUTE FUNCTION async_exec.guard_execution_lineage_v1();
ALTER TABLE async_exec.dead_letter ADD COLUMN lineage_version smallint,ADD COLUMN replay_request_id uuid,ADD COLUMN replay_execution_id uuid REFERENCES async_exec.execution(execution_id);
UPDATE async_exec.dead_letter SET lineage_version=0;
ALTER TABLE async_exec.dead_letter ALTER COLUMN lineage_version SET NOT NULL;
ALTER TABLE async_exec.dead_letter ADD CONSTRAINT dead_letter_lineage_check CHECK((lineage_version=0 AND replay_request_id IS NULL AND replay_execution_id IS NULL) OR (lineage_version=1));
CREATE UNIQUE INDEX f9_dead_letter_replay_request_v1 ON async_exec.dead_letter(organization_id,replay_request_id) WHERE lineage_version=1 AND replay_request_id IS NOT NULL;
CREATE TYPE async_exec.replay_request_state AS ENUM('REQUESTED','APPROVED','RESERVED','CONSUMED');
CREATE TABLE async_exec.replay_request(
 replay_request_id uuid PRIMARY KEY,organization_id uuid NOT NULL,original_execution_id uuid NOT NULL REFERENCES async_exec.execution(execution_id),root_execution_id uuid NOT NULL,
 job_type text NOT NULL CHECK(job_type IN('opportunity.duplicate.scan','opportunity.catalog.reconcile')),tenant_id uuid NOT NULL,content_digest char(64) NOT NULL CHECK(content_digest~'^[a-f0-9]{64}$'),
 requester_actor_id uuid NOT NULL,requester_membership_id uuid NOT NULL,approver_actor_id uuid,approver_membership_id uuid,
 policy_version text NOT NULL,requester_revocation_version bigint NOT NULL CHECK(requester_revocation_version>=0),approver_revocation_version bigint,
 approval_evidence_digest char(64),state async_exec.replay_request_state NOT NULL,idempotency_key text NOT NULL,request_digest char(64) NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 approved_at timestamptz,not_after timestamptz,reserved_execution_id uuid,reservation_digest char(64),consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,idempotency_key),UNIQUE(organization_id,replay_request_id),
 CHECK(requester_actor_id<>COALESCE(approver_actor_id,'00000000-0000-0000-0000-000000000000'::uuid)),CHECK(requester_membership_id<>COALESCE(approver_membership_id,'00000000-0000-0000-0000-000000000000'::uuid)),
 CHECK((state='REQUESTED' AND approver_actor_id IS NULL AND approved_at IS NULL AND reserved_execution_id IS NULL) OR
       (state IN('APPROVED','RESERVED','CONSUMED') AND approver_actor_id IS NOT NULL AND approver_membership_id IS NOT NULL AND approval_evidence_digest~'^[a-f0-9]{64}$' AND approved_at IS NOT NULL AND not_after>approved_at)),
 CHECK((state IN('RESERVED','CONSUMED'))=(reserved_execution_id IS NOT NULL)),CHECK((state='CONSUMED')=(consumed_at IS NOT NULL)));
CREATE UNIQUE INDEX f9_replay_reserved_execution ON async_exec.replay_request(reserved_execution_id) WHERE reserved_execution_id IS NOT NULL;
CREATE FUNCTION async_exec.guard_replay_request_transition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,async_exec AS $$
BEGIN
 IF (OLD.replay_request_id,OLD.organization_id,OLD.original_execution_id,OLD.root_execution_id,OLD.job_type,OLD.tenant_id,OLD.content_digest,OLD.requester_actor_id,OLD.requester_membership_id,OLD.policy_version,OLD.requester_revocation_version,OLD.idempotency_key,OLD.request_digest,OLD.created_at)
  IS DISTINCT FROM (NEW.replay_request_id,NEW.organization_id,NEW.original_execution_id,NEW.root_execution_id,NEW.job_type,NEW.tenant_id,NEW.content_digest,NEW.requester_actor_id,NEW.requester_membership_id,NEW.policy_version,NEW.requester_revocation_version,NEW.idempotency_key,NEW.request_digest,NEW.created_at) THEN RAISE EXCEPTION 'F9_REPLAY_REQUEST_IMMUTABLE'; END IF;
 IF NOT ((OLD.state='REQUESTED' AND NEW.state='APPROVED') OR (OLD.state='APPROVED' AND NEW.state='RESERVED') OR (OLD.state='RESERVED' AND NEW.state='CONSUMED')) THEN RAISE EXCEPTION 'F9_REPLAY_TRANSITION_INVALID'; END IF;
 IF OLD.state<>'REQUESTED' AND (OLD.approver_actor_id,OLD.approver_membership_id,OLD.approver_revocation_version,OLD.approval_evidence_digest,OLD.approved_at,OLD.not_after)
  IS DISTINCT FROM (NEW.approver_actor_id,NEW.approver_membership_id,NEW.approver_revocation_version,NEW.approval_evidence_digest,NEW.approved_at,NEW.not_after) THEN RAISE EXCEPTION 'F9_REPLAY_APPROVAL_IMMUTABLE'; END IF;
 IF OLD.state IN('RESERVED','CONSUMED') AND (OLD.reserved_execution_id,OLD.reservation_digest) IS DISTINCT FROM (NEW.reserved_execution_id,NEW.reservation_digest) THEN RAISE EXCEPTION 'F9_REPLAY_RESERVATION_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION async_exec.guard_replay_request_transition() FROM PUBLIC;
CREATE TRIGGER guard_replay_request_transition BEFORE UPDATE ON async_exec.replay_request FOR EACH ROW EXECUTE FUNCTION async_exec.guard_replay_request_transition();
REVOKE ALL ON async_exec.replay_request FROM PUBLIC,c4g_central_runtime;
GRANT SELECT,INSERT ON async_exec.replay_request TO c4g_central_runtime;
GRANT UPDATE(state,approver_actor_id,approver_membership_id,approver_revocation_version,approval_evidence_digest,approved_at,not_after,reserved_execution_id,reservation_digest,consumed_at) ON async_exec.replay_request TO c4g_central_runtime;
ALTER TABLE audit.event_identity DROP CONSTRAINT event_identity_event_code_check;
ALTER TABLE audit.event_identity ADD CONSTRAINT event_identity_event_code_check CHECK(event_code IN (
 'AUTHORIZATION_ALLOWED','AUTHORIZATION_DENIED','AUTHORIZATION_POLICY_INVALID','AUTHORIZATION_MFA_REQUIRED','AUTHORIZATION_VERSION_ADVANCED','GRANT_CHANGED','PROFILE_CHANGED','SOD_CHANGED','SENSITIVE_ACTION_ALLOWED','SUPPORT_GRANTED','SUPPORT_STARTED','SUPPORT_USED','SUPPORT_REVOKED','SUPPORT_EXPIRED','SERVICE_JOB_DISPATCHED','SERVICE_JOB_COMPLETED','EXPORT_ALLOWED','EXPORT_COMPLETED','DOCUMENT_ALLOWED','DOCUMENT_COMPLETED','ASYNC_EFFECT_AUTHORIZED','ASYNC_REPLAY_AUTHORIZED','ASYNC_REPLAY_REQUESTED','ASYNC_REPLAY_APPROVED','ASYNC_REPLAY_EXECUTION_CREATED','ASYNC_AUTHORIZATION_DENIED','ASYNC_JOB_OBSERVED','ASYNC_RECONCILIATION_REQUIRED','DOCUMENT_UPLOAD_INTENT_ACCEPTED','DOCUMENT_UPLOAD_CONFIRMED','DOCUMENT_SCAN_COMPLETED','DOCUMENT_ACCESS_CAPABILITY_ISSUED','DOCUMENT_VERSION_CREATED','DOCUMENT_ACCESS_BLOCKED','DOCUMENT_RECONCILIATION_DETECTED','DOCUMENT_UPLOAD_CANCELLED','DOCUMENT_LIFECYCLE_REQUESTED','OPPORTUNITY_CREATED','OPPORTUNITY_REVISION_CREATED','OPPORTUNITY_ARCHIVED','OPPORTUNITY_RESTORED','OPPORTUNITY_PROVENANCE_LINKED','OPPORTUNITY_QUALITY_EVALUATED','OPPORTUNITY_EXACT_DUPLICATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_CANDIDATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_DECISION_RECORDED','OPPORTUNITY_ACCESS_DENIED','OPPORTUNITY_RECONCILIATION_REQUIRED'));
ALTER TABLE audit.event DROP CONSTRAINT event_event_code_check,DROP CONSTRAINT event_catalog_version_check;
ALTER TABLE audit.event ADD CONSTRAINT event_event_code_check CHECK(event_code IN (
 'AUTHORIZATION_ALLOWED','AUTHORIZATION_DENIED','AUTHORIZATION_POLICY_INVALID','AUTHORIZATION_MFA_REQUIRED','AUTHORIZATION_VERSION_ADVANCED','GRANT_CHANGED','PROFILE_CHANGED','SOD_CHANGED','SENSITIVE_ACTION_ALLOWED','SUPPORT_GRANTED','SUPPORT_STARTED','SUPPORT_USED','SUPPORT_REVOKED','SUPPORT_EXPIRED','SERVICE_JOB_DISPATCHED','SERVICE_JOB_COMPLETED','EXPORT_ALLOWED','EXPORT_COMPLETED','DOCUMENT_ALLOWED','DOCUMENT_COMPLETED','ASYNC_EFFECT_AUTHORIZED','ASYNC_REPLAY_AUTHORIZED','ASYNC_REPLAY_REQUESTED','ASYNC_REPLAY_APPROVED','ASYNC_REPLAY_EXECUTION_CREATED','ASYNC_AUTHORIZATION_DENIED','ASYNC_JOB_OBSERVED','ASYNC_RECONCILIATION_REQUIRED','DOCUMENT_UPLOAD_INTENT_ACCEPTED','DOCUMENT_UPLOAD_CONFIRMED','DOCUMENT_SCAN_COMPLETED','DOCUMENT_ACCESS_CAPABILITY_ISSUED','DOCUMENT_VERSION_CREATED','DOCUMENT_ACCESS_BLOCKED','DOCUMENT_RECONCILIATION_DETECTED','DOCUMENT_UPLOAD_CANCELLED','DOCUMENT_LIFECYCLE_REQUESTED','OPPORTUNITY_CREATED','OPPORTUNITY_REVISION_CREATED','OPPORTUNITY_ARCHIVED','OPPORTUNITY_RESTORED','OPPORTUNITY_PROVENANCE_LINKED','OPPORTUNITY_QUALITY_EVALUATED','OPPORTUNITY_EXACT_DUPLICATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_CANDIDATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_DECISION_RECORDED','OPPORTUNITY_ACCESS_DENIED','OPPORTUNITY_RECONCILIATION_REQUIRED')),
 ADD CONSTRAINT event_catalog_version_check CHECK(catalog_version IN('f7-events-v1','f12-events-v1','f12-events-v2'));
