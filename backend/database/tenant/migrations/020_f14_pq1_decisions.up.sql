SET ROLE c4g_organization_profile_owner;
CREATE TABLE organization_profile.pq1_decision (
 organization_id uuid NOT NULL, decision_id uuid NOT NULL, evaluation_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>0), predecessor_id uuid,
 decision text NOT NULL CHECK(decision IN ('REQUEST_INFORMATION','KEEP_UNDER_REVIEW','DISCARD_FROM_ANALYSIS')),
 reason_code text NOT NULL, justification text NOT NULL CHECK(length(btrim(justification)) BETWEEN 1 AND 2000),
 criterion_ids jsonb NOT NULL CHECK(jsonb_typeof(criterion_ids)='array'),
 subject_id uuid NOT NULL, idempotency_key uuid NOT NULL,
 intention_digest char(64) NOT NULL CHECK(intention_digest ~ '^[a-f0-9]{64}$'),
 result_projection jsonb NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,decision_id), UNIQUE(organization_id,evaluation_id,generation),
 UNIQUE(organization_id,evaluation_id,decision_id), UNIQUE(organization_id,idempotency_key),
 FOREIGN KEY(organization_id,evaluation_id) REFERENCES organization_profile.pq1_evaluation(organization_id,evaluation_id),
 FOREIGN KEY(organization_id,evaluation_id,predecessor_id) REFERENCES organization_profile.pq1_decision(organization_id,evaluation_id,decision_id),
 CHECK((generation=1)=(predecessor_id IS NULL)),
 CHECK((decision='REQUEST_INFORMATION' AND reason_code='INFORMATION_MISSING' AND jsonb_array_length(criterion_ids)>0)
 OR (decision='KEEP_UNDER_REVIEW' AND reason_code='FURTHER_REVIEW' AND jsonb_array_length(criterion_ids)=0)
 OR (decision='DISCARD_FROM_ANALYSIS' AND reason_code IN ('OUT_OF_SCOPE_FOR_ORGANIZATION','OTHER_JUSTIFIED') AND jsonb_array_length(criterion_ids)=0))
);
ALTER TABLE organization_profile.pq1_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_profile.pq1_decision FORCE ROW LEVEL SECURITY;
CREATE POLICY pq1_decision_isolation ON organization_profile.pq1_decision
 USING(organization_id=current_setting('app.organization_id',true)::uuid) WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid);
CREATE TRIGGER pq1_decision_immutable BEFORE UPDATE OR DELETE ON organization_profile.pq1_decision FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER pq1_decision_no_truncate BEFORE TRUNCATE ON organization_profile.pq1_decision FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
REVOKE ALL ON organization_profile.pq1_decision FROM PUBLIC,c4g_organization_profile_runtime;
GRANT SELECT,INSERT ON organization_profile.pq1_decision TO c4g_organization_profile_runtime;
RESET ROLE;
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK ((%s) OR event_code IN (''PREQUALIFICATION_DECIDED''))',tab,name,substring(definition from 8 for length(definition)-8));
 END LOOP;
END $$;
