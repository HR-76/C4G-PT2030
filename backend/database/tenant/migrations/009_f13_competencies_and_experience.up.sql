GRANT USAGE ON SCHEMA document_storage TO c4g_organization_profile_owner;
GRANT REFERENCES(organization_id,document_id,version_id) ON document_storage.document_version TO c4g_organization_profile_owner;
SET ROLE c4g_organization_profile_owner;
CREATE TABLE organization_profile.competency_catalog_release (
 release_id uuid PRIMARY KEY,organization_id uuid,release_version text NOT NULL CHECK(release_version ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
 lifecycle text NOT NULL CHECK(lifecycle='PUBLISHED'),semantic_digest char(64) NOT NULL CHECK(semantic_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),UNIQUE(organization_id,release_id)
);
CREATE TABLE organization_profile.competency_catalog_entry (
 entry_id uuid PRIMARY KEY,release_id uuid NOT NULL REFERENCES organization_profile.competency_catalog_release(release_id),organization_id uuid,
 kind text NOT NULL CHECK(kind IN('COMPETENCY_CONCEPT','FRAMEWORK_LEVEL','EXPERIENCE_TYPE','VERIFICATION_METHOD')),
 stable_code text NOT NULL CHECK(stable_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),framework_id uuid,framework_version text,
 max_validity_seconds bigint CHECK(max_validity_seconds BETWEEN 1 AND 315360000),
 CHECK((framework_id IS NULL)=(framework_version IS NULL)),
 CHECK(kind<>'FRAMEWORK_LEVEL' OR framework_id IS NOT NULL),
 CHECK(kind='VERIFICATION_METHOD' OR max_validity_seconds IS NULL),UNIQUE(release_id,kind,stable_code)
);
CREATE TABLE organization_profile.competency_assertion_version (
 version_id uuid PRIMARY KEY,assertion_id uuid NOT NULL,organization_id uuid NOT NULL,profile_scope_id uuid NOT NULL,
 knowledge_status text NOT NULL CHECK(knowledge_status IN('KNOWN','UNKNOWN')),concept_id uuid REFERENCES organization_profile.competency_catalog_entry(entry_id),
 level_id uuid REFERENCES organization_profile.competency_catalog_entry(entry_id),
 verification_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK(verification_status='UNVERIFIED'),
 actor_subject_id uuid NOT NULL,membership_id uuid NOT NULL,correlation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CHECK((knowledge_status='KNOWN' AND concept_id IS NOT NULL) OR (knowledge_status='UNKNOWN' AND concept_id IS NULL AND level_id IS NULL)),
 UNIQUE(organization_id,profile_scope_id,version_id),
 FOREIGN KEY(organization_id,profile_scope_id) REFERENCES organization_profile.profile_scope(organization_id,profile_scope_id)
);
CREATE TABLE organization_profile.experience_evidence_version (
 version_id uuid PRIMARY KEY,experience_id uuid NOT NULL,organization_id uuid NOT NULL,profile_scope_id uuid NOT NULL,
 type_id uuid NOT NULL REFERENCES organization_profile.competency_catalog_entry(entry_id),
 observed_from timestamptz NOT NULL,observed_until timestamptz NOT NULL CHECK(observed_until>=observed_from),provenance_ref uuid NOT NULL,
 verification_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK(verification_status='UNVERIFIED'),
 actor_subject_id uuid NOT NULL,membership_id uuid NOT NULL,correlation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),UNIQUE(organization_id,profile_scope_id,version_id),
 FOREIGN KEY(organization_id,profile_scope_id) REFERENCES organization_profile.profile_scope(organization_id,profile_scope_id)
);
CREATE TABLE organization_profile.competency_evidence_link (
 version_id uuid PRIMARY KEY,link_id uuid NOT NULL,organization_id uuid NOT NULL,profile_scope_id uuid NOT NULL,
 assertion_version_id uuid NOT NULL,experience_version_id uuid NOT NULL,document_id uuid,document_version_id uuid,
 actor_subject_id uuid NOT NULL,membership_id uuid NOT NULL,correlation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),UNIQUE(organization_id,profile_scope_id,version_id),
 CHECK((document_id IS NULL)=(document_version_id IS NULL)),
 FOREIGN KEY(organization_id,profile_scope_id,assertion_version_id) REFERENCES organization_profile.competency_assertion_version(organization_id,profile_scope_id,version_id),
 FOREIGN KEY(organization_id,profile_scope_id,experience_version_id) REFERENCES organization_profile.experience_evidence_version(organization_id,profile_scope_id,version_id),
 FOREIGN KEY(organization_id,document_id,document_version_id) REFERENCES document_storage.document_version(organization_id,document_id,version_id)
);
CREATE TABLE organization_profile.competency_verification_result (
 verification_id uuid PRIMARY KEY,organization_id uuid NOT NULL,profile_scope_id uuid NOT NULL,assertion_version_id uuid NOT NULL,
 method_id uuid NOT NULL REFERENCES organization_profile.competency_catalog_entry(entry_id),
 verified_at timestamptz NOT NULL DEFAULT transaction_timestamp(),valid_until timestamptz,
 status text NOT NULL CHECK(status='VERIFIED'),material_digest char(64) NOT NULL CHECK(material_digest ~ '^[a-f0-9]{64}$'),
 actor_subject_id uuid NOT NULL,membership_id uuid NOT NULL,correlation_id uuid NOT NULL,authorization_evidence jsonb NOT NULL,
 CHECK(valid_until IS NULL OR valid_until>verified_at),UNIQUE(organization_id,profile_scope_id,verification_id),
 FOREIGN KEY(organization_id,profile_scope_id,assertion_version_id) REFERENCES organization_profile.competency_assertion_version(organization_id,profile_scope_id,version_id)
);
CREATE TABLE organization_profile.competency_revision_member (
 organization_id uuid NOT NULL,draft_id uuid NOT NULL,profile_scope_id uuid NOT NULL,revision bigint NOT NULL,
 kind text NOT NULL CHECK(kind IN('ASSERTION','EXPERIENCE','LINK','VERIFICATION')),version_id uuid NOT NULL,
 PRIMARY KEY(organization_id,draft_id,revision,kind,version_id),
 FOREIGN KEY(organization_id,draft_id,profile_scope_id,revision) REFERENCES organization_profile.profile_draft_revision(organization_id,draft_id,profile_scope_id,revision)
);
CREATE TABLE organization_profile.competency_idempotency_record (
 organization_id uuid NOT NULL,operation text NOT NULL CHECK(operation IN('COMPETENCY_SET','EXPERIENCE_SET','EVIDENCE_ATTACH','COMPETENCY_VERIFY','EVIDENCE_LINK_READ')),
 idempotency_key uuid NOT NULL,intention_digest char(64) NOT NULL CHECK(intention_digest ~ '^[a-f0-9]{64}$'),
 draft_id uuid NOT NULL,revision bigint NOT NULL,result_projection jsonb NOT NULL,
 PRIMARY KEY(organization_id,operation,idempotency_key),
 FOREIGN KEY(organization_id,draft_id,revision) REFERENCES organization_profile.profile_draft_revision(organization_id,draft_id,revision)
);
CREATE FUNCTION organization_profile.guard_competency_material() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,organization_profile AS $$
DECLARE tab text; valid boolean; concept record; level record; reference_id uuid; reference_kind text;
BEGIN
 IF TG_TABLE_NAME='competency_revision_member' THEN
  IF EXISTS(SELECT 1 FROM organization_profile.competency_idempotency_record WHERE organization_id=NEW.organization_id AND draft_id=NEW.draft_id AND revision=NEW.revision AND operation<>'EVIDENCE_LINK_READ')
   OR EXISTS(SELECT 1 FROM organization_profile.idempotency_record WHERE organization_id=NEW.organization_id AND draft_id=NEW.draft_id AND revision=NEW.revision)
  THEN RAISE EXCEPTION 'F13_AUTHORING_APPEND_ONLY'; END IF;
  tab:=CASE NEW.kind WHEN 'ASSERTION' THEN 'competency_assertion_version' WHEN 'EXPERIENCE' THEN 'experience_evidence_version'
   WHEN 'LINK' THEN 'competency_evidence_link' WHEN 'VERIFICATION' THEN 'competency_verification_result' END;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM organization_profile.%I WHERE organization_id=$1 AND profile_scope_id=$2 AND %I=$3)',tab,
   CASE WHEN NEW.kind='VERIFICATION' THEN 'verification_id' ELSE 'version_id' END) INTO valid USING NEW.organization_id,NEW.profile_scope_id,NEW.version_id;
  IF NOT valid THEN RAISE EXCEPTION 'F13_COMPETENCY_INVALID_REFERENCE'; END IF;
 ELSIF TG_TABLE_NAME IN('competency_assertion_version','experience_evidence_version','competency_verification_result') THEN
  IF TG_TABLE_NAME='competency_assertion_version' THEN
   IF NEW.knowledge_status='UNKNOWN' THEN RETURN NEW; END IF;
   reference_id:=NEW.concept_id; reference_kind:='COMPETENCY_CONCEPT';
  ELSIF TG_TABLE_NAME='experience_evidence_version' THEN
   reference_id:=NEW.type_id; reference_kind:='EXPERIENCE_TYPE';
  ELSE
   reference_id:=NEW.method_id; reference_kind:='VERIFICATION_METHOD';
  END IF;
  SELECT e.* INTO concept FROM organization_profile.competency_catalog_entry e
   JOIN organization_profile.competency_catalog_release r ON r.release_id=e.release_id AND r.organization_id IS NOT DISTINCT FROM e.organization_id
   WHERE e.entry_id=reference_id AND e.kind=reference_kind AND r.lifecycle='PUBLISHED'
    AND (e.organization_id IS NULL OR e.organization_id=NEW.organization_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'F13_COMPETENCY_INVALID_REFERENCE'; END IF;
  IF TG_TABLE_NAME='competency_assertion_version' THEN
   IF NEW.level_id IS NOT NULL THEN
    SELECT e.* INTO level FROM organization_profile.competency_catalog_entry e
     JOIN organization_profile.competency_catalog_release r ON r.release_id=e.release_id AND r.organization_id IS NOT DISTINCT FROM e.organization_id
     WHERE e.entry_id=NEW.level_id AND e.kind='FRAMEWORK_LEVEL' AND r.lifecycle='PUBLISHED'
      AND (e.organization_id IS NULL OR e.organization_id=NEW.organization_id);
    IF NOT FOUND OR concept.framework_id IS NULL OR level.framework_id IS DISTINCT FROM concept.framework_id
     OR level.framework_version IS DISTINCT FROM concept.framework_version OR level.release_id IS DISTINCT FROM concept.release_id
    THEN RAISE EXCEPTION 'F13_COMPETENCY_INVALID_REFERENCE'; END IF;
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='competency_catalog_entry' THEN
  IF NOT EXISTS(SELECT 1 FROM organization_profile.competency_catalog_release WHERE release_id=NEW.release_id AND organization_id IS NOT DISTINCT FROM NEW.organization_id)
  THEN RAISE EXCEPTION 'F13_COMPETENCY_INVALID_REFERENCE'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER competency_member_guard BEFORE INSERT ON organization_profile.competency_revision_member
 FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_competency_material();
CREATE TRIGGER competency_catalog_entry_guard BEFORE INSERT ON organization_profile.competency_catalog_entry
 FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_competency_material();
CREATE TRIGGER competency_assertion_reference_guard BEFORE INSERT ON organization_profile.competency_assertion_version
 FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_competency_material();
CREATE TRIGGER competency_experience_reference_guard BEFORE INSERT ON organization_profile.experience_evidence_version
 FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_competency_material();
CREATE TRIGGER competency_verification_reference_guard BEFORE INSERT ON organization_profile.competency_verification_result
 FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_competency_material();
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['competency_catalog_release','competency_catalog_entry','competency_assertion_version','experience_evidence_version',
  'competency_evidence_link','competency_verification_result','competency_revision_member','competency_idempotency_record'] LOOP
  EXECUTE format('ALTER TABLE organization_profile.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE organization_profile.%I FORCE ROW LEVEL SECURITY',tab);
  IF tab IN('competency_catalog_release','competency_catalog_entry') THEN
   EXECUTE format('CREATE POLICY competency_read ON organization_profile.%I FOR SELECT USING(organization_id IS NULL OR organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
  ELSE
   EXECUTE format('CREATE POLICY competency_isolation ON organization_profile.%I USING(organization_id=current_setting(''app.organization_id'',true)::uuid) WITH CHECK(organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
  END IF;
  EXECUTE format('CREATE TRIGGER competency_immutable BEFORE UPDATE OR DELETE ON organization_profile.%I FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  EXECUTE format('CREATE TRIGGER competency_no_truncate BEFORE TRUNCATE ON organization_profile.%I FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
 END LOOP;
END $$;
RESET ROLE;
REVOKE ALL ON FUNCTION organization_profile.guard_competency_material() FROM PUBLIC;
GRANT SELECT ON organization_profile.competency_catalog_release,organization_profile.competency_catalog_entry TO c4g_organization_profile_runtime;
GRANT SELECT,INSERT ON organization_profile.competency_assertion_version,organization_profile.experience_evidence_version,
 organization_profile.competency_evidence_link,organization_profile.competency_verification_result,organization_profile.competency_revision_member,
 organization_profile.competency_idempotency_record TO c4g_organization_profile_runtime;
GRANT USAGE ON SCHEMA document_storage TO c4g_organization_profile_runtime;
SET ROLE c4g_document_owner;
CREATE FUNCTION document_storage.load_competency_reference(expected_organization uuid,expected_version uuid)
 RETURNS TABLE(document_id uuid,version_id uuid,resource_id uuid,resource_type text,state text,scan_state text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF expected_organization IS DISTINCT FROM current_setting('app.organization_id',true)::uuid THEN
  RAISE EXCEPTION 'F13_COMPETENCY_INVALID_REFERENCE';
 END IF;
 RETURN QUERY SELECT d.document_id,v.version_id,d.resource_id,d.resource_type,v.state::text,v.scan_state::text
  FROM document_storage.document d JOIN document_storage.document_version v ON v.document_id=d.document_id AND v.organization_id=d.organization_id
  WHERE v.organization_id=expected_organization AND v.version_id=expected_version FOR SHARE OF d,v;
END $$;
RESET ROLE;
REVOKE ALL ON FUNCTION document_storage.load_competency_reference(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION document_storage.load_competency_reference(uuid,uuid) TO c4g_organization_profile_runtime;
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK ((%s) OR event_code IN (''EVIDENCE_ATTACHED'',''COMPETENCY_ASSERTION_VERIFIED'',''EVIDENCE_LINK_ACCESSED''))',tab,name,substring(definition from 8 for length(definition)-8));
 END LOOP;
 SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid='audit.event'::regclass AND conname='event_catalog_version_check';
 ALTER TABLE audit.event DROP CONSTRAINT event_catalog_version_check;
 EXECUTE 'ALTER TABLE audit.event ADD CONSTRAINT event_catalog_version_check CHECK (('||substring(definition from 8 for length(definition)-8)||') OR catalog_version=''f13-competency-events-v1'')';
END $$;
