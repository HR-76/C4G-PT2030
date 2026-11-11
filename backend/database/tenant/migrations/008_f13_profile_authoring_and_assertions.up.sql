SET ROLE c4g_organization_profile_owner;
ALTER TABLE organization_profile.profile_scope ADD CONSTRAINT profile_scope_tenant_identity UNIQUE(organization_id,profile_scope_id);
CREATE TABLE organization_profile.profile_draft (
 draft_id uuid PRIMARY KEY, organization_id uuid NOT NULL, profile_scope_id uuid NOT NULL,
 head_revision bigint NOT NULL CHECK(head_revision BETWEEN 1 AND 9007199254740991), lifecycle text NOT NULL CHECK(lifecycle IN('DRAFT','SUBMITTED')),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,draft_id,profile_scope_id),
 FOREIGN KEY(organization_id,profile_scope_id) REFERENCES organization_profile.profile_scope(organization_id,profile_scope_id)
);
CREATE TABLE organization_profile.profile_draft_revision (
 organization_id uuid NOT NULL, draft_id uuid NOT NULL, profile_scope_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991), lifecycle text NOT NULL CHECK(lifecycle IN('DRAFT','SUBMITTED')),
 semantic_digest char(64) NOT NULL CHECK(semantic_digest ~ '^[a-f0-9]{64}$'),
 actor_subject_id uuid NOT NULL,membership_id uuid NOT NULL,correlation_id uuid NOT NULL,
 authorization_evidence jsonb NOT NULL CHECK(jsonb_typeof(authorization_evidence)='object'),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,draft_id,revision), UNIQUE(organization_id,draft_id,profile_scope_id,revision),
 FOREIGN KEY(organization_id,draft_id,profile_scope_id) REFERENCES organization_profile.profile_draft(organization_id,draft_id,profile_scope_id)
);
ALTER TABLE organization_profile.profile_draft ADD CONSTRAINT profile_draft_head_fk
 FOREIGN KEY(organization_id,draft_id,head_revision) REFERENCES organization_profile.profile_draft_revision(organization_id,draft_id,revision)
 DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE organization_profile.profile_item_version (
 item_version_id uuid PRIMARY KEY,item_id uuid NOT NULL,organization_id uuid NOT NULL,profile_scope_id uuid NOT NULL,
 domain text NOT NULL CHECK(domain IN('THEMATIC_AREA','STRATEGIC_PRIORITY')),
 knowledge_status text NOT NULL CHECK(knowledge_status IN('KNOWN','UNKNOWN')),
 verification_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK(verification_status='UNVERIFIED'),
 conflict_status text NOT NULL DEFAULT 'CLEAR' CHECK(conflict_status='CLEAR'),
 lifecycle text NOT NULL DEFAULT 'DRAFT' CHECK(lifecycle='DRAFT'),
 confidentiality_class text NOT NULL DEFAULT 'INTERNAL' CHECK(confidentiality_class='INTERNAL'),
 concept_id uuid REFERENCES organization_profile.concept(concept_id),
 actor_subject_id uuid NOT NULL,membership_id uuid NOT NULL,correlation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CHECK((knowledge_status='KNOWN' AND concept_id IS NOT NULL) OR (knowledge_status='UNKNOWN' AND concept_id IS NULL)),
 UNIQUE(organization_id,profile_scope_id,item_version_id,item_id),
 FOREIGN KEY(organization_id,profile_scope_id) REFERENCES organization_profile.profile_scope(organization_id,profile_scope_id)
);
CREATE TABLE organization_profile.profile_revision_item (
 organization_id uuid NOT NULL,draft_id uuid NOT NULL,profile_scope_id uuid NOT NULL,revision bigint NOT NULL,
 item_id uuid NOT NULL,item_version_id uuid NOT NULL,
 PRIMARY KEY(organization_id,draft_id,revision,item_id),
 FOREIGN KEY(organization_id,draft_id,profile_scope_id,revision) REFERENCES organization_profile.profile_draft_revision(organization_id,draft_id,profile_scope_id,revision),
 FOREIGN KEY(organization_id,profile_scope_id,item_version_id,item_id) REFERENCES organization_profile.profile_item_version(organization_id,profile_scope_id,item_version_id,item_id)
);
CREATE TABLE organization_profile.idempotency_record (
 organization_id uuid NOT NULL,operation text NOT NULL CHECK(operation IN('PROFILE_DRAFT_CREATE','PROFILE_DRAFT_EDIT','PROFILE_SUBMIT')),
 idempotency_key uuid NOT NULL,intention_digest char(64) NOT NULL CHECK(intention_digest ~ '^[a-f0-9]{64}$'),
 draft_id uuid NOT NULL,revision bigint NOT NULL,result_projection jsonb NOT NULL CHECK(jsonb_typeof(result_projection)='object'),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,operation,idempotency_key),
 FOREIGN KEY(organization_id,draft_id,revision) REFERENCES organization_profile.profile_draft_revision(organization_id,draft_id,revision)
);
CREATE FUNCTION organization_profile.guard_authoring_immutable() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'F13_AUTHORING_APPEND_ONLY'; END $$;
CREATE FUNCTION organization_profile.guard_authoring_draft() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,organization_profile AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'F13_AUTHORING_APPEND_ONLY'; END IF;
 IF NEW.organization_id<>OLD.organization_id OR NEW.draft_id<>OLD.draft_id OR NEW.profile_scope_id<>OLD.profile_scope_id
  OR NEW.created_at<>OLD.created_at OR OLD.lifecycle<>'DRAFT' OR NEW.head_revision<>OLD.head_revision+1
 THEN RAISE EXCEPTION 'F13_AUTHORING_INVALID_HEAD'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION organization_profile.guard_authoring_head() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,organization_profile AS $$
