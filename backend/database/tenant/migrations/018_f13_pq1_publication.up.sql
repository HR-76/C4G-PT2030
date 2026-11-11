-- F13 editorial-only release. No activation or effective snapshot.
SET ROLE c4g_organization_profile_owner;
ALTER TABLE organization_profile.scheme DROP CONSTRAINT scheme_scheme_code_check, DROP CONSTRAINT scheme_check;
ALTER TABLE organization_profile.scheme ADD CONSTRAINT scheme_scheme_code_check CHECK ((scheme_code IN ('THEMATIC_AREA','STRATEGIC_PRIORITY','COUNTRY_TERRITORY','ADMINISTRATIVE_AREA','STATISTICAL_REGION','TRANSNATIONAL_AREA','LEGAL_NATURE','INSTITUTION_TYPE','CONTROL_STATUS','NON_PROFIT_STATUS','ECONOMIC_SIZE_CLASS','SERVED_POPULATION_GROUP')) OR scheme_code='COMPETENCY'), ADD CONSTRAINT scheme_check CHECK (((scheme_code IN ('THEMATIC_AREA','STRATEGIC_PRIORITY') AND relation_domain='THEMATIC')
   OR (scheme_code IN ('COUNTRY_TERRITORY','ADMINISTRATIVE_AREA','STATISTICAL_REGION','TRANSNATIONAL_AREA') AND relation_domain='TERRITORY')
   OR (scheme_code IN ('LEGAL_NATURE','INSTITUTION_TYPE','CONTROL_STATUS','NON_PROFIT_STATUS','ECONOMIC_SIZE_CLASS','SERVED_POPULATION_GROUP') AND relation_domain='NONE')) OR (scheme_code='COMPETENCY' AND relation_domain='NONE'));

