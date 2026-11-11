SET ROLE c4g_organization_profile_owner;
DO $$ DECLARE tab text; present boolean; BEGIN
 FOREACH tab IN ARRAY ARRAY['operational_catalog_release','operational_catalog_entry','operational_assertion','operational_assertion_revision','operational_idempotency_record'] LOOP
  EXECUTE format('LOCK TABLE organization_profile.%I IN ACCESS EXCLUSIVE MODE',tab);
  EXECUTE format('ALTER TABLE organization_profile.%I NO FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM organization_profile.%I)',tab) INTO present;
  IF present THEN RAISE EXCEPTION 'F13_OPERATIONAL_011_DOWN_REFUSES_DATA_LOSS'; END IF;
 END LOOP;
END $$;
ALTER TABLE organization_profile.operational_assertion DROP CONSTRAINT operational_head_fk;
DROP TABLE organization_profile.operational_idempotency_record,organization_profile.operational_assertion_revision,organization_profile.operational_assertion,
 organization_profile.operational_catalog_entry,organization_profile.operational_catalog_release;
DROP FUNCTION organization_profile.guard_operational_revision(),organization_profile.guard_operational_head(),organization_profile.guard_operational_revision_head(),organization_profile.operational_entry_valid(uuid,uuid,text,text);
RESET ROLE;
REVOKE EXECUTE ON FUNCTION organizational_scope.load_operational_location(uuid,uuid) FROM c4g_organization_profile_runtime;
SET ROLE c4g_organizational_scope_owner;
DROP FUNCTION organizational_scope.load_operational_location(uuid,uuid);
RESET ROLE;
REVOKE EXECUTE ON FUNCTION document_storage.load_operational_reference(uuid,uuid,uuid) FROM c4g_organization_profile_runtime;
SET ROLE c4g_document_owner;
DROP FUNCTION document_storage.load_operational_reference(uuid,uuid,uuid);
RESET ROLE;
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  definition:=regexp_replace(definition,' OR \(event_code = ANY \(ARRAY\[''OPERATIONAL_ASSERTION_CREATED''::text, ''OPERATIONAL_ASSERTION_EDITED''::text, ''OPERATIONAL_ASSERTION_READ''::text, ''OPERATIONAL_ASSERTION_SUBMITTED''::text, ''OPERATIONAL_ASSERTION_VERIFIED''::text, ''OPERATIONAL_ASSERTION_REJECTED''::text, ''OPERATIONAL_ASSERTION_DISPUTED''::text, ''OPERATIONAL_ASSERTION_REVOKED''::text\]\)\)','');
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I %s',tab,name,definition);
 END LOOP;
 SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid='audit.event'::regclass AND conname='event_catalog_version_check';
 definition:=replace(definition,' OR (catalog_version = ''f13-operational-events-v1''::text)','');
 ALTER TABLE audit.event DROP CONSTRAINT event_catalog_version_check;
 EXECUTE 'ALTER TABLE audit.event ADD CONSTRAINT event_catalog_version_check '||definition;
END $$;
