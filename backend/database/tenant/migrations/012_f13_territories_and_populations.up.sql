SET ROLE c4g_organization_profile_owner;
CREATE TABLE organization_profile.population_catalog_release (
 release_id uuid PRIMARY KEY,organization_id uuid,release_version text NOT NULL CHECK(release_version ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
 lifecycle text NOT NULL CHECK(lifecycle='PUBLISHED'),created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE TABLE organization_profile.population_catalog_entry (
 entry_id uuid PRIMARY KEY,release_id uuid NOT NULL REFERENCES organization_profile.population_catalog_release(release_id),organization_id uuid,
 kind text NOT NULL CHECK(kind IN('UNIT','METHOD','REASON','PURPOSE','GEOGRAPHIC_LEVEL','COUNTING_BASIS')),stable_code text NOT NULL CHECK(stable_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 unit_code text,metric_id uuid REFERENCES organization_profile.metric_definition(metric_id),unit_id uuid REFERENCES organization_profile.population_catalog_entry(entry_id),operations text[] NOT NULL,
 CHECK(cardinality(operations)>0 AND operations <@ ARRAY['CREATE','EDIT','READ','SUBMIT','VERIFY','REJECT','DISPUTE','REVOKE']::text[]),
 CHECK((kind='UNIT' AND unit_code IS NOT NULL AND unit_code ~ '^[A-Z][A-Z0-9_]{0,31}$')
  OR (kind<>'UNIT' AND unit_code IS NULL)),CHECK((kind='COUNTING_BASIS' AND metric_id IS NOT NULL AND unit_id IS NOT NULL) OR (kind<>'COUNTING_BASIS' AND metric_id IS NULL AND unit_id IS NULL)),UNIQUE(release_id,kind,stable_code)
);
CREATE TABLE organization_profile.population_assertion (
 assertion_id uuid PRIMARY KEY,organization_id uuid NOT NULL,profile_scope_id uuid NOT NULL,head_revision bigint NOT NULL CHECK(head_revision>0),
 UNIQUE(organization_id,assertion_id),UNIQUE(organization_id,assertion_id,profile_scope_id),
 FOREIGN KEY(organization_id,profile_scope_id) REFERENCES organization_profile.profile_scope(organization_id,profile_scope_id)
);
CREATE TABLE organization_profile.population_assertion_revision (
 organization_id uuid NOT NULL,assertion_id uuid NOT NULL,profile_scope_id uuid NOT NULL,revision bigint NOT NULL CHECK(revision>0),
 operation text NOT NULL CHECK(operation IN('CREATE','EDIT','SUBMIT','VERIFY','REJECT','DISPUTE','REVOKE')),
 state text NOT NULL CHECK(state IN('DRAFT','SUBMITTED','VERIFIED','REJECTED','DISPUTED','REVOKED')),
 knowledge_status text NOT NULL DEFAULT 'KNOWN' CHECK(knowledge_status='KNOWN'),
 assertion_kind text NOT NULL CHECK(assertion_kind IN('TERRITORY','TARGET_GROUP','SERVED_POPULATION')),
 count_value text CHECK(count_value ~ '^(0|[1-9][0-9]*)$'),count_numeric numeric GENERATED ALWAYS AS(count_value::numeric) STORED CHECK(count_numeric>=0 AND count_numeric=trunc(count_numeric)),
 unit_id uuid REFERENCES organization_profile.population_catalog_entry(entry_id),metric_id uuid REFERENCES organization_profile.metric_definition(metric_id),
 counting_basis_id uuid REFERENCES organization_profile.population_catalog_entry(entry_id),
 territory_refs jsonb NOT NULL CHECK(jsonb_typeof(territory_refs)='array' AND jsonb_array_length(territory_refs)<=64),
 group_refs jsonb NOT NULL CHECK(jsonb_typeof(group_refs)='array' AND jsonb_array_length(group_refs)<=64),organizational_scope_id uuid,
 CHECK((assertion_kind='SERVED_POPULATION' AND count_value IS NOT NULL AND unit_id IS NOT NULL AND metric_id IS NOT NULL AND counting_basis_id IS NOT NULL AND jsonb_array_length(territory_refs)>0 AND jsonb_array_length(group_refs)>0)
 OR (assertion_kind IN('TERRITORY','TARGET_GROUP') AND count_value IS NULL AND unit_id IS NULL AND metric_id IS NULL AND counting_basis_id IS NULL
 AND ((assertion_kind='TERRITORY' AND jsonb_array_length(territory_refs)>0 AND jsonb_array_length(group_refs)=0) OR (assertion_kind='TARGET_GROUP' AND jsonb_array_length(territory_refs)=0 AND jsonb_array_length(group_refs)>0)))),
 FOREIGN KEY(organization_id,organizational_scope_id) REFERENCES organizational_scope.scope(organization_id,scope_id),
 start_date date NOT NULL,end_date date NOT NULL CHECK(start_date<=end_date),provenance_ref uuid NOT NULL,
 document_version_ids uuid[] NOT NULL CHECK(cardinality(document_version_ids)<=16 AND array_position(document_version_ids,NULL) IS NULL),
 method_id uuid REFERENCES organization_profile.population_catalog_entry(entry_id),reason_id uuid REFERENCES organization_profile.population_catalog_entry(entry_id),
 valid_from timestamptz,valid_until timestamptz,CHECK(valid_until IS NULL OR (valid_from IS NOT NULL AND valid_from<valid_until)),
 CHECK(state NOT IN('VERIFIED','DISPUTED','REVOKED') OR (method_id IS NOT NULL AND valid_from IS NOT NULL)),
 actor_subject_id uuid NOT NULL,membership_id uuid NOT NULL,correlation_id uuid NOT NULL,authorization_evidence jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),PRIMARY KEY(organization_id,assertion_id,revision),
 FOREIGN KEY(organization_id,assertion_id,profile_scope_id) REFERENCES organization_profile.population_assertion(organization_id,assertion_id,profile_scope_id)
);
ALTER TABLE organization_profile.population_assertion ADD CONSTRAINT population_head_fk
 FOREIGN KEY(organization_id,assertion_id,head_revision) REFERENCES organization_profile.population_assertion_revision(organization_id,assertion_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE organization_profile.population_idempotency_record (
 organization_id uuid NOT NULL,operation text NOT NULL CHECK(operation IN('POPULATION_CREATE','POPULATION_EDIT','POPULATION_READ','POPULATION_SUBMIT','POPULATION_VERIFY','POPULATION_REJECT','POPULATION_DISPUTE','POPULATION_REVOKE')),
 idempotency_key uuid NOT NULL,intention_digest char(64) NOT NULL CHECK(intention_digest ~ '^[a-f0-9]{64}$'),assertion_id uuid NOT NULL,revision bigint NOT NULL,result_projection jsonb NOT NULL,
 PRIMARY KEY(organization_id,operation,idempotency_key),FOREIGN KEY(organization_id,assertion_id,revision) REFERENCES organization_profile.population_assertion_revision(organization_id,assertion_id,revision)
);

CREATE TABLE organization_profile.population_geographic_concept(
 geographic_id uuid PRIMARY KEY,organization_id uuid,release_id uuid NOT NULL REFERENCES organization_profile.population_catalog_release(release_id),
 concept_id uuid NOT NULL,scheme_id uuid NOT NULL,taxonomy_release_id uuid NOT NULL,level_id uuid NOT NULL REFERENCES organization_profile.population_catalog_entry(entry_id),
 FOREIGN KEY(concept_id,scheme_id,taxonomy_release_id) REFERENCES organization_profile.concept(concept_id,scheme_id,release_id),
 UNIQUE(release_id,concept_id)
);
CREATE TABLE organization_profile.population_revision_territory(
 organization_id uuid NOT NULL,assertion_id uuid NOT NULL,revision bigint NOT NULL,geographic_id uuid NOT NULL REFERENCES organization_profile.population_geographic_concept(geographic_id),
 coverage_kind text NOT NULL CHECK(coverage_kind IN('FULL','PARTIAL','UNSPECIFIED')),
 PRIMARY KEY(organization_id,assertion_id,revision,geographic_id),
 FOREIGN KEY(organization_id,assertion_id,revision) REFERENCES organization_profile.population_assertion_revision(organization_id,assertion_id,revision)
);
CREATE TABLE organization_profile.population_revision_group(
 organization_id uuid NOT NULL,assertion_id uuid NOT NULL,revision bigint NOT NULL,concept_id uuid NOT NULL,scheme_id uuid NOT NULL,release_id uuid NOT NULL,
 PRIMARY KEY(organization_id,assertion_id,revision,concept_id),
 FOREIGN KEY(organization_id,assertion_id,revision) REFERENCES organization_profile.population_assertion_revision(organization_id,assertion_id,revision),
 FOREIGN KEY(concept_id,scheme_id,release_id) REFERENCES organization_profile.concept(concept_id,scheme_id,release_id)
);

CREATE FUNCTION organization_profile.population_entry_valid(id uuid,org uuid,expected_kind text,op text) RETURNS boolean
 LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM organization_profile.population_catalog_entry e JOIN organization_profile.population_catalog_release r
  ON r.release_id=e.release_id AND r.organization_id IS NOT DISTINCT FROM e.organization_id
  WHERE e.entry_id=id AND e.kind=expected_kind AND (e.organization_id IS NULL OR e.organization_id=org) AND r.lifecycle='PUBLISHED' AND op=ANY(e.operations))
$$;
CREATE FUNCTION organization_profile.guard_population_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE previous organization_profile.population_assertion_revision; head bigint; scope_type text; unit text; ref jsonb;
BEGIN
 IF TG_TABLE_NAME='population_geographic_concept' THEN
  IF NOT EXISTS(SELECT 1 FROM organization_profile.population_catalog_release r JOIN organization_profile.population_catalog_entry e ON e.release_id=r.release_id
   JOIN organization_profile.concept c ON c.concept_id=NEW.concept_id AND c.scheme_id=NEW.scheme_id AND c.release_id=NEW.taxonomy_release_id
   JOIN organization_profile.catalog_release t ON t.release_id=c.release_id JOIN organization_profile.scheme s ON s.scheme_id=c.scheme_id
   WHERE r.release_id=NEW.release_id AND r.organization_id IS NOT DISTINCT FROM NEW.organization_id AND e.entry_id=NEW.level_id AND e.kind='GEOGRAPHIC_LEVEL'
    AND e.organization_id IS NOT DISTINCT FROM NEW.organization_id AND t.lifecycle='PUBLISHED' AND c.deprecated_at IS NULL AND s.relation_domain='TERRITORY'
    AND (t.organization_id IS NULL OR t.organization_id=NEW.organization_id))
  THEN RAISE EXCEPTION 'F13_POPULATION_INVALID_REFERENCE'; END IF; RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='population_catalog_entry' THEN
  IF NOT EXISTS(SELECT 1 FROM organization_profile.population_catalog_release WHERE release_id=NEW.release_id AND organization_id IS NOT DISTINCT FROM NEW.organization_id)
  THEN RAISE EXCEPTION 'F13_POPULATION_INVALID_REFERENCE'; END IF;
  IF NEW.kind='COUNTING_BASIS' AND NOT EXISTS(SELECT 1 FROM organization_profile.population_catalog_entry u JOIN organization_profile.metric_definition m ON m.metric_id=NEW.metric_id
   JOIN organization_profile.metric_catalog_release r ON r.metric_release_id=m.metric_release_id
   WHERE u.entry_id=NEW.unit_id AND u.release_id=NEW.release_id AND u.kind='UNIT' AND u.organization_id IS NOT DISTINCT FROM NEW.organization_id
   AND m.value_kind='COUNT' AND m.unit_code=u.unit_code AND r.lifecycle='PUBLISHED' AND (r.organization_id IS NULL OR r.organization_id=NEW.organization_id))
  THEN RAISE EXCEPTION 'F13_POPULATION_INVALID_REFERENCE'; END IF; RETURN NEW;
 END IF;
 SELECT s.scope_type INTO scope_type FROM organization_profile.profile_scope s WHERE s.organization_id=NEW.organization_id AND s.profile_scope_id=NEW.profile_scope_id;
 IF scope_type IS DISTINCT FROM 'ORGANIZATION' THEN RAISE EXCEPTION 'F13_POPULATION_ORG_ONLY'; END IF;
 SELECT head_revision INTO head FROM organization_profile.population_assertion WHERE organization_id=NEW.organization_id AND assertion_id=NEW.assertion_id FOR UPDATE;
 SELECT * INTO previous FROM organization_profile.population_assertion_revision WHERE organization_id=NEW.organization_id AND assertion_id=NEW.assertion_id AND revision=head;
 IF NOT FOUND THEN
  IF NEW.revision<>1 OR NEW.operation<>'CREATE' OR NEW.state<>'DRAFT' THEN RAISE EXCEPTION 'F13_POPULATION_STATE_CONFLICT'; END IF;
 ELSE
  IF NEW.assertion_kind<>previous.assertion_kind THEN RAISE EXCEPTION 'F13_POPULATION_STATE_CONFLICT'; END IF;
  IF NEW.revision<>head+1 OR NOT ((NEW.operation='EDIT' AND previous.state='DRAFT' AND NEW.state='DRAFT')
   OR (NEW.operation='SUBMIT' AND previous.state='DRAFT' AND NEW.state='SUBMITTED')
   OR (NEW.operation IN('VERIFY','REJECT') AND previous.state='SUBMITTED' AND NEW.state=CASE NEW.operation WHEN 'VERIFY' THEN 'VERIFIED' ELSE 'REJECTED' END)
   OR (NEW.operation='DISPUTE' AND previous.state='VERIFIED' AND NEW.state='DISPUTED')
   OR (NEW.operation='REVOKE' AND previous.state IN('VERIFIED','DISPUTED') AND NEW.state='REVOKED'))
  THEN RAISE EXCEPTION 'F13_POPULATION_STATE_CONFLICT'; END IF;
  IF NEW.operation IN('DISPUTE','REVOKE') AND previous.valid_until IS NOT NULL AND previous.valid_until<clock_timestamp()
  THEN RAISE EXCEPTION 'F13_POPULATION_STATE_CONFLICT'; END IF;
  IF NEW.operation<>'EDIT' AND ROW(NEW.assertion_kind,NEW.count_value,NEW.unit_id,NEW.metric_id,NEW.counting_basis_id,NEW.territory_refs,NEW.group_refs,NEW.organizational_scope_id,NEW.start_date,NEW.end_date,NEW.provenance_ref,NEW.document_version_ids)
   IS DISTINCT FROM ROW(previous.assertion_kind,previous.count_value,previous.unit_id,previous.metric_id,previous.counting_basis_id,previous.territory_refs,previous.group_refs,previous.organizational_scope_id,previous.start_date,previous.end_date,previous.provenance_ref,previous.document_version_ids)
  THEN RAISE EXCEPTION 'F13_POPULATION_STATE_CONFLICT'; END IF;
 END IF;
 IF NEW.assertion_kind='SERVED_POPULATION' THEN
  IF NOT organization_profile.population_entry_valid(NEW.unit_id,NEW.organization_id,'UNIT','CREATE') OR NOT organization_profile.population_entry_valid(NEW.counting_basis_id,NEW.organization_id,'COUNTING_BASIS','CREATE')
   OR NOT EXISTS(SELECT 1 FROM organization_profile.population_catalog_entry e WHERE e.entry_id=NEW.counting_basis_id AND e.metric_id=NEW.metric_id AND e.unit_id=NEW.unit_id)
  THEN RAISE EXCEPTION 'F13_POPULATION_INVALID_REFERENCE'; END IF;
 END IF;
 FOR ref IN SELECT * FROM jsonb_array_elements(NEW.territory_refs) LOOP
  IF jsonb_typeof(ref)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(ref))<>2 OR ref->>'coverageKind' IS NULL OR ref->>'coverageKind' NOT IN('FULL','PARTIAL','UNSPECIFIED')
   OR NOT EXISTS(SELECT 1 FROM organization_profile.population_geographic_concept g JOIN organization_profile.population_catalog_release r ON r.release_id=g.release_id
    JOIN organization_profile.catalog_release t ON t.release_id=g.taxonomy_release_id JOIN organization_profile.concept c ON c.concept_id=g.concept_id
    WHERE g.geographic_id=(ref->>'geographicId')::uuid AND r.lifecycle='PUBLISHED' AND t.lifecycle='PUBLISHED' AND c.deprecated_at IS NULL
     AND (g.organization_id IS NULL OR g.organization_id=NEW.organization_id) AND (t.organization_id IS NULL OR t.organization_id=NEW.organization_id))
  THEN RAISE EXCEPTION 'F13_POPULATION_INVALID_REFERENCE'; END IF;
 END LOOP;
 FOR ref IN SELECT * FROM jsonb_array_elements(NEW.group_refs) LOOP
  IF jsonb_typeof(ref)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(ref))<>3 OR NOT EXISTS(
   SELECT 1 FROM organization_profile.concept c JOIN organization_profile.scheme s ON s.scheme_id=c.scheme_id JOIN organization_profile.catalog_release r ON r.release_id=c.release_id
   WHERE c.concept_id=(ref->>'conceptId')::uuid AND c.scheme_id=(ref->>'schemeId')::uuid AND c.release_id=(ref->>'releaseId')::uuid
    AND s.scheme_code='SERVED_POPULATION_GROUP' AND r.lifecycle='PUBLISHED' AND c.deprecated_at IS NULL AND (r.organization_id IS NULL OR r.organization_id=NEW.organization_id))
  THEN RAISE EXCEPTION 'F13_POPULATION_INVALID_REFERENCE'; END IF;
 END LOOP;
 IF NEW.organizational_scope_id IS NOT NULL THEN
  PERFORM 1 FROM organizational_scope.load_population_location(NEW.organization_id,NEW.organizational_scope_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'F13_POPULATION_INVALID_REFERENCE'; END IF;
 END IF;
 IF NEW.operation='VERIFY' AND NOT organization_profile.population_entry_valid(NEW.method_id,NEW.organization_id,'METHOD','VERIFY') THEN RAISE EXCEPTION 'F13_POPULATION_INVALID_REFERENCE'; END IF;
 IF NEW.operation IN('REJECT','DISPUTE','REVOKE') AND (NEW.reason_id IS NULL OR NOT organization_profile.population_entry_valid(NEW.reason_id,NEW.organization_id,'REASON',NEW.operation))
 THEN RAISE EXCEPTION 'F13_POPULATION_INVALID_REFERENCE'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(NEW.document_version_ids) AS x(id) WHERE NOT EXISTS(SELECT 1 FROM document_storage.load_population_reference(NEW.organization_id,x.id,NEW.assertion_id)))
 THEN RAISE EXCEPTION 'F13_POPULATION_INVALID_REFERENCE'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION organization_profile.guard_population_head() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='UPDATE' AND (ROW(NEW.assertion_id,NEW.organization_id,NEW.profile_scope_id) IS DISTINCT FROM ROW(OLD.assertion_id,OLD.organization_id,OLD.profile_scope_id) OR NEW.head_revision<>OLD.head_revision+1)
 THEN RAISE EXCEPTION 'F13_POPULATION_STATE_CONFLICT'; END IF;
 IF (SELECT max(revision) FROM organization_profile.population_assertion_revision WHERE organization_id=NEW.organization_id AND assertion_id=NEW.assertion_id) IS DISTINCT FROM NEW.head_revision
 THEN RAISE EXCEPTION 'F13_POPULATION_INVALID_HEAD'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION organization_profile.materialize_population_links() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 INSERT INTO organization_profile.population_revision_territory SELECT NEW.organization_id,NEW.assertion_id,NEW.revision,(r->>'geographicId')::uuid,r->>'coverageKind' FROM jsonb_array_elements(NEW.territory_refs) r;
 INSERT INTO organization_profile.population_revision_group SELECT NEW.organization_id,NEW.assertion_id,NEW.revision,(r->>'conceptId')::uuid,(r->>'schemeId')::uuid,(r->>'releaseId')::uuid FROM jsonb_array_elements(NEW.group_refs) r;
 RETURN NEW; END $$;
