-- CANDIDATE ONLY. After S2/S4 archives, S6 persistence and authority candidate.
-- Not registered in the executable migration manifest.
CREATE TABLE opportunity_catalog.activation_plan_v2 (
 plan_id uuid PRIMARY KEY,
 prepared_request_id varchar(128) NOT NULL UNIQUE,
 prepared_by uuid NOT NULL,
 source_code text NOT NULL CHECK (source_code IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS','INTERREG_EUROPE','POCTEP','C4G_MANUAL')),
 archive_locator jsonb NOT NULL CHECK (jsonb_typeof(archive_locator)='object' AND octet_length(archive_locator::text)<=2048),
 archive_digest text NOT NULL CHECK (archive_digest ~ '^[a-f0-9]{64}$'),
 candidate_id varchar(128) NOT NULL,
 mapping_digest text NOT NULL CHECK (mapping_digest ~ '^[a-f0-9]{64}$'),
 snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^[a-f0-9]{64}$'),
 expected jsonb CHECK (expected IS NULL OR jsonb_typeof(expected)='object' AND octet_length(expected::text)<=2048),
 preview jsonb NOT NULL CHECK (jsonb_typeof(preview)='object' AND octet_length(preview::text)<=65536),
 preview_digest text NOT NULL CHECK (preview_digest ~ '^[a-f0-9]{64}$'),
 plan_digest text NOT NULL CHECK (plan_digest ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','APPROVED','REVOKED')),
 fence integer NOT NULL DEFAULT 1 CHECK (fence>0),
 prepared_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 expires_at timestamptz NOT NULL,
 approved_by uuid, approved_at timestamptz,
 revoked_by uuid, revoked_at timestamptz,
 CHECK (expires_at>prepared_at AND expires_at<=prepared_at+interval '1 hour'),
 CHECK ((state='DRAFT' AND fence=1 AND approved_by IS NULL AND approved_at IS NULL AND revoked_by IS NULL AND revoked_at IS NULL)
   OR (state='APPROVED' AND fence=2 AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND revoked_by IS NULL AND revoked_at IS NULL)
   OR (state='REVOKED' AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND
     ((fence=2 AND approved_by IS NULL AND approved_at IS NULL) OR (fence=3 AND approved_by IS NOT NULL AND approved_at IS NOT NULL))))
);
CREATE TABLE opportunity_catalog.activation_decision_v2 (
 request_id varchar(128) PRIMARY KEY,
 plan_id uuid NOT NULL REFERENCES opportunity_catalog.activation_plan_v2(plan_id),
 decision text NOT NULL CHECK (decision IN ('APPROVED','REVOKED')),
 actor_id uuid NOT NULL,
 intent_digest text NOT NULL CHECK (intent_digest ~ '^[a-f0-9]{64}$'),
 result jsonb NOT NULL CHECK (octet_length(result::text)<=8192),
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE FUNCTION opportunity_catalog.guard_activation_plan_v2() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.state<>'DRAFT' THEN RAISE EXCEPTION 'activation starts as draft' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 IF TG_OP<>'UPDATE' OR TG_TABLE_NAME<>'activation_plan_v2' THEN RAISE EXCEPTION 'activation plan immutable' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','fence','approved_by','approved_at','revoked_by','revoked_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['state','fence','approved_by','approved_at','revoked_by','revoked_at'])
   OR NOT ((OLD.state='DRAFT' AND NEW.state IN ('APPROVED','REVOKED')) OR (OLD.state='APPROVED' AND NEW.state='REVOKED'))
   OR NEW.fence<>OLD.fence+1
   OR (OLD.state='APPROVED' AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at))
 THEN RAISE EXCEPTION 'activation plan immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER activation_plan_v2_guard BEFORE INSERT OR UPDATE OR DELETE ON opportunity_catalog.activation_plan_v2 FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_activation_plan_v2();
CREATE TRIGGER activation_plan_v2_no_truncate BEFORE TRUNCATE ON opportunity_catalog.activation_plan_v2 FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.guard_activation_plan_v2();
CREATE TRIGGER activation_decision_v2_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.activation_decision_v2 FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.guard_activation_plan_v2();
CREATE TRIGGER activation_decision_v2_no_truncate BEFORE TRUNCATE ON opportunity_catalog.activation_decision_v2 FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.guard_activation_plan_v2();
ALTER TABLE opportunity_catalog.activation_plan_v2 OWNER TO c4g_opportunity_central_owner;
ALTER TABLE opportunity_catalog.activation_decision_v2 OWNER TO c4g_opportunity_central_owner;
ALTER FUNCTION opportunity_catalog.guard_activation_plan_v2() OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON opportunity_catalog.activation_plan_v2,opportunity_catalog.activation_decision_v2 FROM PUBLIC;
REVOKE ALL ON FUNCTION opportunity_catalog.guard_activation_plan_v2() FROM PUBLIC;
GRANT SELECT,INSERT ON opportunity_catalog.activation_plan_v2,opportunity_catalog.activation_decision_v2 TO c4g_opportunity_central_runtime;
GRANT UPDATE(state,fence,approved_by,approved_at,revoked_by,revoked_at) ON opportunity_catalog.activation_plan_v2 TO c4g_opportunity_central_runtime;
