-- Candidate only. Install after archive/persistence/activation candidates.
CREATE TABLE opportunity_catalog.eu_source_control_v2 (
 family text PRIMARY KEY CHECK(family='EU_FUNDING_TENDERS'),
 state text NOT NULL CHECK(state IN ('ACTIVE','SUSPEND_REQUESTED','QUIESCED')),
 fence integer NOT NULL CHECK(fence>0),
 changed_by uuid, changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO opportunity_catalog.eu_source_control_v2(family,state,fence) VALUES('EU_FUNDING_TENDERS','ACTIVE',1);
CREATE TABLE opportunity_catalog.eu_source_control_receipt_v2 (
 request_id varchar(128) PRIMARY KEY, intent_digest text NOT NULL CHECK(intent_digest ~ '^[a-f0-9]{64}$'),
 action text NOT NULL CHECK(action IN ('SUSPEND','QUIESCE','RESUME')), actor_id uuid NOT NULL,
 source_fence integer NOT NULL CHECK(source_fence>1), result jsonb NOT NULL CHECK(octet_length(result::text)<=8192),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE opportunity_catalog.eu_source_control_v2 OWNER TO c4g_opportunity_central_owner;
ALTER TABLE opportunity_catalog.eu_source_control_receipt_v2 OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON opportunity_catalog.eu_source_control_v2,opportunity_catalog.eu_source_control_receipt_v2 FROM PUBLIC;
GRANT SELECT ON opportunity_catalog.eu_source_control_v2 TO c4g_opportunity_central_runtime;
GRANT UPDATE(state,fence,changed_by,changed_at) ON opportunity_catalog.eu_source_control_v2 TO c4g_opportunity_central_runtime;
GRANT SELECT,INSERT ON opportunity_catalog.eu_source_control_receipt_v2 TO c4g_opportunity_central_runtime;
CREATE TRIGGER eu_source_receipt_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.eu_source_control_receipt_v2 FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER eu_source_receipt_no_truncate BEFORE TRUNCATE ON opportunity_catalog.eu_source_control_receipt_v2 FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
ALTER TABLE opportunity_catalog.funding_run ADD COLUMN eu_source_fence integer CHECK(eu_source_fence>0);
ALTER TABLE opportunity_catalog.funding_run ADD COLUMN eu_source_held boolean NOT NULL DEFAULT false CHECK(NOT eu_source_held OR source_code IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS'));
-- Keep the original single-active-writer invariant. A durably held EU run does
-- not occupy that slot; the control trigger reacquires it atomically on resume.
DROP INDEX opportunity_catalog.funding_one_active_run;
CREATE UNIQUE INDEX funding_one_active_run ON opportunity_catalog.funding_run((1)) WHERE status IN ('QUEUED','RUNNING') AND NOT eu_source_held;
UPDATE opportunity_catalog.funding_run SET eu_source_fence=1 WHERE source_code IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS');
GRANT SELECT(run_id,source_code,eu_source_fence,status,lease_until,created_at) ON opportunity_catalog.funding_run TO c4g_opportunity_central_owner;
GRANT SELECT(opportunity_id,external_identifier) ON opportunity_catalog.funding_identity TO c4g_opportunity_central_owner;
GRANT USAGE ON SCHEMA async_exec TO c4g_opportunity_central_owner;

GRANT SELECT(organization_id,envelope,state,lease_until,lineage_version,attempt) ON async_exec.outbox TO c4g_opportunity_central_owner;
GRANT UPDATE(state,lease_until,claim_owner,updated_at) ON async_exec.outbox TO c4g_opportunity_central_owner;
GRANT SELECT(organization_id,job_type,idempotency_key,state,lease_until,execution_id) ON async_exec.inbox TO c4g_opportunity_central_owner;

CREATE FUNCTION opportunity_catalog.eu_source_state_v2() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('family',c.family,'state',c.state,'fence',c.fence,
 'queuedRuns',(SELECT count(*)::int FROM opportunity_catalog.funding_run r WHERE r.source_code IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') AND r.status='QUEUED'),
 'pendingRuns',(SELECT count(*)::int FROM opportunity_catalog.funding_run r WHERE r.source_code IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') AND r.status IN ('QUEUED','RUNNING')),
 'otherPendingRuns',(SELECT count(*)::int FROM opportunity_catalog.funding_run r WHERE r.source_code NOT IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') AND r.status IN ('QUEUED','RUNNING')),
 'activeRunLeases',(SELECT count(*)::int FROM opportunity_catalog.funding_run r WHERE r.source_code IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') AND r.status='RUNNING' AND r.lease_until>clock_timestamp()),
 'activeOutboxLeases',(SELECT count(*)::int FROM async_exec.outbox o JOIN opportunity_catalog.funding_run r ON r.run_id::text=o.envelope#>>'{payload,runId}' WHERE o.organization_id IS NULL AND o.envelope->>'jobType'='funding_tenders.refresh' AND r.source_code IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') AND o.state='CLAIMED' AND o.lease_until>clock_timestamp()),
 'activeInboxLeases',(SELECT count(*)::int FROM async_exec.inbox i JOIN opportunity_catalog.funding_run r ON r.run_id::text=i.idempotency_key WHERE i.organization_id IS NULL AND i.job_type='funding_tenders.refresh' AND r.source_code IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') AND i.state='PROCESSING' AND i.lease_until>clock_timestamp()),
 'expiredPendingRuns',(SELECT count(*)::int FROM opportunity_catalog.funding_run r WHERE r.source_code IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') AND r.status IN ('QUEUED','RUNNING') AND r.created_at+interval '5 minutes'<=clock_timestamp()),
 'unrecoverablePendingRuns',(SELECT count(*)::int FROM opportunity_catalog.funding_run r WHERE r.source_code IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') AND r.status IN ('QUEUED','RUNNING') AND NOT EXISTS(SELECT 1 FROM async_exec.outbox o WHERE o.organization_id IS NULL AND o.envelope->>'jobType'='funding_tenders.refresh' AND o.envelope#>>'{payload,runId}'=r.run_id::text AND o.lineage_version=1 AND o.state IN ('PUBLISHED','PENDING','UNCERTAIN','CLAIMED') AND (o.envelope->>'deadlineAt')::timestamptz>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM async_exec.outbox n WHERE n.organization_id IS NULL AND n.envelope#>>'{payload,runId}'=r.run_id::text AND n.attempt>o.attempt))),
 'acceptedV2',(SELECT count(*)::int FROM opportunity_catalog.opportunity o WHERE o.current_schema_version=2 AND (EXISTS(SELECT 1 FROM opportunity_catalog.source_identity_v2 i WHERE i.opportunity_id=o.opportunity_id AND i.source_namespace='EU_FUNDING_TENDERS') OR EXISTS(SELECT 1 FROM opportunity_catalog.funding_identity f WHERE f.opportunity_id=o.opportunity_id AND f.external_identifier !~ '^(INTERREG_EUROPE|POCTEP):2021-2027:CALL:[1-9][0-9]{0,2}$'))))
 FROM opportunity_catalog.eu_source_control_v2 c WHERE c.family='EU_FUNDING_TENDERS'
$$;
CREATE FUNCTION opportunity_catalog.eu_source_execution_allowed_v2(p_source text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p_source NOT IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') OR COALESCE((SELECT state='ACTIVE' FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS'),false)
$$;
CREATE FUNCTION opportunity_catalog.assert_eu_active_v2(p_source text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c opportunity_catalog.eu_source_control_v2%ROWTYPE;
BEGIN
 IF p_source NOT IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') THEN RETURN NULL; END IF;
 SELECT * INTO STRICT c FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS' FOR SHARE;
 IF c.state<>'ACTIVE' THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_SUSPENDED'; END IF;
 RETURN c.fence;
END $$;
CREATE FUNCTION opportunity_catalog.assert_eu_quiescent_v2(p_fence integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c opportunity_catalog.eu_source_control_v2%ROWTYPE; s jsonb;
BEGIN
 SELECT * INTO STRICT c FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS' FOR SHARE;
 IF p_fence IS NULL OR c.fence<>p_fence THEN RAISE EXCEPTION 'OPPORTUNITY_V2_SOURCE_FENCE_STALE'; END IF;
 s:=opportunity_catalog.eu_source_state_v2();
 IF c.state<>'QUIESCED' OR (s->>'activeRunLeases')::integer+(s->>'activeOutboxLeases')::integer+(s->>'activeInboxLeases')::integer<>0 THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_NOT_QUIESCENT'; END IF;
END $$;
CREATE FUNCTION opportunity_catalog.guard_eu_control_v2() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s jsonb;
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'OPPORTUNITY_V2_SOURCE_CONTROL_INVALID'; END IF;
 IF NEW.family<>OLD.family OR NEW.fence<>OLD.fence+1 OR NEW.changed_by IS NULL OR
 NOT ((OLD.state='ACTIVE' AND NEW.state='SUSPEND_REQUESTED') OR (OLD.state='SUSPEND_REQUESTED' AND NEW.state='QUIESCED') OR (OLD.state IN ('SUSPEND_REQUESTED','QUIESCED') AND NEW.state='ACTIVE')) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_SOURCE_CONTROL_INVALID'; END IF;
 s:=opportunity_catalog.eu_source_state_v2();
 IF NEW.state IN ('QUIESCED','ACTIVE') AND (s->>'activeRunLeases')::integer+(s->>'activeOutboxLeases')::integer+(s->>'activeInboxLeases')::integer<>0 THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_NOT_QUIESCENT'; END IF;
 IF NEW.state='ACTIVE' AND ((s->>'acceptedV2')::integer>0 OR (s->>'expiredPendingRuns')::integer>0 OR (s->>'unrecoverablePendingRuns')::integer>0 OR ((s->>'pendingRuns')::integer>0 AND (s->>'otherPendingRuns')::integer>0)) THEN RAISE EXCEPTION 'OPPORTUNITY_V2_EU_LEGACY_RESUME_BLOCKED'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION opportunity_catalog.resume_eu_outbox_v2(p_fence integer) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c opportunity_catalog.eu_source_control_v2%ROWTYPE; changed integer;
BEGIN
 SELECT * INTO STRICT c FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS' FOR SHARE;
 IF c.state<>'ACTIVE' OR c.fence IS DISTINCT FROM p_fence THEN RAISE EXCEPTION 'OPPORTUNITY_V2_SOURCE_FENCE_STALE'; END IF;
 UPDATE async_exec.outbox o SET state='PENDING',lease_until=NULL,claim_owner=NULL,updated_at=clock_timestamp()
 FROM opportunity_catalog.funding_run r WHERE r.run_id::text=o.envelope#>>'{payload,runId}' AND r.source_code IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') AND r.status IN ('QUEUED','RUNNING')
 AND o.organization_id IS NULL AND o.envelope->>'jobType'='funding_tenders.refresh' AND o.state='PUBLISHED' AND o.lineage_version=1 AND (o.envelope->>'deadlineAt')::timestamptz>clock_timestamp()
 AND NOT EXISTS(SELECT 1 FROM async_exec.outbox n WHERE n.organization_id IS NULL AND n.envelope#>>'{payload,runId}'=r.run_id::text AND n.attempt>o.attempt);
 GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed;
END $$;
CREATE TRIGGER eu_source_control_guard BEFORE INSERT OR UPDATE OR DELETE ON opportunity_catalog.eu_source_control_v2 FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_eu_control_v2();
CREATE TRIGGER eu_source_control_no_truncate BEFORE TRUNCATE ON opportunity_catalog.eu_source_control_v2 FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.guard_eu_control_v2();
CREATE FUNCTION opportunity_catalog.sync_eu_held_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE opportunity_catalog.funding_run SET eu_source_held=NEW.state<>'ACTIVE'
 WHERE source_code IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS') AND status IN ('QUEUED','RUNNING') AND eu_source_held IS DISTINCT FROM (NEW.state<>'ACTIVE');
 RETURN NEW;
END $$;
CREATE TRIGGER eu_source_control_hold AFTER UPDATE ON opportunity_catalog.eu_source_control_v2 FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.sync_eu_held_v2();
GRANT SELECT(eu_source_held) ON opportunity_catalog.funding_run TO c4g_opportunity_central_owner;
GRANT UPDATE(eu_source_held) ON opportunity_catalog.funding_run TO c4g_opportunity_central_owner;

-- Every old SQL writer is fenced too; no application flag can bypass this.
CREATE FUNCTION opportunity_catalog.guard_eu_write_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j jsonb; oldj jsonb; src text; rid uuid; oid uuid; run_fence integer; current_fence integer; is_v2 boolean:=false; is_eu boolean:=false; c opportunity_catalog.eu_source_control_v2%ROWTYPE;
BEGIN
 IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'OPPORTUNITY_V2_SOURCE_CONTROL_INVALID'; END IF;
 j:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 oldj:=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE j END;
 IF TG_TABLE_NAME='funding_run' THEN
   src:=j->>'source_code';
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
     PERFORM opportunity_catalog.assert_eu_quiescent_v2(c.fence);
   ELSE
     current_fence:=opportunity_catalog.assert_eu_active_v2('EU_FUNDING_TENDERS');
     IF rid IS NOT NULL AND TG_TABLE_NAME IN ('funding_run_item','funding_observation','funding_candidate_v2','funding_batch') AND run_fence IS DISTINCT FROM current_fence THEN RAISE EXCEPTION 'OPPORTUNITY_V2_SOURCE_FENCE_STALE'; END IF;
   END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DO $guards$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['funding_run','funding_run_item','funding_observation','funding_candidate_v2','funding_batch','funding_cycle','funding_cycle_seen','funding_refresh_target','funding_identity','funding_resolution','provenance','opportunity','revision','source_identity_v2','source_observation_v2'] LOOP
   EXECUTE format('CREATE TRIGGER eu_source_write_guard BEFORE INSERT OR UPDATE OR DELETE ON opportunity_catalog.%I FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_eu_write_v2()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['outbox','inbox','execution','dead_letter'] LOOP
   EXECUTE format('CREATE TRIGGER eu_source_write_guard BEFORE INSERT OR UPDATE OR DELETE ON async_exec.%I FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_eu_write_v2()',t);
 END LOOP;
END $guards$;
ALTER FUNCTION opportunity_catalog.eu_source_state_v2() OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.eu_source_execution_allowed_v2(text) OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.assert_eu_active_v2(text) OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.assert_eu_quiescent_v2(integer) OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.resume_eu_outbox_v2(integer) OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.guard_eu_control_v2() OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.guard_eu_write_v2() OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.sync_eu_held_v2() OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON FUNCTION opportunity_catalog.sync_eu_held_v2() FROM PUBLIC;
REVOKE ALL ON FUNCTION opportunity_catalog.eu_source_state_v2(),opportunity_catalog.eu_source_execution_allowed_v2(text),opportunity_catalog.assert_eu_active_v2(text),opportunity_catalog.assert_eu_quiescent_v2(integer),opportunity_catalog.resume_eu_outbox_v2(integer),opportunity_catalog.guard_eu_control_v2(),opportunity_catalog.guard_eu_write_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opportunity_catalog.resume_eu_outbox_v2(integer) TO c4g_opportunity_central_runtime;
GRANT EXECUTE ON FUNCTION opportunity_catalog.eu_source_state_v2(),opportunity_catalog.eu_source_execution_allowed_v2(text),opportunity_catalog.assert_eu_active_v2(text),opportunity_catalog.assert_eu_quiescent_v2(integer) TO c4g_opportunity_central_runtime,c4g_central_runtime;
DO $source_audit$
DECLARE t text; n text; predicate text;
BEGIN
 FOREACH t IN ARRAY ARRAY['event_identity','event'] LOOP
  n:=t||'_event_code_check'; SELECT pg_get_expr(c.conbin,c.conrelid) INTO STRICT predicate FROM pg_catalog.pg_constraint c WHERE c.conrelid=format('audit.%I',t)::regclass AND c.conname=n AND c.contype='c' AND c.convalidated;
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',t,n);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK ((%s) OR event_code IN (%L,%L,%L))',t,n,predicate,'OPPORTUNITY_SOURCE_SUSPENSION_REQUESTED','OPPORTUNITY_SOURCE_QUIESCED','OPPORTUNITY_SOURCE_RESUMED');
 END LOOP;
END $source_audit$;