CREATE FUNCTION organization_profile.guard_population_link() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_TABLE_NAME='population_revision_territory' THEN
  IF NOT EXISTS(SELECT 1 FROM organization_profile.population_assertion_revision r WHERE r.organization_id=NEW.organization_id AND r.assertion_id=NEW.assertion_id AND r.revision=NEW.revision
   AND r.territory_refs @> jsonb_build_array(jsonb_build_object('geographicId',NEW.geographic_id,'coverageKind',NEW.coverage_kind))) THEN RAISE EXCEPTION 'F13_POPULATION_INVALID_REFERENCE'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM organization_profile.population_assertion_revision r WHERE r.organization_id=NEW.organization_id AND r.assertion_id=NEW.assertion_id AND r.revision=NEW.revision
   AND r.group_refs @> jsonb_build_array(jsonb_build_object('conceptId',NEW.concept_id,'schemeId',NEW.scheme_id,'releaseId',NEW.release_id))) THEN RAISE EXCEPTION 'F13_POPULATION_INVALID_REFERENCE'; END IF;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER population_link_materialization AFTER INSERT ON organization_profile.population_assertion_revision FOR EACH ROW EXECUTE FUNCTION organization_profile.materialize_population_links();
CREATE TRIGGER population_territory_link_guard BEFORE INSERT ON organization_profile.population_revision_territory FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_population_link();
CREATE TRIGGER population_group_link_guard BEFORE INSERT ON organization_profile.population_revision_group FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_population_link();
CREATE TRIGGER population_geography_guard BEFORE INSERT ON organization_profile.population_geographic_concept FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_population_revision();
CREATE TRIGGER population_revision_guard BEFORE INSERT ON organization_profile.population_assertion_revision FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_population_revision();
-- Direct runtime SQL and functional authoring share the F13-P1 order before head/FK/location row locks.
CREATE TRIGGER population_revision_scope_lock BEFORE INSERT ON organization_profile.population_assertion_revision FOR EACH STATEMENT EXECUTE FUNCTION organizational_scope.lock_scope_tree_mutation();
CREATE TRIGGER population_assertion_scope_lock BEFORE INSERT OR UPDATE ON organization_profile.population_assertion FOR EACH STATEMENT EXECUTE FUNCTION organizational_scope.lock_scope_tree_mutation();
CREATE FUNCTION organization_profile.guard_population_revision_head() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF (SELECT head_revision FROM organization_profile.population_assertion WHERE organization_id=NEW.organization_id AND assertion_id=NEW.assertion_id)
  IS DISTINCT FROM (SELECT max(revision) FROM organization_profile.population_assertion_revision WHERE organization_id=NEW.organization_id AND assertion_id=NEW.assertion_id)
 THEN RAISE EXCEPTION 'F13_POPULATION_INVALID_HEAD'; END IF; RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER population_revision_head_guard AFTER INSERT ON organization_profile.population_assertion_revision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_population_revision_head();
