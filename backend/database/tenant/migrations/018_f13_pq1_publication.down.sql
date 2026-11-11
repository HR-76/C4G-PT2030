SET ROLE c4g_organization_profile_owner;
ALTER TABLE organization_profile.scheme NO FORCE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM organization_profile.scheme WHERE scheme_code='COMPETENCY') THEN RAISE EXCEPTION 'PQ1_DOWNGRADE_REQUIRES_EMPTY_COMPETENCY_SCHEME'; END IF; END $$;
ALTER TABLE organization_profile.scheme FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_profile.scheme DROP CONSTRAINT scheme_scheme_code_check, DROP CONSTRAINT scheme_check;
ALTER TABLE organization_profile.scheme ADD CONSTRAINT scheme_scheme_code_check CHECK (scheme_code IN ('THEMATIC_AREA','STRATEGIC_PRIORITY','COUNTRY_TERRITORY','ADMINISTRATIVE_AREA','STATISTICAL_REGION','TRANSNATIONAL_AREA','LEGAL_NATURE','INSTITUTION_TYPE','CONTROL_STATUS','NON_PROFIT_STATUS','ECONOMIC_SIZE_CLASS','SERVED_POPULATION_GROUP')), ADD CONSTRAINT scheme_check CHECK ((scheme_code IN ('THEMATIC_AREA','STRATEGIC_PRIORITY') AND relation_domain='THEMATIC')
   OR (scheme_code IN ('COUNTRY_TERRITORY','ADMINISTRATIVE_AREA','STATISTICAL_REGION','TRANSNATIONAL_AREA') AND relation_domain='TERRITORY')
   OR (scheme_code IN ('LEGAL_NATURE','INSTITUTION_TYPE','CONTROL_STATUS','NON_PROFIT_STATUS','ECONOMIC_SIZE_CLASS','SERVED_POPULATION_GROUP') AND relation_domain='NONE'));

ALTER TABLE organization_profile.pq1_ui_receipt NO FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_profile.pq1_verification_status_event NO FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_profile.pq1_provenance NO FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_profile.pq1_method_descriptor NO FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_profile.pq1_publication NO FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_profile.pq1_version NO FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_profile.pq1_candidate_author NO FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_profile.pq1_candidate NO FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_profile.pq1_idempotency_record NO FORCE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM organization_profile.pq1_ui_receipt) OR EXISTS(SELECT 1 FROM organization_profile.pq1_verification_status_event) OR EXISTS(SELECT 1 FROM organization_profile.pq1_provenance) OR EXISTS(SELECT 1 FROM organization_profile.pq1_method_descriptor) OR EXISTS(SELECT 1 FROM organization_profile.pq1_publication) OR EXISTS(SELECT 1 FROM organization_profile.pq1_version) OR EXISTS(SELECT 1 FROM organization_profile.pq1_candidate_author) OR EXISTS(SELECT 1 FROM organization_profile.pq1_candidate) OR EXISTS(SELECT 1 FROM organization_profile.pq1_idempotency_record) THEN RAISE EXCEPTION 'PQ1_DOWNGRADE_REQUIRES_EMPTY_DATA'; END IF; END $$;
DROP TABLE organization_profile.pq1_ui_receipt;
DROP TABLE organization_profile.pq1_verification_status_event;
DROP TABLE organization_profile.pq1_provenance;
DROP TABLE organization_profile.pq1_method_descriptor;
DROP TABLE organization_profile.pq1_publication;
DROP TABLE organization_profile.pq1_version;
DROP TABLE organization_profile.pq1_candidate_author;
DROP TABLE organization_profile.pq1_candidate;
DROP TABLE organization_profile.pq1_idempotency_record;
DROP TABLE organization_profile.pq1_release;
DROP FUNCTION organization_profile.guard_pq1_effect();
RESET ROLE;

DROP FUNCTION document_storage.list_pq1_experience_references(uuid,uuid,uuid);
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
 name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
 SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
 IF EXISTS(SELECT 1 FROM audit.event_identity WHERE event_code='ASSERTION_REVOKED') THEN RAISE EXCEPTION 'PQ1_AUDIT_HISTORY_EXISTS'; END IF;
 EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
 definition:=regexp_replace(definition,' OR \(event_code = ''ASSERTION_REVOKED''::text\)\)\)$', '))');
 EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I %s',tab,name,definition);
 END LOOP;
END $$;
