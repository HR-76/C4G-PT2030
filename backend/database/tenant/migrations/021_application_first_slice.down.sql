DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM opportunity_catalog.application LIMIT 1)
    OR EXISTS(SELECT 1 FROM opportunity_catalog.application_change LIMIT 1)
    OR EXISTS(SELECT 1 FROM opportunity_catalog.application_receipt LIMIT 1)
 THEN RAISE EXCEPTION 'Application history is occupied; downgrade refused'; END IF;
END $$;
DROP TABLE opportunity_catalog.application_receipt;
DROP TABLE opportunity_catalog.application_change;
DROP TABLE opportunity_catalog.application;
REVOKE REFERENCES(organization_id,evaluation_id) ON organization_profile.pq1_evaluation FROM c4g_opportunity_tenant_owner;
REVOKE SELECT(organization_id,evaluation_id,opportunity_id) ON organization_profile.pq1_evaluation FROM c4g_opportunity_tenant_runtime;
REVOKE EXECUTE ON FUNCTION organization_profile.guard_authoring_immutable() FROM c4g_opportunity_tenant_owner;
REVOKE USAGE ON SCHEMA organization_profile FROM c4g_opportunity_tenant_owner,c4g_opportunity_tenant_runtime;
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK (%s)',tab,name,
    replace(substring(definition from 8 for length(definition)-8),
      ' OR (event_code = ANY (ARRAY[''APPLICATION_CREATED''::text, ''APPLICATION_CHANGED''::text, ''APPLICATION_STAGE_CHANGED''::text]))',''));
 END LOOP;
END $$;
