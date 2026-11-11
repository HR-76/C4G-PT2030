-- Never discard editorial history on downgrade.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM opportunity_catalog.criteria_set) THEN RAISE EXCEPTION 'CRITERIA_DATA_PRESENT'; END IF; END $$;
ALTER TABLE opportunity_catalog.criteria_set DROP CONSTRAINT criteria_set_organization_id_set_id_head_revision_id_fkey;
DROP TABLE opportunity_catalog.criteria_receipt,opportunity_catalog.criteria_confirmation,opportunity_catalog.criteria_revision,opportunity_catalog.criteria_set;

DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
 name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
 SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
 definition:=regexp_replace(definition,' OR \(event_code = ANY \(ARRAY\[''OPPORTUNITY_CRITERIA_ACCESSED''::text, ''OPPORTUNITY_CRITERIA_REVISION_CREATED''::text, ''OPPORTUNITY_CRITERIA_REVISION_CONFIRMED''::text\]\)\)','');
 EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
 EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I %s',tab,name,definition);
 END LOOP;
END $$;