CREATE TRIGGER population_catalog_guard BEFORE INSERT ON organization_profile.population_catalog_entry FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_population_revision();
CREATE CONSTRAINT TRIGGER population_head_guard AFTER INSERT OR UPDATE ON organization_profile.population_assertion DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_population_head();
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['population_catalog_release','population_catalog_entry','population_assertion','population_assertion_revision','population_idempotency_record','population_geographic_concept','population_revision_territory','population_revision_group'] LOOP
  EXECUTE format('ALTER TABLE organization_profile.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE organization_profile.%I FORCE ROW LEVEL SECURITY',tab);
  IF tab LIKE 'population_catalog_%' OR tab='population_geographic_concept' THEN
   EXECUTE format('CREATE POLICY population_read ON organization_profile.%I FOR SELECT USING(organization_id IS NULL OR organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
  ELSE
   EXECUTE format('CREATE POLICY population_isolation ON organization_profile.%I USING(organization_id=current_setting(''app.organization_id'',true)::uuid) WITH CHECK(organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
  END IF;
  IF tab<>'population_assertion' THEN EXECUTE format('CREATE TRIGGER population_immutable BEFORE UPDATE OR DELETE ON organization_profile.%I FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  ELSE EXECUTE format('CREATE TRIGGER population_no_delete BEFORE DELETE ON organization_profile.%I FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab); END IF;
  EXECUTE format('CREATE TRIGGER population_no_truncate BEFORE TRUNCATE ON organization_profile.%I FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
 END LOOP;
END $$;
RESET ROLE;
REVOKE ALL ON FUNCTION organization_profile.population_entry_valid(uuid,uuid,text,text),organization_profile.guard_population_revision(),organization_profile.guard_population_head(),organization_profile.guard_population_revision_head(),organization_profile.materialize_population_links(),organization_profile.guard_population_link() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION organization_profile.population_entry_valid(uuid,uuid,text,text) TO c4g_organization_profile_runtime;
GRANT SELECT ON organization_profile.population_catalog_release,organization_profile.population_catalog_entry,organization_profile.population_geographic_concept TO c4g_organization_profile_runtime;
GRANT SELECT ON organization_profile.metric_catalog_release,organization_profile.metric_definition TO c4g_organization_profile_runtime;
GRANT SELECT,INSERT ON organization_profile.population_assertion,organization_profile.population_assertion_revision,organization_profile.population_idempotency_record,organization_profile.population_revision_territory,organization_profile.population_revision_group TO c4g_organization_profile_runtime;
GRANT UPDATE(head_revision) ON organization_profile.population_assertion TO c4g_organization_profile_runtime;
SET ROLE c4g_organizational_scope_owner;
CREATE FUNCTION organizational_scope.load_population_location(expected_organization uuid,expected_scope uuid)
 RETURNS TABLE(scope_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF expected_organization IS DISTINCT FROM current_setting('app.organization_id',true)::uuid OR expected_scope IS NULL THEN RAISE EXCEPTION 'F13_POPULATION_INVALID_REFERENCE'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('F13-P1:' || expected_organization::text,43001301));
 RETURN QUERY SELECT s.scope_id FROM organizational_scope.scope s
  WHERE s.organization_id=expected_organization AND s.scope_id=expected_scope AND s.lifecycle='ACTIVE' FOR SHARE;
END $$;
RESET ROLE;
REVOKE ALL ON FUNCTION organizational_scope.load_population_location(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION organizational_scope.load_population_location(uuid,uuid) TO c4g_organization_profile_runtime;
SET ROLE c4g_document_owner;
CREATE FUNCTION document_storage.load_population_reference(expected_organization uuid,expected_version uuid,expected_assertion uuid)
 RETURNS TABLE(document_id uuid,version_id uuid,author_subject_id text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF expected_organization IS DISTINCT FROM current_setting('app.organization_id',true)::uuid THEN RAISE EXCEPTION 'F13_POPULATION_INVALID_REFERENCE'; END IF;
 RETURN QUERY SELECT d.document_id,v.version_id,v.created_by_actor_id FROM document_storage.document d JOIN document_storage.document_version v
  ON v.organization_id=d.organization_id AND v.document_id=d.document_id
  WHERE v.organization_id=expected_organization AND v.version_id=expected_version AND d.resource_type='POPULATION_ASSERTION'
   AND d.resource_id=expected_assertion AND v.state='AVAILABLE' AND v.scan_state='CLEAN' FOR SHARE OF d,v;
END $$;
RESET ROLE;
REVOKE ALL ON FUNCTION document_storage.load_population_reference(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION document_storage.load_population_reference(uuid,uuid,uuid) TO c4g_organization_profile_runtime;
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK ((%s) OR event_code IN (''POPULATION_ASSERTION_CREATED'',''POPULATION_ASSERTION_EDITED'',''POPULATION_ASSERTION_READ'',''POPULATION_ASSERTION_SUBMITTED'',''POPULATION_ASSERTION_VERIFIED'',''POPULATION_ASSERTION_REJECTED'',''POPULATION_ASSERTION_DISPUTED'',''POPULATION_ASSERTION_REVOKED''))',tab,name,substring(definition from 8 for length(definition)-8));
 END LOOP;
 SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid='audit.event'::regclass AND conname='event_catalog_version_check';
 ALTER TABLE audit.event DROP CONSTRAINT event_catalog_version_check;
 EXECUTE 'ALTER TABLE audit.event ADD CONSTRAINT event_catalog_version_check CHECK (('||substring(definition from 8 for length(definition)-8)||') OR catalog_version=''f13-population-events-v1'')';
END $$;
