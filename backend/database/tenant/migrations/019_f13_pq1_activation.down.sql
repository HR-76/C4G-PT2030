SET ROLE c4g_organization_profile_owner;
DO $$ DECLARE tab text; occupied boolean; BEGIN
 FOREACH tab IN ARRAY ARRAY['pq1_effective_snapshot','pq1_activation','profile_active_baseline','pq1_evaluation','pq1_effective_receipt'] LOOP
  EXECUTE format('ALTER TABLE organization_profile.%I NO FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM organization_profile.%I)',tab) INTO occupied;
  IF occupied THEN RAISE EXCEPTION 'PQ1_ACTIVATION_DOWNGRADE_REQUIRES_EMPTY_DATA'; END IF;
 END LOOP;
END $$;
DROP TABLE organization_profile.pq1_effective_receipt;
DROP TABLE organization_profile.pq1_evaluation;
DROP TABLE organization_profile.profile_active_baseline;
DROP TABLE organization_profile.pq1_activation;
DROP TABLE organization_profile.pq1_effective_snapshot;
DROP TABLE organization_profile.pq1_effective_release;
DROP FUNCTION organization_profile.guard_pq1_baseline();
RESET ROLE;
REVOKE REFERENCES(organization_id,opportunity_id) ON opportunity_catalog.opportunity FROM c4g_organization_profile_owner;
REVOKE REFERENCES(organization_id,revision_id) ON opportunity_catalog.revision,opportunity_catalog.criteria_revision FROM c4g_organization_profile_owner;
REVOKE USAGE ON SCHEMA opportunity_catalog FROM c4g_organization_profile_owner;
DO $$ DECLARE tab text; name text; definition text; pos integer; BEGIN
 IF EXISTS(SELECT 1 FROM audit.event_identity WHERE event_code IN ('PROFILE_COHORT_ACTIVATED','PREQUALIFICATION_EVALUATED','PREQUALIFICATION_ACCESSED'))
 THEN RAISE EXCEPTION 'PQ1_ACTIVATION_AUDIT_HISTORY_EXISTS'; END IF;
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  pos:=strpos(definition,' OR (event_code = ANY (ARRAY[''PROFILE_COHORT_ACTIVATED''');
  IF pos<10 THEN RAISE EXCEPTION 'PQ1_AUDIT_CONSTRAINT_UNEXPECTED'; END IF;
  definition:=substring(definition from 9 for pos-9);
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK (%s)',tab,name,definition);
 END LOOP;
END $$;