DECLARE head organization_profile.profile_draft;
BEGIN
 SELECT * INTO head FROM organization_profile.profile_draft WHERE draft_id=NEW.draft_id AND organization_id=NEW.organization_id;
 IF (SELECT count(*) FROM organization_profile.profile_draft_revision r WHERE r.organization_id=head.organization_id AND r.draft_id=head.draft_id)<>head.head_revision
  OR (SELECT max(revision) FROM organization_profile.profile_draft_revision r WHERE r.organization_id=head.organization_id AND r.draft_id=head.draft_id)<>head.head_revision
  OR NOT EXISTS(SELECT 1 FROM organization_profile.profile_draft_revision r WHERE r.organization_id=head.organization_id
  AND r.draft_id=head.draft_id AND r.revision=head.head_revision AND r.lifecycle=head.lifecycle)
 THEN RAISE EXCEPTION 'F13_AUTHORING_INVALID_HEAD'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION organization_profile.guard_authoring_item() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,organization_profile AS $$
BEGIN
 IF NEW.concept_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_profile.concept c
  JOIN organization_profile.scheme s ON s.scheme_id=c.scheme_id AND s.release_id=c.release_id
  JOIN organization_profile.catalog_release r ON r.release_id=c.release_id
  WHERE c.concept_id=NEW.concept_id AND (c.organization_id IS NULL OR c.organization_id=NEW.organization_id)
   AND s.scheme_code=NEW.domain AND r.lifecycle='PUBLISHED')
 THEN RAISE EXCEPTION 'F13_AUTHORING_CONCEPT_INVALID'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION organization_profile.guard_authoring_material() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,organization_profile AS $$
BEGIN
 -- The source-local result seals a revision, including its immutable item set.
 IF EXISTS(SELECT 1 FROM organization_profile.idempotency_record i WHERE i.organization_id=NEW.organization_id
  AND i.draft_id=NEW.draft_id AND i.revision=NEW.revision)
 THEN RAISE EXCEPTION 'F13_AUTHORING_APPEND_ONLY'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER authoring_draft_guard BEFORE UPDATE OR DELETE ON organization_profile.profile_draft
 FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_draft();
CREATE CONSTRAINT TRIGGER authoring_head_guard AFTER INSERT OR UPDATE ON organization_profile.profile_draft
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_head();
CREATE CONSTRAINT TRIGGER authoring_revision_head_guard AFTER INSERT ON organization_profile.profile_draft_revision
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_head();
CREATE TRIGGER authoring_revision_material_guard BEFORE INSERT ON organization_profile.profile_revision_item
 FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_material();
CREATE TRIGGER authoring_item_guard BEFORE INSERT ON organization_profile.profile_item_version
 FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_item();
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['profile_draft','profile_draft_revision','profile_item_version','profile_revision_item','idempotency_record'] LOOP
  EXECUTE format('ALTER TABLE organization_profile.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE organization_profile.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY authoring_isolation ON organization_profile.%I USING(organization_id=current_setting(''app.organization_id'',true)::uuid) WITH CHECK(organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
  EXECUTE format('CREATE TRIGGER authoring_no_truncate BEFORE TRUNCATE ON organization_profile.%I FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  IF tab<>'profile_draft' THEN
   EXECUTE format('CREATE TRIGGER authoring_append_only BEFORE UPDATE OR DELETE ON organization_profile.%I FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  END IF;
 END LOOP;
END $$;
RESET ROLE;
REVOKE ALL ON organization_profile.profile_draft,organization_profile.profile_draft_revision,organization_profile.profile_item_version,
 organization_profile.profile_revision_item,organization_profile.idempotency_record FROM PUBLIC;
REVOKE ALL ON FUNCTION organization_profile.guard_authoring_immutable(),organization_profile.guard_authoring_draft(),
 organization_profile.guard_authoring_head(),organization_profile.guard_authoring_item(),organization_profile.guard_authoring_material() FROM PUBLIC;
GRANT SELECT,INSERT ON organization_profile.profile_scope,organization_profile.profile_draft,organization_profile.profile_draft_revision,
 organization_profile.profile_item_version,organization_profile.profile_revision_item,organization_profile.idempotency_record TO c4g_organization_profile_runtime;
GRANT UPDATE(head_revision,lifecycle) ON organization_profile.profile_draft TO c4g_organization_profile_runtime;
GRANT USAGE ON SCHEMA organizational_scope TO c4g_organization_profile_runtime;
GRANT SELECT(scope_id,organization_id,scope_type,lifecycle) ON organizational_scope.scope TO c4g_organization_profile_runtime;
-- Add only the three authoring events; preserve every existing F7 constraint.
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK ((%s) OR event_code IN (''PROFILE_DRAFT_CREATED'',''PROFILE_DRAFT_REVISION_CREATED'',''PROFILE_DRAFT_SUBMITTED''))',tab,name,substring(definition from 8 for length(definition)-8));
 END LOOP;
 SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid='audit.event'::regclass AND conname='event_catalog_version_check';
 ALTER TABLE audit.event DROP CONSTRAINT event_catalog_version_check;
 EXECUTE 'ALTER TABLE audit.event ADD CONSTRAINT event_catalog_version_check CHECK (('||substring(definition from 8 for length(definition)-8)||') OR catalog_version=''f13-authoring-events-v1'')';
END $$;
