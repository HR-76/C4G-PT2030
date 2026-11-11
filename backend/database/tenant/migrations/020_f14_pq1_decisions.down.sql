SET ROLE c4g_organization_profile_owner;
ALTER TABLE organization_profile.pq1_decision NO FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM organization_profile.pq1_decision) THEN RAISE EXCEPTION 'PQ1_DECISION_DOWNGRADE_REQUIRES_EMPTY_DATA'; END IF;
END $$;
DROP TABLE organization_profile.pq1_decision;
RESET ROLE;
DO $$ DECLARE tab text; name text; definition text; pos integer; BEGIN
 IF EXISTS(SELECT 1 FROM audit.event_identity WHERE event_code='PREQUALIFICATION_DECIDED') THEN RAISE EXCEPTION 'PQ1_DECISION_AUDIT_HISTORY_EXISTS'; END IF;
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  pos:=strpos(definition,' OR (event_code = ''PREQUALIFICATION_DECIDED''');
  IF pos<10 THEN RAISE EXCEPTION 'PQ1_DECISION_CONSTRAINT_UNEXPECTED'; END IF;
  definition:=substring(definition from 9 for pos-9);
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK (%s)',tab,name,definition);
 END LOOP;
END $$;
