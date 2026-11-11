SET ROLE c4g_organization_profile_owner;
DO $$ DECLARE tab text; present boolean; BEGIN
 FOREACH tab IN ARRAY ARRAY['population_catalog_release','population_catalog_entry','population_assertion','population_assertion_revision','population_idempotency_record','population_geographic_concept','population_revision_territory','population_revision_group'] LOOP
  EXECUTE format('LOCK TABLE organization_profile.%I IN ACCESS EXCLUSIVE MODE',tab);
  EXECUTE format('ALTER TABLE organization_profile.%I NO FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM organization_profile.%I)',tab) INTO present;
  IF present THEN RAISE EXCEPTION 'F13_POPULATION_012_DOWN_REFUSES_DATA_LOSS'; END IF;
 END LOOP;
END $$;
ALTER TABLE organization_profile.population_assertion DROP CONSTRAINT population_head_fk;
DROP TABLE organization_profile.population_revision_territory,organization_profile.population_revision_group,organization_profile.population_geographic_concept,organization_profile.population_idempotency_record,organization_profile.population_assertion_revision,organization_profile.population_assertion,
 organization_profile.population_catalog_entry,organization_profile.population_catalog_release;
DROP FUNCTION organization_profile.guard_population_revision(),organization_profile.guard_population_head(),organization_profile.guard_population_revision_head(),organization_profile.population_entry_valid(uuid,uuid,text,text),organization_profile.materialize_population_links(),organization_profile.guard_population_link();
RESET ROLE;
REVOKE EXECUTE ON FUNCTION organizational_scope.load_population_location(uuid,uuid) FROM c4g_organization_profile_runtime;
SET ROLE c4g_organizational_scope_owner;
DROP FUNCTION organizational_scope.load_population_location(uuid,uuid);
RESET ROLE;
REVOKE EXECUTE ON FUNCTION document_storage.load_population_reference(uuid,uuid,uuid) FROM c4g_organization_profile_runtime;
SET ROLE c4g_document_owner;
DROP FUNCTION document_storage.load_population_reference(uuid,uuid,uuid);
RESET ROLE;
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  definition:=regexp_replace(definition,' OR \(event_code = ANY \(ARRAY\[''POPULATION_ASSERTION_CREATED''::text, ''POPULATION_ASSERTION_EDITED''::text, ''POPULATION_ASSERTION_READ''::text, ''POPULATION_ASSERTION_SUBMITTED''::text, ''POPULATION_ASSERTION_VERIFIED''::text, ''POPULATION_ASSERTION_REJECTED''::text, ''POPULATION_ASSERTION_DISPUTED''::text, ''POPULATION_ASSERTION_REVOKED''::text\]\)\)','');
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I %s',tab,name,definition);
 END LOOP;
 SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid='audit.event'::regclass AND conname='event_catalog_version_check';
 definition:=replace(definition,' OR (catalog_version = ''f13-population-events-v1''::text)','');
 ALTER TABLE audit.event DROP CONSTRAINT event_catalog_version_check;
 EXECUTE 'ALTER TABLE audit.event ADD CONSTRAINT event_catalog_version_check '||definition;
END $$;