CREATE TABLE organization_profile.pq1_candidate (
 candidate_id uuid PRIMARY KEY, organization_id uuid NOT NULL, profile_scope_id uuid NOT NULL,
 draft_id uuid NOT NULL, source_revision bigint NOT NULL,
 source_digest char(64) NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 pq1_digest char(64) NOT NULL CHECK(pq1_digest ~ '^[a-f0-9]{64}$'),
 candidate_digest char(64) NOT NULL CHECK(candidate_digest ~ '^[a-f0-9]{64}$'),
 completion_digest char(64) NOT NULL CHECK(completion_digest ~ '^[a-f0-9]{64}$'),
 extractor_version text NOT NULL CHECK(extractor_version='F13_PQ1_MULTIDOMAIN_V1'),
 identity_record jsonb NOT NULL CHECK(jsonb_typeof(identity_record)='object'),
 pq1_content jsonb NOT NULL CHECK(jsonb_typeof(pq1_content)='object'),
 completion_record jsonb NOT NULL CHECK((completion_record->>'result' IN ('COMPLETE','INCOMPLETE')) IS TRUE),
 submitter_subject_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,candidate_id), UNIQUE(organization_id,draft_id,source_revision,extractor_version),
 FOREIGN KEY(organization_id,draft_id,profile_scope_id,source_revision)
 REFERENCES organization_profile.profile_draft_revision(organization_id,draft_id,profile_scope_id,revision),
 CHECK((pq1_content->>'kind'='F13_PQ1_PUBLICATION_V1'
   AND pq1_content->'schema'='{"id":"F13_ORG_PQ1_PUBLICATION","version":"1.0.0"}'::jsonb
   AND pq1_content->>'extractorVersion'=extractor_version
   AND pq1_content->>'scopeType'='ORGANIZATION'
   AND jsonb_typeof(pq1_content->'items')='array'
   AND pq1_content->'coverage'='{"scopeType":"ORGANIZATION","includedDomains":["THEMATIC_AREA","STRATEGIC_PRIORITY","COMPETENCY","EXPERIENCE"],"constraintsAssessed":false,"effectiveSnapshot":false,"f14Consumable":false}'::jsonb) IS TRUE),
 CHECK((identity_record->>'organizationId'=organization_id::text
   AND identity_record->>'profileScopeId'=profile_scope_id::text
   AND identity_record->'source'->>'draftId'=draft_id::text
   AND identity_record->'source'->>'revision'=source_revision::text
   AND identity_record->'source'->>'digest'=source_digest::text
   AND identity_record->>'editorialDigest'=pq1_digest::text
   AND identity_record->>'completionDigest'=completion_digest::text
   AND identity_record->>'submitterSubjectId'=submitter_subject_id::text
   AND jsonb_typeof(identity_record->'authors')='array'
   AND jsonb_array_length(identity_record->'authors')>0) IS TRUE)
);
CREATE TABLE organization_profile.pq1_candidate_author (
 organization_id uuid NOT NULL,candidate_id uuid NOT NULL,subject_id uuid NOT NULL,
 reasons text[] NOT NULL CHECK(cardinality(reasons)>0 AND reasons <@ ARRAY['MATERIAL','SELECTION','SUBMITTER']::text[]),
 evidence_refs jsonb NOT NULL CHECK(jsonb_typeof(evidence_refs)='array'),
 PRIMARY KEY(organization_id,candidate_id,subject_id),
 FOREIGN KEY(organization_id,candidate_id) REFERENCES organization_profile.pq1_candidate(organization_id,candidate_id)
);
CREATE TABLE organization_profile.pq1_version (
 version_id uuid PRIMARY KEY,organization_id uuid NOT NULL,candidate_id uuid NOT NULL,
 version_digest char(64) NOT NULL CHECK(version_digest ~ '^[a-f0-9]{64}$'),
 approver_subject_id uuid NOT NULL,approver_membership_id uuid NOT NULL,
 approval_evidence jsonb NOT NULL CHECK((jsonb_typeof(approval_evidence)='object'
   AND approval_evidence->>'subjectId'=approver_subject_id::text
   AND approval_evidence->>'membershipId'=approver_membership_id::text) IS TRUE),
 approved_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,version_id),UNIQUE(organization_id,candidate_id),
 FOREIGN KEY(organization_id,candidate_id) REFERENCES organization_profile.pq1_candidate(organization_id,candidate_id)
);
CREATE TABLE organization_profile.pq1_publication (
 publication_id uuid PRIMARY KEY,organization_id uuid NOT NULL,version_id uuid NOT NULL,
 publisher_subject_id uuid NOT NULL,publication_evidence jsonb NOT NULL CHECK(jsonb_typeof(publication_evidence)='object'),
 published_at timestamptz NOT NULL DEFAULT transaction_timestamp(),UNIQUE(organization_id,version_id),
 FOREIGN KEY(organization_id,version_id) REFERENCES organization_profile.pq1_version(organization_id,version_id)
);
CREATE TABLE organization_profile.pq1_idempotency_record (
 organization_id uuid NOT NULL,operation text NOT NULL CHECK(operation IN ('PQ1_SUBMIT','PQ1_APPROVE','PQ1_PUBLISH')),
 idempotency_key uuid NOT NULL,intention_digest char(64) NOT NULL CHECK(intention_digest ~ '^[a-f0-9]{64}$'),
 result_projection jsonb NOT NULL CHECK(jsonb_typeof(result_projection)='object'),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),PRIMARY KEY(organization_id,operation,idempotency_key)
);
CREATE FUNCTION organization_profile.guard_pq1_effect() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,organization_profile AS $$
DECLARE candidate organization_profile.pq1_candidate; author_id uuid;
BEGIN
 IF TG_TABLE_NAME='pq1_candidate' THEN
  IF NOT EXISTS(SELECT 1 FROM organization_profile.profile_draft_revision r
   JOIN organization_profile.profile_scope s USING(organization_id,profile_scope_id)
   WHERE r.organization_id=NEW.organization_id AND r.draft_id=NEW.draft_id AND r.revision=NEW.source_revision
   AND r.lifecycle='SUBMITTED' AND r.semantic_digest=NEW.source_digest AND s.scope_type='ORGANIZATION')
  THEN RAISE EXCEPTION 'F13_EDITORIAL_SOURCE_INVALID'; END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='pq1_publication' THEN
  SELECT c.* INTO STRICT candidate FROM organization_profile.pq1_candidate c
   JOIN organization_profile.pq1_version v USING(organization_id,candidate_id)
   WHERE v.organization_id=NEW.organization_id AND v.version_id=NEW.version_id;
  author_id:=NEW.publisher_subject_id;
 ELSE
  SELECT * INTO STRICT candidate FROM organization_profile.pq1_candidate
   WHERE organization_id=NEW.organization_id AND candidate_id=NEW.candidate_id;
  IF TG_TABLE_NAME='pq1_candidate_author' THEN
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
 FOREACH tab IN ARRAY ARRAY['pq1_candidate','pq1_candidate_author','pq1_version','pq1_publication','pq1_idempotency_record'] LOOP
  EXECUTE format('ALTER TABLE organization_profile.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE organization_profile.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY pq1_isolation ON organization_profile.%I USING(organization_id=current_setting(''app.organization_id'',true)::uuid) WITH CHECK(organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
  EXECUTE format('CREATE TRIGGER pq1_append_only BEFORE UPDATE OR DELETE ON organization_profile.%I FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  EXECUTE format('CREATE TRIGGER pq1_no_truncate BEFORE TRUNCATE ON organization_profile.%I FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  IF tab<>'pq1_idempotency_record' THEN
   EXECUTE format('CREATE TRIGGER pq1_effect_guard BEFORE INSERT ON organization_profile.%I FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_pq1_effect()',tab);
  END IF;
  EXECUTE format('REVOKE ALL ON organization_profile.%I FROM PUBLIC,c4g_organization_profile_runtime',tab);
  EXECUTE format('GRANT SELECT,INSERT ON organization_profile.%I TO c4g_organization_profile_runtime',tab);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION organization_profile.guard_pq1_effect() FROM PUBLIC;

CREATE TABLE organization_profile.pq1_release (
 bundle_id uuid PRIMARY KEY, definition jsonb NOT NULL,
 definition_digest char(64) NOT NULL CHECK(definition_digest ~ '^[a-f0-9]{64}$')
);
CREATE TABLE organization_profile.pq1_method_descriptor (
 method_id uuid PRIMARY KEY REFERENCES organization_profile.competency_catalog_entry(entry_id),
 organization_id uuid, release_id uuid NOT NULL REFERENCES organization_profile.competency_catalog_release(release_id),
 descriptor_version text NOT NULL CHECK(descriptor_version='F13_PQ1_VERIFICATION_DESCRIPTOR_V1'),
 document_required boolean NOT NULL
);
CREATE TABLE organization_profile.pq1_provenance (
 provenance_id uuid PRIMARY KEY, organization_id uuid NOT NULL, profile_scope_id uuid NOT NULL,
 experience_version_id uuid NOT NULL, actor_subject_id uuid NOT NULL, membership_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 source_type text NOT NULL CHECK(source_type='ORGANIZATION_MANUAL'),
 UNIQUE(organization_id,experience_version_id),
 FOREIGN KEY(organization_id,profile_scope_id,experience_version_id)
 REFERENCES organization_profile.experience_evidence_version(organization_id,profile_scope_id,version_id)
 DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE organization_profile.pq1_verification_status_event (
 event_id uuid PRIMARY KEY, organization_id uuid NOT NULL, profile_scope_id uuid NOT NULL,
 verification_id uuid NOT NULL, sequence bigint NOT NULL CHECK(sequence=1),
 status text NOT NULL CHECK(status='REVOKED'), reason_code text NOT NULL CHECK(reason_code IN('EVIDENCE_WITHDRAWN','VERIFICATION_ERROR')),
 actor_subject_id uuid NOT NULL, membership_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,verification_id),
 FOREIGN KEY(organization_id,profile_scope_id,verification_id)
 REFERENCES organization_profile.competency_verification_result(organization_id,profile_scope_id,verification_id)
);
CREATE TABLE organization_profile.pq1_ui_receipt (
 organization_id uuid NOT NULL, operation text NOT NULL CHECK(operation IN
 ('CREATE_DRAFT','EDIT_ITEMS','SET_COMPETENCIES','SET_EXPERIENCES','ATTACH_EVIDENCE','VERIFY','REVOKE_VERIFICATION','SUBMIT','APPROVE','PUBLISH')),
 idempotency_key uuid NOT NULL, subject_id uuid NOT NULL, resource_id uuid NOT NULL,
 intention_digest char(64) NOT NULL CHECK(intention_digest ~ '^[a-f0-9]{64}$'),
 result_projection jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,operation,idempotency_key)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['pq1_provenance','pq1_verification_status_event','pq1_ui_receipt'] LOOP
  EXECUTE format('ALTER TABLE organization_profile.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE organization_profile.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY pq1_isolation ON organization_profile.%I USING(organization_id=current_setting(''app.organization_id'',true)::uuid) WITH CHECK(organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
  EXECUTE format('GRANT SELECT,INSERT ON organization_profile.%I TO c4g_organization_profile_runtime',tab);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['pq1_release','pq1_method_descriptor','pq1_provenance','pq1_verification_status_event','pq1_ui_receipt'] LOOP
  EXECUTE format('CREATE TRIGGER pq1_append_only BEFORE UPDATE OR DELETE ON organization_profile.%I FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  EXECUTE format('CREATE TRIGGER pq1_no_truncate BEFORE TRUNCATE ON organization_profile.%I FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  EXECUTE format('REVOKE ALL ON organization_profile.%I FROM PUBLIC',tab);
 END LOOP;
END $$;
ALTER TABLE organization_profile.pq1_method_descriptor ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_profile.pq1_release ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_profile.pq1_release FORCE ROW LEVEL SECURITY;
CREATE POLICY pq1_release_read ON organization_profile.pq1_release FOR SELECT USING(true);
ALTER TABLE organization_profile.pq1_method_descriptor FORCE ROW LEVEL SECURITY;
CREATE POLICY pq1_descriptor_read ON organization_profile.pq1_method_descriptor FOR SELECT
 USING(organization_id IS NULL OR organization_id=current_setting('app.organization_id',true)::uuid);
GRANT SELECT ON organization_profile.pq1_release,organization_profile.pq1_method_descriptor TO c4g_organization_profile_runtime;


ALTER TABLE organization_profile.pq1_release NO FORCE ROW LEVEL SECURITY;
INSERT INTO organization_profile.pq1_release VALUES ('01800000-0000-4000-8000-000000000003','{"consumer":"F13_PQ1_PUBLICATION_READ_V1","coverage":{"constraintsAssessed":false,"effectiveSnapshot":false,"f14Consumable":false,"includedDomains":["THEMATIC_AREA","STRATEGIC_PRIORITY","COMPETENCY","EXPERIENCE"],"scopeType":"ORGANIZATION"},"extractor":"F13_PQ1_MULTIDOMAIN_V1","f14Consumable":false,"identity":"EXACT_CONCEPT_AND_RELEASE_IDS","policy":{"currentVerificationRequired":false,"historicalVerificationAllowed":["EXPIRED","REVOKED"],"maximumPerCollection":100,"slots":[{"domain":"THEMATIC_AREA","knowledge":["KNOWN"],"minimum":1},{"domain":"STRATEGIC_PRIORITY","knowledge":["KNOWN","UNKNOWN"],"minimum":1,"unknownExclusive":true},{"domain":"COMPETENCY","knowledge":["KNOWN","UNKNOWN"],"minimum":1,"unknownExclusive":true}],"version":"F13_PQ1_PUBLICATION_COMPLETION_V1"},"projection":"F13_PQ1_PUBLICATION_READ_V1","purpose":"PQ1_PUBLICATION","reasons":["EVIDENCE_WITHDRAWN","VERIFICATION_ERROR"],"schema":{"id":"F13_ORG_PQ1_PUBLICATION","version":"1.0.0"},"verificationDescriptor":"F13_PQ1_VERIFICATION_DESCRIPTOR_V1","wireSchema":"F13_PQ1_PUBLICATION_V1"}'::jsonb,'505572648e422e238347fbcfe44b5d9e577479d9cbb554cfec063e380935dd5d');
ALTER TABLE organization_profile.pq1_release FORCE ROW LEVEL SECURITY;
RESET ROLE;

SET ROLE c4g_document_owner;
CREATE FUNCTION document_storage.list_pq1_experience_references(expected_organization uuid,expected_experience uuid,after_version uuid)
RETURNS TABLE(document_id uuid,version_id uuid,resource_id uuid,resource_type text,state text,scan_state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF expected_organization IS DISTINCT FROM current_setting('app.organization_id',true)::uuid THEN RAISE EXCEPTION 'PQ1_REFERENCE_DENIED'; END IF;
 RETURN QUERY SELECT d.document_id,v.version_id,d.resource_id,d.resource_type,v.state::text,v.scan_state::text
 FROM document_storage.document d JOIN document_storage.document_version v ON v.document_id=d.document_id AND v.organization_id=d.organization_id
 WHERE v.organization_id=expected_organization AND d.resource_type='EXPERIENCE_EVIDENCE' AND d.resource_id=expected_experience
 AND v.state='AVAILABLE' AND v.scan_state='CLEAN' AND (after_version IS NULL OR v.version_id>after_version)
 ORDER BY v.version_id LIMIT 100 FOR SHARE OF d,v;
END $$;
RESET ROLE;
REVOKE ALL ON FUNCTION document_storage.list_pq1_experience_references(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION document_storage.list_pq1_experience_references(uuid,uuid,uuid) TO c4g_organization_profile_runtime;
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK ((%s) OR event_code = ''ASSERTION_REVOKED'')',tab,name,substring(definition from 8 for length(definition)-8));
 END LOOP;
END $$;
