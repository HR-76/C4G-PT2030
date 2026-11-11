SET ROLE c4g_organization_profile_owner;
DO $$ DECLARE tab text; present boolean; BEGIN
 FOREACH tab IN ARRAY ARRAY['competency_catalog_release','competency_catalog_entry','competency_assertion_version','experience_evidence_version',
  'competency_evidence_link','competency_verification_result','competency_revision_member','competency_idempotency_record'] LOOP
  EXECUTE format('LOCK TABLE organization_profile.%I IN ACCESS EXCLUSIVE MODE',tab);
  EXECUTE format('ALTER TABLE organization_profile.%I NO FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM organization_profile.%I)',tab) INTO present;
  IF present THEN RAISE EXCEPTION 'F13_COMPETENCY_009_DOWN_REFUSES_DATA_LOSS'; END IF;
 END LOOP;
END $$;
DROP TABLE organization_profile.competency_idempotency_record,organization_profile.competency_revision_member,
 organization_profile.competency_verification_result,organization_profile.competency_evidence_link,
 organization_profile.experience_evidence_version,organization_profile.competency_assertion_version,
 organization_profile.competency_catalog_entry,organization_profile.competency_catalog_release;
DROP FUNCTION organization_profile.guard_competency_material();
RESET ROLE;
REVOKE EXECUTE ON FUNCTION document_storage.load_competency_reference(uuid,uuid) FROM c4g_organization_profile_runtime;
SET ROLE c4g_document_owner;
DROP FUNCTION document_storage.load_competency_reference(uuid,uuid);
RESET ROLE;
REVOKE USAGE ON SCHEMA document_storage FROM c4g_organization_profile_runtime;
REVOKE REFERENCES(organization_id,document_id,version_id) ON document_storage.document_version FROM c4g_organization_profile_owner;
REVOKE USAGE ON SCHEMA document_storage FROM c4g_organization_profile_owner;
-- Restore the exact 008 definitions by removing only the outer 009 alternative.
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  definition:=regexp_replace(definition,' OR \(event_code = ANY \(ARRAY\[''EVIDENCE_ATTACHED''::text, ''COMPETENCY_ASSERTION_VERIFIED''::text, ''EVIDENCE_LINK_ACCESSED''::text\]\)\)','');
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I %s',tab,name,definition);
 END LOOP;
 SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid='audit.event'::regclass AND conname='event_catalog_version_check';
 definition:=replace(definition,' OR (catalog_version = ''f13-competency-events-v1''::text)','');
 ALTER TABLE audit.event DROP CONSTRAINT event_catalog_version_check;
 EXECUTE 'ALTER TABLE audit.event ADD CONSTRAINT event_catalog_version_check '||definition;
END $$;
