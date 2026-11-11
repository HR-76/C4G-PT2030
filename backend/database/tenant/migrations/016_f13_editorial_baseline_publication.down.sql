SET ROLE c4g_organization_profile_owner;
DO $$ DECLARE tab text; present boolean; BEGIN
 FOREACH tab IN ARRAY ARRAY['editorial_candidate','editorial_candidate_author','editorial_version','editorial_publication','editorial_idempotency_record'] LOOP
  EXECUTE format('LOCK TABLE organization_profile.%I IN ACCESS EXCLUSIVE MODE',tab);
  EXECUTE format('ALTER TABLE organization_profile.%I NO FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM organization_profile.%I)',tab) INTO present;
  IF present THEN RAISE EXCEPTION 'F13_EDITORIAL_016_DOWN_REFUSES_DATA_LOSS'; END IF;
 END LOOP;
END $$;
DROP TABLE organization_profile.editorial_publication,organization_profile.editorial_version,
 organization_profile.editorial_candidate_author,organization_profile.editorial_candidate,organization_profile.editorial_idempotency_record;
DROP FUNCTION organization_profile.guard_editorial_effect();
-- Remove only this release's technical installation, never tenant catalogs.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['completion_policy','completion_slot','completion_rule','projection_policy','compatibility_manifest','release_bundle','reason_catalog_release','reason_catalog_entry','purpose_catalog_release','purpose_catalog_entry'] LOOP
  EXECUTE format('LOCK TABLE organization_profile.%I IN ACCESS EXCLUSIVE MODE',tab);
  EXECUTE format('ALTER TABLE organization_profile.%I NO FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE organization_profile.%I DISABLE TRIGGER USER',tab);
 END LOOP;
END $$;
DELETE FROM organization_profile.reason_catalog_entry WHERE catalog_version='f13-editorial-v1';
DELETE FROM organization_profile.reason_catalog_release WHERE catalog_version='f13-editorial-v1';
DELETE FROM organization_profile.purpose_catalog_entry WHERE catalog_version='f13-editorial-v1';
DELETE FROM organization_profile.purpose_catalog_release WHERE catalog_version='f13-editorial-v1';
DELETE FROM organization_profile.release_bundle WHERE bundle_id='01600000-0000-4000-8000-000000000003';
DELETE FROM organization_profile.compatibility_manifest WHERE manifest_id='01600000-0000-4000-8000-000000000002';
DELETE FROM organization_profile.projection_policy WHERE projection_policy_id='01600000-0000-4000-8000-000000000004';
DELETE FROM organization_profile.completion_slot WHERE completion_policy_id='01600000-0000-4000-8000-000000000001';
DELETE FROM organization_profile.completion_rule WHERE completion_policy_id='01600000-0000-4000-8000-000000000001';
DELETE FROM organization_profile.completion_policy WHERE completion_policy_id='01600000-0000-4000-8000-000000000001';
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['completion_policy','completion_slot','completion_rule','projection_policy','compatibility_manifest','release_bundle','reason_catalog_release','reason_catalog_entry','purpose_catalog_release','purpose_catalog_entry'] LOOP
  EXECUTE format('ALTER TABLE organization_profile.%I ENABLE TRIGGER USER',tab);
  EXECUTE format('ALTER TABLE organization_profile.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('DROP POLICY editorial_release_read ON organization_profile.%I',tab);
  EXECUTE format('REVOKE SELECT ON organization_profile.%I FROM c4g_organization_profile_runtime',tab);
 END LOOP;
END $$;
RESET ROLE;
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  definition:=regexp_replace(definition,' OR \(event_code = ANY \(ARRAY\[''PROFILE_VERSION_APPROVED''::text, ''PROFILE_VERSION_PUBLISHED''::text, ''PROFILE_ACCESSED''::text\]\)\)','');
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I %s',tab,name,definition);
 END LOOP;
 SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid='audit.event'::regclass AND conname='event_catalog_version_check';
 definition:=replace(definition,' OR (catalog_version = ''f13-editorial-events-v1''::text)','');
 ALTER TABLE audit.event DROP CONSTRAINT event_catalog_version_check;
 EXECUTE 'ALTER TABLE audit.event ADD CONSTRAINT event_catalog_version_check '||definition;
END $$;
