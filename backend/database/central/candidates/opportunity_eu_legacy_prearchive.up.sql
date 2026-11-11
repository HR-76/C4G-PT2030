-- Candidate 045. An OIDC prearchive approval is consumed once for one EU v1
-- identity and one durable run. The automatic writer has no such receipt.
CREATE TABLE opportunity_catalog.eu_legacy_prearchive_use_v1 (
 event_id uuid PRIMARY KEY,
 event_hash text NOT NULL CHECK(event_hash ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL,
 run_id uuid NOT NULL,
 external_identifier text NOT NULL,
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 content_digest text NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'),
 evidence_fingerprint text NOT NULL CHECK(evidence_fingerprint ~ '^[a-f0-9]{64}$'),
 binding_digest text NOT NULL CHECK(binding_digest ~ '^[a-f0-9]{64}$'),
 item_digest text NOT NULL CHECK(item_digest ~ '^[a-f0-9]{64}$'),
 opportunity_id uuid NOT NULL,
 revision_id uuid NOT NULL,
 row_version integer NOT NULL CHECK(row_version > 0),
 source_fence integer NOT NULL CHECK(source_fence > 0),
 approved_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 transaction_id bigint NOT NULL,
 backend_pid integer NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(run_id,external_identifier)
);
ALTER TABLE opportunity_catalog.eu_legacy_prearchive_use_v1 OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON opportunity_catalog.eu_legacy_prearchive_use_v1 FROM PUBLIC,c4g_opportunity_central_runtime,c4g_central_runtime,c4g_eu_writer_runtime,c4g_catalog_reader;

CREATE TRIGGER eu_legacy_prearchive_use_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.eu_legacy_prearchive_use_v1
 FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER eu_legacy_prearchive_use_no_truncate BEFORE TRUNCATE ON opportunity_catalog.eu_legacy_prearchive_use_v1
 FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();

-- No general audit SELECT. The policy grants the audit owner only this exact
-- platform event, and the verifier accepts all identity and digest bindings.
CREATE POLICY audit_eu_legacy_prearchive_read_v1 ON audit.event FOR SELECT TO c4g_audit_owner
 USING(current_user='c4g_audit_owner' AND organization_id IS NULL AND tenant_id IS NULL
  AND ledger_location='CENTRAL' AND stream_id='PLATFORM:OPERATIONS' AND stream_type='OPERATIONS'
  AND event_code='SENSITIVE_ACTION_ALLOWED' AND audit_class='CRITICAL_PRE_EFFECT'
  AND event_data->>'operationCode'='OPPORTUNITY_CENTRAL_MANAGE'
  AND event_data->>'source'='EU_LEGACY_PREARCHIVE'
  AND event_data#>>'{resource,type}'='EU_LEGACY_PREARCHIVE'
  AND event_data#>>'{payload,policyVersion}'='eu-legacy-prearchive-v1'
  AND event_data#>>'{payload,detailCode}'='EU_LEGACY_PREARCHIVE_APPROVED'
  AND event_data->>'decision'='ACCEPT' AND event_data->>'outcome'='SUCCESS');

CREATE FUNCTION audit.eu_legacy_prearchive_event_v1(
 p_event uuid,p_hash text,p_actor uuid,p_external text,p_binding text,p_item text,p_content text,p_evidence text,
 p_created timestamptz,p_expires timestamptz
) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE at_time timestamptz;
BEGIN
 IF p_event IS NULL OR p_actor IS NULL OR p_external IS NULL OR p_external=''
  OR p_hash !~ '^[a-f0-9]{64}$' OR p_binding !~ '^[a-f0-9]{64}$' OR p_item !~ '^[a-f0-9]{64}$' OR p_content !~ '^[a-f0-9]{64}$' OR p_evidence !~ '^[a-f0-9]{64}$'
  OR p_created IS NULL OR p_expires IS NULL OR p_expires<=p_created
  OR p_expires>p_created+interval '1 hour' OR p_expires<=clock_timestamp()
 THEN RAISE EXCEPTION 'FUNDING_V2_PREARCHIVE_APPROVAL_REQUIRED'; END IF;
 SELECT e.accepted_at INTO STRICT at_time FROM audit.event e
 WHERE e.event_id=p_event AND e.event_hash=p_hash
  AND e.actor_type='HUMAN' AND e.actor_id=p_actor::text
  AND e.organization_id IS NULL AND e.tenant_id IS NULL
  AND e.ledger_location='CENTRAL' AND e.stream_id='PLATFORM:OPERATIONS' AND e.stream_type='OPERATIONS'
  AND e.event_code='SENSITIVE_ACTION_ALLOWED' AND e.audit_class='CRITICAL_PRE_EFFECT'
  AND e.event_data->>'operationCode'='OPPORTUNITY_CENTRAL_MANAGE'
  AND e.event_data->>'source'='EU_LEGACY_PREARCHIVE'
  AND e.event_data->>'decision'='ACCEPT' AND e.event_data->>'outcome'='SUCCESS'
  AND e.event_data#>>'{resource,type}'='EU_LEGACY_PREARCHIVE'
  AND e.event_data#>>'{resource,id}'=p_external
  AND e.event_data#>>'{subject,type}'='EU_EVIDENCE_CONTENT'
  AND e.event_data#>>'{subject,id}'=encode(sha256(convert_to(p_content||':'||p_evidence,'UTF8')),'hex')
  AND e.event_data#>>'{payload,detailCode}'='EU_LEGACY_PREARCHIVE_APPROVED'
  AND e.event_data#>>'{payload,policyVersion}'='eu-legacy-prearchive-v1'
  AND e.event_data#>>'{payload,scopeType}'='EU_LEGACY_PREARCHIVE'
  AND e.event_data#>>'{payload,scopeDigest}'=p_binding
  AND e.event_data#>>'{payload,semanticDigest}'=p_item;
 IF at_time<p_created OR at_time>p_expires OR at_time>clock_timestamp()
 THEN RAISE EXCEPTION 'FUNDING_V2_PREARCHIVE_APPROVAL_REQUIRED'; END IF;
 RETURN at_time;
 EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'FUNDING_V2_PREARCHIVE_APPROVAL_REQUIRED';
END $$;
ALTER FUNCTION audit.eu_legacy_prearchive_event_v1(uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz) OWNER TO c4g_audit_owner;
REVOKE ALL ON FUNCTION audit.eu_legacy_prearchive_event_v1(uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.eu_legacy_prearchive_event_v1(uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz) TO c4g_opportunity_central_owner;

CREATE FUNCTION opportunity_catalog.authorize_eu_legacy_prearchive_v1(
 p_event uuid,p_hash text,p_actor uuid,p_run uuid,p_external text,p_payload text,
 p_binding text,p_item text,p_opportunity uuid,p_revision uuid,p_row_version integer,
 p_fence integer,p_created timestamptz,p_expires timestamptz,p_content text,p_evidence text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE control opportunity_catalog.eu_source_control_v2%ROWTYPE;
 head record; prior opportunity_catalog.eu_legacy_prearchive_use_v1%ROWTYPE;
 at_time timestamptz;
BEGIN
 IF p_run IS NULL OR p_external IS NULL OR p_payload !~ '^[a-f0-9]{64}$'
  OR p_opportunity IS NULL OR p_revision IS NULL OR p_row_version<1 OR p_fence<1
  OR p_content !~ '^[a-f0-9]{64}$' OR p_evidence !~ '^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'FUNDING_V2_PREARCHIVE_APPROVAL_REQUIRED'; END IF;
 SELECT * INTO STRICT control FROM opportunity_catalog.eu_source_control_v2
  WHERE family='EU_FUNDING_TENDERS' FOR SHARE;
 IF control.state<>'QUIESCED' OR control.fence<>p_fence
  OR control.eu_writer_mode<>'CANONICAL_V2'
 THEN RAISE EXCEPTION 'FUNDING_V2_PREARCHIVE_STATE_CHANGED'; END IF;
 PERFORM opportunity_catalog.assert_eu_quiescent_v2(p_fence);
 SELECT o.opportunity_id,o.current_revision_id,o.row_version,o.current_schema_version,o.lifecycle_state
  INTO STRICT head FROM opportunity_catalog.funding_identity f
  JOIN opportunity_catalog.opportunity o USING(opportunity_id)
  WHERE f.external_identifier=p_external FOR SHARE OF o;
 IF head.opportunity_id<>p_opportunity OR head.current_revision_id<>p_revision
  OR head.row_version<>p_row_version OR head.current_schema_version<>1 OR head.lifecycle_state<>'ACTIVE'
 THEN RAISE EXCEPTION 'FUNDING_V2_PREARCHIVE_STATE_CHANGED'; END IF;
 at_time:=audit.eu_legacy_prearchive_event_v1(p_event,p_hash,p_actor,p_external,p_binding,p_item,p_content,p_evidence,p_created,p_expires);
 SELECT * INTO prior FROM opportunity_catalog.eu_legacy_prearchive_use_v1 WHERE event_id=p_event FOR SHARE;
 IF FOUND THEN
  IF prior.event_hash<>p_hash OR prior.actor_id<>p_actor OR prior.run_id<>p_run
    OR prior.external_identifier<>p_external OR prior.payload_digest<>p_payload OR prior.content_digest<>p_content
    OR prior.evidence_fingerprint<>p_evidence
    OR prior.binding_digest<>p_binding OR prior.item_digest<>p_item
    OR prior.opportunity_id<>p_opportunity OR prior.revision_id<>p_revision
    OR prior.row_version<>p_row_version OR prior.source_fence<>p_fence
    OR prior.approved_at<>at_time OR prior.expires_at<>p_expires
  THEN RAISE EXCEPTION 'FUNDING_V2_PREARCHIVE_APPROVAL_REQUIRED'; END IF;
  IF prior.transaction_id=txid_current() AND prior.backend_pid=pg_backend_pid()
   AND NOT EXISTS(SELECT 1 FROM opportunity_catalog.funding_candidate_v2
     WHERE run_id=p_run AND external_identifier=p_external)
  THEN RETURN 'NEW'; END IF;
  RETURN 'REPLAY';
 END IF;
 IF EXISTS(SELECT 1 FROM opportunity_catalog.funding_candidate_v2
    WHERE external_identifier=p_external)
 THEN RAISE EXCEPTION 'FUNDING_V2_PREARCHIVE_STATE_CHANGED'; END IF;
 INSERT INTO opportunity_catalog.eu_legacy_prearchive_use_v1(
  event_id,event_hash,actor_id,run_id,external_identifier,payload_digest,content_digest,evidence_fingerprint,binding_digest,item_digest,
  opportunity_id,revision_id,row_version,source_fence,approved_at,expires_at,transaction_id,backend_pid)
 VALUES(p_event,p_hash,p_actor,p_run,p_external,p_payload,p_content,p_evidence,p_binding,p_item,
  p_opportunity,p_revision,p_row_version,p_fence,at_time,p_expires,txid_current(),pg_backend_pid());
 RETURN 'NEW';
 EXCEPTION WHEN no_data_found OR too_many_rows OR unique_violation
 THEN RAISE EXCEPTION 'FUNDING_V2_PREARCHIVE_APPROVAL_REQUIRED';
END $$;
ALTER FUNCTION opportunity_catalog.authorize_eu_legacy_prearchive_v1(uuid,text,uuid,uuid,text,text,text,text,uuid,uuid,integer,integer,timestamptz,timestamptz,text,text) OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON FUNCTION opportunity_catalog.authorize_eu_legacy_prearchive_v1(uuid,text,uuid,uuid,text,text,text,text,uuid,uuid,integer,integer,timestamptz,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opportunity_catalog.authorize_eu_legacy_prearchive_v1(uuid,text,uuid,uuid,text,text,text,text,uuid,uuid,integer,integer,timestamptz,timestamptz,text,text) TO c4g_opportunity_central_runtime,c4g_central_runtime;

-- The trigger is the final barrier even if a caller bypasses the JS stage.
CREATE FUNCTION opportunity_catalog.guard_eu_legacy_prearchive_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing record; permit opportunity_catalog.eu_legacy_prearchive_use_v1%ROWTYPE;
BEGIN
 SELECT o.current_schema_version INTO existing
 FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id)
 WHERE f.external_identifier=NEW.external_identifier FOR SHARE OF o;
 IF NOT FOUND OR existing.current_schema_version<>1 THEN RETURN NEW; END IF;
 SELECT * INTO permit FROM opportunity_catalog.eu_legacy_prearchive_use_v1
 WHERE run_id=NEW.run_id AND external_identifier=NEW.external_identifier
  AND payload_digest=NEW.payload_digest AND content_digest=NEW.content_digest
  AND evidence_fingerprint=NEW.evidence_fingerprint AND transaction_id=txid_current()
  AND backend_pid=pg_backend_pid();
 IF NOT FOUND OR permit.expires_at<=clock_timestamp()
 THEN RAISE EXCEPTION 'FUNDING_V2_PREARCHIVE_APPROVAL_REQUIRED'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION opportunity_catalog.guard_eu_legacy_prearchive_v1() OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON FUNCTION opportunity_catalog.guard_eu_legacy_prearchive_v1() FROM PUBLIC;
CREATE TRIGGER funding_candidate_v2_legacy_prearchive BEFORE INSERT ON opportunity_catalog.funding_candidate_v2
 FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_eu_legacy_prearchive_v1();

-- The existing 043 source guard remains the default for every write. Only a
-- transaction-bound, consumed OIDC permit can stage a terminal migration run
-- and its exact candidate while the EU source is QUIESCED. The original guard
-- body is taken from the pinned 044 predecessor and retains all other paths.
DO $patch_prearchive_guard$
DECLARE definition text; needle text := ' IF TG_OP=''TRUNCATE'' THEN'; addition text;
BEGIN
 SELECT pg_get_functiondef('opportunity_catalog.guard_eu_write_v2()'::regprocedure)
 INTO STRICT definition;
 IF length(definition)-length(replace(definition,needle,''))<>length(needle)
 THEN RAISE EXCEPTION 'FUNDING_V2_PREARCHIVE_GUARD_DRIFT'; END IF;
 addition := $branch$
 IF TG_OP='INSERT' AND TG_TABLE_NAME='funding_run' THEN
 IF NEW.source_code='EU_FUNDING_TENDERS'
  AND NEW.status='ERROR' AND NEW.error_code='EU_LEGACY_PREARCHIVE_STAGING'
  AND NEW.finished_at IS NOT NULL AND NEW.lease_until IS NULL
  AND NEW.eu_writer_mode='CANONICAL_V2' AND NEW.eu_source_held=true
  AND EXISTS(SELECT 1 FROM opportunity_catalog.eu_legacy_prearchive_use_v1 p
   JOIN opportunity_catalog.eu_source_control_v2 sc ON sc.family='EU_FUNDING_TENDERS'
   WHERE p.run_id=NEW.run_id AND p.actor_id=NEW.requested_by
    AND p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid()
    AND p.expires_at>clock_timestamp() AND sc.state='QUIESCED'
    AND sc.fence=p.source_fence AND NEW.eu_source_fence=sc.fence
    AND NEW.eu_writer_policy=sc.eu_writer_policy
    AND NEW.eu_writer_mapping_digest=sc.eu_writer_mapping_digest)
 THEN
  PERFORM opportunity_catalog.assert_eu_quiescent_v2(NEW.eu_source_fence);
  RETURN NEW;
 END IF;
 END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME='funding_candidate_v2' THEN
 IF NEW.source_selection='EU_FUNDING_TENDERS'
  AND EXISTS(SELECT 1 FROM opportunity_catalog.eu_legacy_prearchive_use_v1 p
   JOIN opportunity_catalog.eu_source_control_v2 sc ON sc.family='EU_FUNDING_TENDERS'
   JOIN opportunity_catalog.funding_run r ON r.run_id=p.run_id
   WHERE p.run_id=NEW.run_id AND p.external_identifier=NEW.external_identifier
    AND p.payload_digest=NEW.payload_digest AND p.content_digest=NEW.content_digest
    AND p.evidence_fingerprint=NEW.evidence_fingerprint
    AND p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid()
    AND p.expires_at>clock_timestamp() AND sc.state='QUIESCED'
    AND sc.fence=p.source_fence AND r.eu_source_fence=sc.fence
    AND r.eu_writer_mode='CANONICAL_V2' AND r.eu_writer_policy=sc.eu_writer_policy
    AND r.eu_writer_mapping_digest=sc.eu_writer_mapping_digest
    AND r.status='ERROR' AND r.error_code='EU_LEGACY_PREARCHIVE_STAGING'
    AND r.eu_source_held=true)
 THEN
  PERFORM opportunity_catalog.assert_eu_quiescent_v2((SELECT source_fence
    FROM opportunity_catalog.eu_legacy_prearchive_use_v1
    WHERE run_id=NEW.run_id AND external_identifier=NEW.external_identifier));
  RETURN NEW;
 END IF;
 END IF;
$branch$;
 EXECUTE replace(definition,needle,addition||needle);
END $patch_prearchive_guard$;
