-- F13 editorial-only release. No activation or effective snapshot.
SET ROLE c4g_organization_profile_owner;
CREATE TABLE organization_profile.editorial_candidate (
 candidate_id uuid PRIMARY KEY, organization_id uuid NOT NULL, profile_scope_id uuid NOT NULL,
 draft_id uuid NOT NULL, source_revision bigint NOT NULL,
 source_digest char(64) NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 editorial_digest char(64) NOT NULL CHECK(editorial_digest ~ '^[a-f0-9]{64}$'),
 candidate_digest char(64) NOT NULL CHECK(candidate_digest ~ '^[a-f0-9]{64}$'),
 completion_digest char(64) NOT NULL CHECK(completion_digest ~ '^[a-f0-9]{64}$'),
 extractor_version text NOT NULL CHECK(extractor_version='F13_THEMATIC_CUT_V1'),
 identity_record jsonb NOT NULL CHECK(jsonb_typeof(identity_record)='object'),
 editorial_content jsonb NOT NULL CHECK(jsonb_typeof(editorial_content)='object'),
 completion_record jsonb NOT NULL CHECK((completion_record->>'result' IN ('COMPLETE','INCOMPLETE')) IS TRUE),
 submitter_subject_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,candidate_id), UNIQUE(organization_id,draft_id,source_revision,extractor_version),
 FOREIGN KEY(organization_id,draft_id,profile_scope_id,source_revision)
 REFERENCES organization_profile.profile_draft_revision(organization_id,draft_id,profile_scope_id,revision),
 CHECK((editorial_content->>'kind'='F13_EDITORIAL_CONTENT_V1'
   AND editorial_content->'schema'='{"id":"F13_ORG_EDITORIAL_BASELINE","version":"1.0.0"}'::jsonb
   AND editorial_content->>'extractorVersion'=extractor_version
   AND editorial_content->>'scopeType'='ORGANIZATION'
   AND jsonb_typeof(editorial_content->'items')='array'
   AND editorial_content->'coverage'='{"includedDomains":["STRATEGIC_PRIORITY","THEMATIC_AREA"],"excludedDomains":["COMPETENCY","CONSTRAINT","EXPERIENCE","FINANCIAL","OPERATIONAL","SERVED_POPULATION","TARGET_GROUP","TERRITORY"],"scopeType":"ORGANIZATION","constraintsAssessed":false,"effectiveSnapshot":false,"f14Consumable":false}'::jsonb) IS TRUE),
 CHECK((identity_record->>'organizationId'=organization_id::text
   AND identity_record->>'profileScopeId'=profile_scope_id::text
   AND identity_record->'source'->>'draftId'=draft_id::text
   AND identity_record->'source'->>'revision'=source_revision::text
   AND identity_record->'source'->>'digest'=source_digest::text
   AND identity_record->>'editorialDigest'=editorial_digest::text
   AND identity_record->>'completionDigest'=completion_digest::text
   AND identity_record->>'submitterSubjectId'=submitter_subject_id::text
   AND jsonb_typeof(identity_record->'authors')='array'
   AND jsonb_array_length(identity_record->'authors')>0) IS TRUE)
);
CREATE TABLE organization_profile.editorial_candidate_author (
 organization_id uuid NOT NULL,candidate_id uuid NOT NULL,subject_id uuid NOT NULL,
 reasons text[] NOT NULL CHECK(cardinality(reasons)>0 AND reasons <@ ARRAY['MATERIAL','SELECTION','SUBMITTER']::text[]),
 evidence_refs jsonb NOT NULL CHECK(jsonb_typeof(evidence_refs)='array'),
 PRIMARY KEY(organization_id,candidate_id,subject_id),
 FOREIGN KEY(organization_id,candidate_id) REFERENCES organization_profile.editorial_candidate(organization_id,candidate_id)
);
CREATE TABLE organization_profile.editorial_version (
 version_id uuid PRIMARY KEY,organization_id uuid NOT NULL,candidate_id uuid NOT NULL,
 version_digest char(64) NOT NULL CHECK(version_digest ~ '^[a-f0-9]{64}$'),
 approver_subject_id uuid NOT NULL,approver_membership_id uuid NOT NULL,
 approval_evidence jsonb NOT NULL CHECK((jsonb_typeof(approval_evidence)='object'
   AND approval_evidence->>'subjectId'=approver_subject_id::text
   AND approval_evidence->>'membershipId'=approver_membership_id::text) IS TRUE),
 approved_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,version_id),UNIQUE(organization_id,candidate_id),
 FOREIGN KEY(organization_id,candidate_id) REFERENCES organization_profile.editorial_candidate(organization_id,candidate_id)
);
CREATE TABLE organization_profile.editorial_publication (
 publication_id uuid PRIMARY KEY,organization_id uuid NOT NULL,version_id uuid NOT NULL,
 publisher_subject_id uuid NOT NULL,publication_evidence jsonb NOT NULL CHECK(jsonb_typeof(publication_evidence)='object'),
 published_at timestamptz NOT NULL DEFAULT transaction_timestamp(),UNIQUE(organization_id,version_id),
 FOREIGN KEY(organization_id,version_id) REFERENCES organization_profile.editorial_version(organization_id,version_id)
);
CREATE TABLE organization_profile.editorial_idempotency_record (
 organization_id uuid NOT NULL,operation text NOT NULL CHECK(operation IN ('EDITORIAL_SUBMIT','EDITORIAL_APPROVE','EDITORIAL_PUBLISH')),
 idempotency_key uuid NOT NULL,intention_digest char(64) NOT NULL CHECK(intention_digest ~ '^[a-f0-9]{64}$'),
 result_projection jsonb NOT NULL CHECK(jsonb_typeof(result_projection)='object'),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),PRIMARY KEY(organization_id,operation,idempotency_key)
);
CREATE FUNCTION organization_profile.guard_editorial_effect() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,organization_profile AS $$
DECLARE candidate organization_profile.editorial_candidate; author_id uuid;
BEGIN
 IF TG_TABLE_NAME='editorial_candidate' THEN
  IF NOT EXISTS(SELECT 1 FROM organization_profile.profile_draft_revision r
   JOIN organization_profile.profile_scope s USING(organization_id,profile_scope_id)
   WHERE r.organization_id=NEW.organization_id AND r.draft_id=NEW.draft_id AND r.revision=NEW.source_revision
   AND r.lifecycle='SUBMITTED' AND r.semantic_digest=NEW.source_digest AND s.scope_type='ORGANIZATION')
  THEN RAISE EXCEPTION 'F13_EDITORIAL_SOURCE_INVALID'; END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='editorial_publication' THEN
  SELECT c.* INTO STRICT candidate FROM organization_profile.editorial_candidate c
   JOIN organization_profile.editorial_version v USING(organization_id,candidate_id)
   WHERE v.organization_id=NEW.organization_id AND v.version_id=NEW.version_id;
  author_id:=NEW.publisher_subject_id;
 ELSE
  SELECT * INTO STRICT candidate FROM organization_profile.editorial_candidate
   WHERE organization_id=NEW.organization_id AND candidate_id=NEW.candidate_id;
  IF TG_TABLE_NAME='editorial_candidate_author' THEN
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(candidate.identity_record->'authors') a
    WHERE a->>'subjectId'=NEW.subject_id::text AND a->'reasons'=to_jsonb(NEW.reasons) AND a->'evidenceRefs'=NEW.evidence_refs)
   THEN RAISE EXCEPTION 'F13_EDITORIAL_AUTHOR_INVALID'; END IF;
   RETURN NEW;
  END IF;
  author_id:=NEW.approver_subject_id;
  IF candidate.completion_record->>'result'<>'COMPLETE' OR candidate.candidate_digest<>NEW.version_digest
   THEN RAISE EXCEPTION 'F13_EDITORIAL_APPROVAL_INVALID'; END IF;
 END IF;
 IF author_id=candidate.submitter_subject_id OR EXISTS(
  SELECT 1 FROM jsonb_array_elements(candidate.identity_record->'authors') a WHERE a->>'subjectId'=author_id::text)
 THEN RAISE EXCEPTION 'F13_EDITORIAL_SOD_DENIED'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['editorial_candidate','editorial_candidate_author','editorial_version','editorial_publication','editorial_idempotency_record'] LOOP
  EXECUTE format('ALTER TABLE organization_profile.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE organization_profile.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY editorial_isolation ON organization_profile.%I USING(organization_id=current_setting(''app.organization_id'',true)::uuid) WITH CHECK(organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
  EXECUTE format('CREATE TRIGGER editorial_append_only BEFORE UPDATE OR DELETE ON organization_profile.%I FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  EXECUTE format('CREATE TRIGGER editorial_no_truncate BEFORE TRUNCATE ON organization_profile.%I FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  IF tab<>'editorial_idempotency_record' THEN
   EXECUTE format('CREATE TRIGGER editorial_effect_guard BEFORE INSERT ON organization_profile.%I FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_editorial_effect()',tab);
  END IF;
  EXECUTE format('REVOKE ALL ON organization_profile.%I FROM PUBLIC,c4g_organization_profile_runtime',tab);
  EXECUTE format('GRANT SELECT,INSERT ON organization_profile.%I TO c4g_organization_profile_runtime',tab);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION organization_profile.guard_editorial_effect() FROM PUBLIC;

-- These catalogs are database-local technical release metadata. Installation
-- temporarily lifts FORCE for their owner only, never grants runtime writes.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['completion_policy','completion_slot','completion_rule','projection_policy','compatibility_manifest','release_bundle','reason_catalog_release','reason_catalog_entry','purpose_catalog_release','purpose_catalog_entry'] LOOP
  EXECUTE format('ALTER TABLE organization_profile.%I NO FORCE ROW LEVEL SECURITY',tab);
 END LOOP;
END $$;
INSERT INTO organization_profile.reason_catalog_release VALUES ('f13-editorial-v1','DRAFT','b39aa955f1f6f9ba0ab0d0a39a418391e5c38d7e9daef7961cda5ddef3f4e12b',NULL);
INSERT INTO organization_profile.reason_catalog_entry VALUES ('f13-editorial-v1','DUPLICATE_CONCEPT','F13_PROFILE_SUBMIT','PUBLISHED');
INSERT INTO organization_profile.reason_catalog_entry VALUES ('f13-editorial-v1','INVALID_CARDINALITY','F13_PROFILE_SUBMIT','PUBLISHED');
INSERT INTO organization_profile.reason_catalog_entry VALUES ('f13-editorial-v1','KNOWN_REQUIRED','F13_PROFILE_SUBMIT','PUBLISHED');
INSERT INTO organization_profile.reason_catalog_entry VALUES ('f13-editorial-v1','NON_CURRENT_MATERIAL','F13_PROFILE_SUBMIT','PUBLISHED');
INSERT INTO organization_profile.reason_catalog_entry VALUES ('f13-editorial-v1','REFERENCE_INCOMPATIBLE','F13_PROFILE_SUBMIT','PUBLISHED');
INSERT INTO organization_profile.reason_catalog_entry VALUES ('f13-editorial-v1','REQUIRED_SLOT_MISSING','F13_PROFILE_SUBMIT','PUBLISHED');
INSERT INTO organization_profile.reason_catalog_entry VALUES ('f13-editorial-v1','STATE_NOT_ALLOWED','F13_PROFILE_SUBMIT','PUBLISHED');
INSERT INTO organization_profile.reason_catalog_entry VALUES ('f13-editorial-v1','UNKNOWN_EXPLICIT','F13_PROFILE_SUBMIT','PUBLISHED');
UPDATE organization_profile.reason_catalog_release SET lifecycle='PUBLISHED',published_at=transaction_timestamp() WHERE catalog_version='f13-editorial-v1';
INSERT INTO organization_profile.purpose_catalog_release VALUES ('f13-editorial-v1','DRAFT','b97b8fa5c16ad837dcba59a0b9f72b6d6509da054c54dd9a75a806cd739dbd13',NULL);
INSERT INTO organization_profile.purpose_catalog_entry VALUES ('f13-editorial-v1','EDITORIAL_BASELINE','F13_PROFILE_READ','PUBLISHED');
UPDATE organization_profile.purpose_catalog_release SET lifecycle='PUBLISHED',published_at=transaction_timestamp() WHERE catalog_version='f13-editorial-v1';
INSERT INTO organization_profile.completion_policy VALUES
 ('01600000-0000-4000-8000-000000000001','F13_EDITORIAL_THEME_REQUIRED_V1','1.0.0','ORGANIZATION','EDITORIAL_BASELINE','DRAFT','1893896d154ebb34208ccd2ee77556fd5b3c7b7dd79b50fdd66e268df322a7d6');
INSERT INTO organization_profile.completion_slot VALUES ('01600000-0000-4000-8000-000000000001','STRATEGIC_PRIORITIES',ARRAY['KNOWN','UNKNOWN']::text[],'UNVERIFIED_ALLOWED',ARRAY['UNKNOWN_EXPLICIT']::text[]);
INSERT INTO organization_profile.completion_slot VALUES ('01600000-0000-4000-8000-000000000001','THEMATIC_AREAS',ARRAY['KNOWN']::text[],'UNVERIFIED_ALLOWED',ARRAY[]::text[]);
INSERT INTO organization_profile.completion_rule VALUES ('01600000-0000-4000-8000-000000000001','MAXIMUM_ITEMS','FORBID_COMBINATION','{"maximumItems":100}'::jsonb);
INSERT INTO organization_profile.completion_rule VALUES ('01600000-0000-4000-8000-000000000001','PRIORITIES_REQUIRED','REQUIRE_SLOT','{"minimum":1,"slot":"STRATEGIC_PRIORITIES","unknownExclusive":true}'::jsonb);
INSERT INTO organization_profile.completion_rule VALUES ('01600000-0000-4000-8000-000000000001','THEMES_REQUIRED','REQUIRE_SLOT','{"minimum":1,"slot":"THEMATIC_AREAS"}'::jsonb);
INSERT INTO organization_profile.projection_policy VALUES
 ('01600000-0000-4000-8000-000000000004','f13-editorial-v1','F13_PROFILE_READ','EDITORIAL_BASELINE','INTERNAL','EXACT','DRAFT','b2ad2645686b51aa788810ca9e416f1e21ddb657acc6f2abbc214a42fc6da74b');
INSERT INTO organization_profile.compatibility_manifest VALUES
 ('01600000-0000-4000-8000-000000000002','f13-editorial-v1','4742209ea8f7ef001b78d48088644661c49a0bce1123374c0fd311c70722e5ba','DRAFT',NULL);
INSERT INTO organization_profile.release_bundle VALUES
 ('01600000-0000-4000-8000-000000000003','01600000-0000-4000-8000-000000000002','f13-editorial-v1','1.0.0','F13_EDITORIAL_VERSION_V1','{"adapters":[],"completion":{"digest":"1893896d154ebb34208ccd2ee77556fd5b3c7b7dd79b50fdd66e268df322a7d6","id":"01600000-0000-4000-8000-000000000001","version":"F13_EDITORIAL_THEME_REQUIRED_V1"},"consumer":{"contract":"F13_EDITORIAL_READ_V1","f14Consumable":false},"coverage":{"constraintsAssessed":false,"effectiveSnapshot":false,"excludedDomains":["COMPETENCY","CONSTRAINT","EXPERIENCE","FINANCIAL","OPERATIONAL","SERVED_POPULATION","TARGET_GROUP","TERRITORY"],"f14Consumable":false,"includedDomains":["STRATEGIC_PRIORITY","THEMATIC_AREA"],"scopeType":"ORGANIZATION"},"eventSchema":"f13-editorial-events-v1","extractor":"F13_THEMATIC_CUT_V1","jobs":[],"operationCatalog":"f13-taxonomy-operations-v1","permissionCatalog":"f13-taxonomy-permissions-v1","projection":{"digest":"b2ad2645686b51aa788810ca9e416f1e21ddb657acc6f2abbc214a42fc6da74b","id":"01600000-0000-4000-8000-000000000004","version":"f13-editorial-v1"},"purposeCatalog":{"digest":"b97b8fa5c16ad837dcba59a0b9f72b6d6509da054c54dd9a75a806cd739dbd13","version":"f13-editorial-v1"},"reasonCatalog":{"digest":"b39aa955f1f6f9ba0ab0d0a39a418391e5c38d7e9daef7961cda5ddef3f4e12b","version":"f13-editorial-v1"},"schema":{"id":"F13_ORG_EDITORIAL_BASELINE","version":"1.0.0"},"taxonomy":"F13_PINNED_THEMATIC_REFERENCES_V1","wireSchema":"F13_EDITORIAL_VERSION_V1"}'::jsonb,'4e516e2c7c642a0b15598ad8dfc6d15a0969eee0aa11239444096c7086ed8718');
UPDATE organization_profile.completion_policy SET lifecycle='PUBLISHED' WHERE completion_policy_id='01600000-0000-4000-8000-000000000001';
UPDATE organization_profile.projection_policy SET lifecycle='PUBLISHED' WHERE projection_policy_id='01600000-0000-4000-8000-000000000004';
UPDATE organization_profile.compatibility_manifest SET lifecycle='PUBLISHED',published_at=transaction_timestamp() WHERE manifest_id='01600000-0000-4000-8000-000000000002';
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['completion_policy','completion_slot','completion_rule','projection_policy','compatibility_manifest','release_bundle','reason_catalog_release','reason_catalog_entry','purpose_catalog_release','purpose_catalog_entry'] LOOP
  EXECUTE format('ALTER TABLE organization_profile.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY editorial_release_read ON organization_profile.%I FOR SELECT TO c4g_organization_profile_runtime USING(true)',tab);
  EXECUTE format('GRANT SELECT ON organization_profile.%I TO c4g_organization_profile_runtime',tab);
 END LOOP;
END $$;
RESET ROLE;
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  definition:=regexp_replace(definition,'^CHECK \((.*)\)$','CHECK (\1 OR event_code IN (''PROFILE_VERSION_APPROVED'',''PROFILE_VERSION_PUBLISHED'',''PROFILE_ACCESSED''))');
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I %s',tab,name,definition);
 END LOOP;
 SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid='audit.event'::regclass AND conname='event_catalog_version_check';
 definition:=regexp_replace(definition,'^CHECK \((.*)\)$','CHECK (\1 OR catalog_version=''f13-editorial-events-v1'')');
 ALTER TABLE audit.event DROP CONSTRAINT event_catalog_version_check;
 EXECUTE 'ALTER TABLE audit.event ADD CONSTRAINT event_catalog_version_check '||definition;
END $$;
