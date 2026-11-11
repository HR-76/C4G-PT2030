SET ROLE c4g_organization_profile_owner;
DROP POLICY financial_metric_read ON organization_profile.metric_definition;
DO $$ DECLARE tab text; present boolean; BEGIN
 FOREACH tab IN ARRAY ARRAY['financial_catalog_release','financial_catalog_entry','financial_assertion','financial_assertion_revision','financial_idempotency_record'] LOOP
  EXECUTE format('LOCK TABLE organization_profile.%I IN ACCESS EXCLUSIVE MODE',tab);
  EXECUTE format('ALTER TABLE organization_profile.%I NO FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM organization_profile.%I)',tab) INTO present;
  IF present THEN RAISE EXCEPTION 'F13_FINANCIAL_010_DOWN_REFUSES_DATA_LOSS'; END IF;
 END LOOP;
END $$;
ALTER TABLE organization_profile.financial_assertion DROP CONSTRAINT financial_head_fk;
DROP TABLE organization_profile.financial_idempotency_record,organization_profile.financial_assertion_revision,organization_profile.financial_assertion,
 organization_profile.financial_catalog_entry,organization_profile.financial_catalog_release;
DROP FUNCTION organization_profile.guard_financial_revision(),organization_profile.guard_financial_head(),organization_profile.guard_financial_revision_head(),organization_profile.financial_entry_valid(uuid,uuid,text,text);
RESET ROLE;
REVOKE SELECT ON organization_profile.metric_catalog_release,organization_profile.metric_definition FROM c4g_organization_profile_runtime;
REVOKE EXECUTE ON FUNCTION document_storage.load_financial_reference(uuid,uuid,uuid) FROM c4g_organization_profile_runtime;
SET ROLE c4g_document_owner;
DROP FUNCTION document_storage.load_financial_reference(uuid,uuid,uuid);
RESET ROLE;
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  definition:=regexp_replace(definition,' OR \(event_code = ANY \(ARRAY\[''FINANCIAL_ASSERTION_CREATED''::text, ''FINANCIAL_ASSERTION_EDITED''::text, ''FINANCIAL_ASSERTION_READ''::text, ''FINANCIAL_ASSERTION_SUBMITTED''::text, ''FINANCIAL_FACT_VERIFIED''::text, ''FINANCIAL_ASSERTION_REJECTED''::text, ''FINANCIAL_ASSERTION_DISPUTED''::text, ''FINANCIAL_ASSERTION_REVOKED''::text\]\)\)','');
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I %s',tab,name,definition);
 END LOOP;
 SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid='audit.event'::regclass AND conname='event_catalog_version_check';
 definition:=replace(definition,' OR (catalog_version = ''f13-financial-events-v1''::text)','');
 ALTER TABLE audit.event DROP CONSTRAINT event_catalog_version_check;
 EXECUTE 'ALTER TABLE audit.event ADD CONSTRAINT event_catalog_version_check '||definition;
END $$;
