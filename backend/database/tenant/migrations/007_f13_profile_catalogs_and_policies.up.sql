DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_organization_profile_owner') THEN CREATE ROLE c4g_organization_profile_owner NOLOGIN NOINHERIT; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_organization_profile_runtime') THEN CREATE ROLE c4g_organization_profile_runtime NOLOGIN NOINHERIT; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_organization_profile_migrator') THEN CREATE ROLE c4g_organization_profile_migrator NOLOGIN NOINHERIT; END IF;
END $$;
GRANT c4g_organization_profile_owner TO c4g_organization_profile_migrator;
GRANT USAGE ON SCHEMA organizational_scope TO c4g_organization_profile_owner;
GRANT REFERENCES (organization_id,scope_id) ON organizational_scope.scope TO c4g_organization_profile_owner;
GRANT SELECT (organization_id,scope_id,scope_type,lifecycle) ON organizational_scope.scope TO c4g_organization_profile_owner;
CREATE SCHEMA organization_profile AUTHORIZATION c4g_organization_profile_owner;
REVOKE ALL ON SCHEMA organization_profile FROM PUBLIC;
GRANT USAGE ON SCHEMA organization_profile TO c4g_organization_profile_runtime;
SET ROLE c4g_organization_profile_owner;

CREATE TABLE organization_profile.profile_scope (
 profile_scope_id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 scope_type text NOT NULL CHECK(scope_type IN ('ORGANIZATION','UNIT','TEAM')),
 scope_id uuid,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CHECK((scope_type='ORGANIZATION' AND scope_id IS NULL) OR (scope_type IN ('UNIT','TEAM') AND scope_id IS NOT NULL)),
 FOREIGN KEY(organization_id,scope_id) REFERENCES organizational_scope.scope(organization_id,scope_id)
   ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX profile_scope_organization_baseline ON organization_profile.profile_scope(organization_id) WHERE scope_type='ORGANIZATION';
CREATE UNIQUE INDEX profile_scope_exact_local ON organization_profile.profile_scope(organization_id,scope_id) WHERE scope_id IS NOT NULL;

CREATE FUNCTION organization_profile.guard_profile_scope_reference() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,organizational_scope AS $$
BEGIN
 IF NEW.scope_type IN ('UNIT','TEAM') THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('F13-P1:' || NEW.organization_id::text,43001301));
   PERFORM 1 FROM organizational_scope.scope referenced_scope
    WHERE referenced_scope.organization_id=NEW.organization_id
      AND referenced_scope.scope_id=NEW.scope_id
      AND referenced_scope.scope_type=NEW.scope_type
      AND referenced_scope.lifecycle='ACTIVE';
   IF NOT FOUND THEN RAISE EXCEPTION 'F13_PROFILE_SCOPE_REFERENCE_INVALID'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER profile_scope_reference_guard BEFORE INSERT OR UPDATE OF organization_id,scope_type,scope_id
ON organization_profile.profile_scope FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_profile_scope_reference();

CREATE TABLE organization_profile.catalog_release (
 release_id uuid PRIMARY KEY,
 organization_id uuid,
 ownership_key text COLLATE "C" GENERATED ALWAYS AS (CASE WHEN organization_id IS NULL THEN 'GLOBAL' ELSE 'TENANT:' || organization_id::text END) STORED,
 namespace text NOT NULL CHECK(namespace IN ('GLOBAL','TENANT')),
 release_version text COLLATE "C" NOT NULL CHECK(release_version ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
 lifecycle text NOT NULL CHECK(lifecycle IN ('DRAFT','APPROVED','PUBLISHED','SUPERSEDED','ARCHIVED')),
 semantic_digest char(64) NOT NULL CHECK(semantic_digest ~ '^[a-f0-9]{64}$'),
 provenance jsonb NOT NULL CHECK(jsonb_typeof(provenance)='object'),
 published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CHECK((namespace='GLOBAL' AND organization_id IS NULL) OR (namespace='TENANT' AND organization_id IS NOT NULL)),
 CHECK((lifecycle='PUBLISHED' AND published_at IS NOT NULL) OR (lifecycle<>'PUBLISHED' AND published_at IS NULL)),
 UNIQUE NULLS NOT DISTINCT(organization_id,namespace,release_version),
 UNIQUE(release_id,ownership_key)
);

CREATE TABLE organization_profile.scheme (
 scheme_id uuid PRIMARY KEY,
 release_id uuid NOT NULL,
 organization_id uuid,
 ownership_key text COLLATE "C" GENERATED ALWAYS AS (CASE WHEN organization_id IS NULL THEN 'GLOBAL' ELSE 'TENANT:' || organization_id::text END) STORED,
 scheme_code text COLLATE "C" NOT NULL CHECK(scheme_code IN ('THEMATIC_AREA','STRATEGIC_PRIORITY','COUNTRY_TERRITORY','ADMINISTRATIVE_AREA','STATISTICAL_REGION','TRANSNATIONAL_AREA','LEGAL_NATURE','INSTITUTION_TYPE','CONTROL_STATUS','NON_PROFIT_STATUS','ECONOMIC_SIZE_CLASS','SERVED_POPULATION_GROUP')),
 relation_domain text NOT NULL CHECK(relation_domain IN ('THEMATIC','TERRITORY','NONE')),
 CHECK((scheme_code IN ('THEMATIC_AREA','STRATEGIC_PRIORITY') AND relation_domain='THEMATIC')
   OR (scheme_code IN ('COUNTRY_TERRITORY','ADMINISTRATIVE_AREA','STATISTICAL_REGION','TRANSNATIONAL_AREA') AND relation_domain='TERRITORY')
   OR (scheme_code IN ('LEGAL_NATURE','INSTITUTION_TYPE','CONTROL_STATUS','NON_PROFIT_STATUS','ECONOMIC_SIZE_CLASS','SERVED_POPULATION_GROUP') AND relation_domain='NONE')),
 UNIQUE(release_id,scheme_code),
 UNIQUE(scheme_id,release_id),
 UNIQUE(scheme_id,release_id,ownership_key),
 FOREIGN KEY(release_id,ownership_key) REFERENCES organization_profile.catalog_release(release_id,ownership_key) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE organization_profile.concept (
 concept_id uuid PRIMARY KEY,
 release_id uuid NOT NULL,
 scheme_id uuid NOT NULL,
 organization_id uuid,
 ownership_key text COLLATE "C" GENERATED ALWAYS AS (CASE WHEN organization_id IS NULL THEN 'GLOBAL' ELSE 'TENANT:' || organization_id::text END) STORED,
 stable_code text COLLATE "C" NOT NULL CHECK(stable_code ~ '^[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)*$' AND length(stable_code)<=128),
 deprecated_at timestamptz,
 replacement_concept_id uuid,
 provenance jsonb NOT NULL CHECK(jsonb_typeof(provenance)='object'),
 FOREIGN KEY(scheme_id,release_id,ownership_key) REFERENCES organization_profile.scheme(scheme_id,release_id,ownership_key) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(replacement_concept_id) REFERENCES organization_profile.concept(concept_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 UNIQUE(release_id,scheme_id,stable_code),
 UNIQUE(concept_id,scheme_id,release_id),
 CHECK(replacement_concept_id IS NULL OR replacement_concept_id<>concept_id)
);

CREATE TABLE organization_profile.concept_label (
 concept_id uuid NOT NULL REFERENCES organization_profile.concept(concept_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 locale text COLLATE "C" NOT NULL CHECK(locale ~ '^[a-z]{2}(?:-[A-Z]{2})?$'),
 label_kind text NOT NULL CHECK(label_kind IN ('PREFERRED','ALIAS')),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 512 AND label=btrim(label)),
 PRIMARY KEY(concept_id,locale,label_kind,label)
);
CREATE UNIQUE INDEX concept_label_one_preferred ON organization_profile.concept_label(concept_id,locale) WHERE label_kind='PREFERRED';

CREATE TABLE organization_profile.concept_relation (
 relation_id uuid PRIMARY KEY,
 release_id uuid NOT NULL,
 scheme_id uuid NOT NULL,
 source_concept_id uuid NOT NULL,
 target_concept_id uuid NOT NULL,
 relation_type text NOT NULL CHECK(relation_type IN ('PARENT','CONTAINS')),
 provenance jsonb NOT NULL CHECK(jsonb_typeof(provenance)='object'),
 FOREIGN KEY(source_concept_id,scheme_id,release_id) REFERENCES organization_profile.concept(concept_id,scheme_id,release_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(target_concept_id,scheme_id,release_id) REFERENCES organization_profile.concept(concept_id,scheme_id,release_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 CHECK(source_concept_id<>target_concept_id),
 UNIQUE(release_id,scheme_id,source_concept_id,target_concept_id,relation_type)
);

CREATE TABLE organization_profile.external_mapping (
 mapping_id uuid PRIMARY KEY,
 release_id uuid NOT NULL,
 scheme_id uuid NOT NULL,
 concept_id uuid NOT NULL,
 authority text COLLATE "C" NOT NULL CHECK(length(authority) BETWEEN 1 AND 128 AND authority=btrim(authority)),
 external_scheme text COLLATE "C" NOT NULL CHECK(length(external_scheme) BETWEEN 1 AND 128 AND external_scheme=btrim(external_scheme)),
 external_version text COLLATE "C" NOT NULL CHECK(length(external_version) BETWEEN 1 AND 128 AND external_version=btrim(external_version)),
 external_code text COLLATE "C" NOT NULL CHECK(length(external_code) BETWEEN 1 AND 256 AND external_code=btrim(external_code)),
 relation_type text NOT NULL CHECK(relation_type IN ('EXACT','CLOSE','BROADER','NARROWER','OVERLAPS')),
 provenance jsonb NOT NULL CHECK(jsonb_typeof(provenance)='object'),
 FOREIGN KEY(concept_id,scheme_id,release_id) REFERENCES organization_profile.concept(concept_id,scheme_id,release_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 UNIQUE(release_id,scheme_id,authority,external_scheme,external_version,external_code,relation_type)
);

CREATE TABLE organization_profile.taxonomy_idempotency_record (
 organization_id uuid NOT NULL,
 operation text COLLATE "C" NOT NULL CHECK(operation IN ('RELEASE_CREATE','CONCEPT_CREATE','CONCEPT_APPROVE','RELATION_CREATE','MAPPING_CREATE','RELEASE_PUBLISH')),
 idempotency_key uuid NOT NULL,
 intention_digest char(64) NOT NULL CHECK(intention_digest ~ '^[a-f0-9]{64}$'),
 result_projection jsonb NOT NULL CHECK(jsonb_typeof(result_projection)='object'),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,operation,idempotency_key)
);

CREATE TABLE organization_profile.metric_catalog_release (
 metric_release_id uuid PRIMARY KEY,
 organization_id uuid,
 release_version text COLLATE "C" NOT NULL CHECK(release_version ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
 lifecycle text NOT NULL CHECK(lifecycle IN ('DRAFT','APPROVED','PUBLISHED','SUPERSEDED','ARCHIVED')),
 semantic_digest char(64) NOT NULL CHECK(semantic_digest ~ '^[a-f0-9]{64}$'),
 provenance jsonb NOT NULL CHECK(jsonb_typeof(provenance)='object'),
 UNIQUE NULLS NOT DISTINCT(organization_id,release_version)
);
CREATE TABLE organization_profile.metric_definition (
 metric_id uuid PRIMARY KEY,
 metric_release_id uuid NOT NULL REFERENCES organization_profile.metric_catalog_release(metric_release_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 metric_code text COLLATE "C" NOT NULL CHECK(metric_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 value_kind text NOT NULL CHECK(value_kind IN ('INTEGER','DECIMAL','MONEY','RATIO','DURATION','COUNT')),
 unit_code text COLLATE "C" NOT NULL CHECK(unit_code ~ '^[A-Z][A-Z0-9_]{0,31}$'),
 UNIQUE(metric_release_id,metric_code),
 UNIQUE(metric_id,metric_release_id)
);
CREATE TABLE organization_profile.band_policy (
 band_policy_id uuid PRIMARY KEY,
 metric_release_id uuid NOT NULL REFERENCES organization_profile.metric_catalog_release(metric_release_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 policy_version text COLLATE "C" NOT NULL CHECK(policy_version ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
 policy_digest char(64) NOT NULL CHECK(policy_digest ~ '^[a-f0-9]{64}$'),
 UNIQUE(metric_release_id,policy_version)
);
CREATE TABLE organization_profile.derivation_policy (
 derivation_policy_id uuid PRIMARY KEY,
 metric_release_id uuid NOT NULL REFERENCES organization_profile.metric_catalog_release(metric_release_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 policy_version text COLLATE "C" NOT NULL CHECK(policy_version ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
 policy_digest char(64) NOT NULL CHECK(policy_digest ~ '^[a-f0-9]{64}$'),
 UNIQUE(metric_release_id,policy_version)
);

CREATE TABLE organization_profile.completion_policy (
 completion_policy_id uuid PRIMARY KEY,
 policy_version text COLLATE "C" NOT NULL,
 profile_schema_version text COLLATE "C" NOT NULL,
 scope_type text NOT NULL CHECK(scope_type IN ('ORGANIZATION','UNIT','TEAM')),
 domain_code text COLLATE "C" NOT NULL CHECK(domain_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 lifecycle text NOT NULL CHECK(lifecycle IN ('DRAFT','PUBLISHED','SUPERSEDED','ARCHIVED')),
 policy_digest char(64) NOT NULL CHECK(policy_digest ~ '^[a-f0-9]{64}$'),
 UNIQUE(policy_version,profile_schema_version,scope_type,domain_code),
 UNIQUE(completion_policy_id,policy_version)
);
CREATE TABLE organization_profile.completion_slot (
 completion_policy_id uuid NOT NULL REFERENCES organization_profile.completion_policy(completion_policy_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 slot_code text COLLATE "C" NOT NULL CHECK(slot_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 allowed_knowledge_states text[] NOT NULL CHECK(cardinality(allowed_knowledge_states)>0),
 verification_requirement text NOT NULL CHECK(verification_requirement IN ('VERIFIED','UNVERIFIED_ALLOWED','NOT_REQUIRED_ALLOWED')),
 reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
 PRIMARY KEY(completion_policy_id,slot_code)
);
CREATE TABLE organization_profile.completion_rule (
 completion_policy_id uuid NOT NULL REFERENCES organization_profile.completion_policy(completion_policy_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 rule_code text COLLATE "C" NOT NULL CHECK(rule_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 rule_kind text NOT NULL CHECK(rule_kind IN ('REQUIRE_SLOT','FORBID_COMBINATION','REQUIRE_WHEN')),
 operands jsonb NOT NULL CHECK(jsonb_typeof(operands)='object'),
 PRIMARY KEY(completion_policy_id,rule_code)
);

CREATE TABLE organization_profile.projection_policy (
 projection_policy_id uuid PRIMARY KEY,
 policy_version text COLLATE "C" NOT NULL,
 operation_code text COLLATE "C" NOT NULL CHECK(operation_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 purpose_code text COLLATE "C" NOT NULL CHECK(purpose_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 classification text NOT NULL CHECK(classification IN ('INTERNAL','RESTRICTED','HIGHLY_RESTRICTED')),
 projection_mode text NOT NULL CHECK(projection_mode IN ('EXACT','DERIVED','REDACTED','OMITTED')),
 lifecycle text NOT NULL CHECK(lifecycle IN ('DRAFT','PUBLISHED','SUPERSEDED','ARCHIVED')),
 policy_digest char(64) NOT NULL CHECK(policy_digest ~ '^[a-f0-9]{64}$'),
 UNIQUE(policy_version,operation_code,purpose_code,classification)
);
CREATE TABLE organization_profile.purpose_catalog_release (
 catalog_version text COLLATE "C" PRIMARY KEY,
 lifecycle text NOT NULL CHECK(lifecycle IN ('DRAFT','PUBLISHED','SUPERSEDED','ARCHIVED')),
 catalog_digest char(64) NOT NULL CHECK(catalog_digest ~ '^[a-f0-9]{64}$'),
 published_at timestamptz,
 CHECK((lifecycle='DRAFT' AND published_at IS NULL) OR (lifecycle IN ('PUBLISHED','SUPERSEDED','ARCHIVED') AND published_at IS NOT NULL))
);
CREATE TABLE organization_profile.purpose_catalog_entry (
 catalog_version text COLLATE "C" NOT NULL REFERENCES organization_profile.purpose_catalog_release(catalog_version) ON UPDATE RESTRICT ON DELETE RESTRICT,
 purpose_code text COLLATE "C" NOT NULL CHECK(purpose_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 operation_code text COLLATE "C" NOT NULL CHECK(operation_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 lifecycle text NOT NULL CHECK(lifecycle IN ('DRAFT','PUBLISHED','DEPRECATED')),
 PRIMARY KEY(catalog_version,purpose_code,operation_code)
);
CREATE TABLE organization_profile.reason_catalog_release (
 catalog_version text COLLATE "C" PRIMARY KEY,
 lifecycle text NOT NULL CHECK(lifecycle IN ('DRAFT','PUBLISHED','SUPERSEDED','ARCHIVED')),
 catalog_digest char(64) NOT NULL CHECK(catalog_digest ~ '^[a-f0-9]{64}$'),
 published_at timestamptz,
 CHECK((lifecycle='DRAFT' AND published_at IS NULL) OR (lifecycle IN ('PUBLISHED','SUPERSEDED','ARCHIVED') AND published_at IS NOT NULL))
);
CREATE TABLE organization_profile.reason_catalog_entry (
 catalog_version text COLLATE "C" NOT NULL REFERENCES organization_profile.reason_catalog_release(catalog_version) ON UPDATE RESTRICT ON DELETE RESTRICT,
 reason_code text COLLATE "C" NOT NULL CHECK(reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 operation_code text COLLATE "C" NOT NULL CHECK(operation_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 lifecycle text NOT NULL CHECK(lifecycle IN ('DRAFT','PUBLISHED','DEPRECATED')),
 PRIMARY KEY(catalog_version,reason_code,operation_code)
);

CREATE TABLE organization_profile.compatibility_manifest (
 manifest_id uuid PRIMARY KEY,
 manifest_version text COLLATE "C" NOT NULL UNIQUE,
 manifest_digest char(64) NOT NULL CHECK(manifest_digest ~ '^[a-f0-9]{64}$'),
 lifecycle text NOT NULL CHECK(lifecycle IN ('DRAFT','PUBLISHED','SUPERSEDED','ARCHIVED')),
 published_at timestamptz
);
CREATE TABLE organization_profile.release_bundle (
 bundle_id uuid PRIMARY KEY,
 manifest_id uuid NOT NULL REFERENCES organization_profile.compatibility_manifest(manifest_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 bundle_version text COLLATE "C" NOT NULL,
 profile_schema_version text COLLATE "C" NOT NULL,
 snapshot_schema_version text COLLATE "C" NOT NULL,
 tuple_definition jsonb NOT NULL CHECK(jsonb_typeof(tuple_definition)='object'),
 bundle_digest char(64) NOT NULL CHECK(bundle_digest ~ '^[a-f0-9]{64}$'),
 UNIQUE(manifest_id,bundle_version)
);

CREATE FUNCTION organization_profile.guard_immutable_release() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'F13_PROFILE_DELETE_FORBIDDEN'; END IF;
 IF OLD.lifecycle IN ('PUBLISHED','SUPERSEDED','ARCHIVED') THEN RAISE EXCEPTION 'F13_PROFILE_RELEASE_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER catalog_release_immutable BEFORE UPDATE OR DELETE ON organization_profile.catalog_release FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_immutable_release();
CREATE TRIGGER metric_release_immutable BEFORE UPDATE OR DELETE ON organization_profile.metric_catalog_release FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_immutable_release();
CREATE TRIGGER completion_policy_immutable BEFORE UPDATE OR DELETE ON organization_profile.completion_policy FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_immutable_release();
CREATE TRIGGER projection_policy_immutable BEFORE UPDATE OR DELETE ON organization_profile.projection_policy FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_immutable_release();
CREATE TRIGGER compatibility_manifest_immutable BEFORE UPDATE OR DELETE ON organization_profile.compatibility_manifest FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_immutable_release();
CREATE TRIGGER purpose_catalog_release_immutable BEFORE UPDATE OR DELETE ON organization_profile.purpose_catalog_release FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_immutable_release();
CREATE TRIGGER reason_catalog_release_immutable BEFORE UPDATE OR DELETE ON organization_profile.reason_catalog_release FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_immutable_release();

CREATE FUNCTION organization_profile.lock_catalog_releases_mutable(first_release_id uuid,second_release_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,organization_profile AS $$
DECLARE locked_release_id uuid; locked_lifecycle text;
BEGIN
 FOR locked_release_id IN
  SELECT candidate.release_id FROM unnest(ARRAY[first_release_id,second_release_id]) AS candidate(release_id)
   WHERE candidate.release_id IS NOT NULL GROUP BY candidate.release_id ORDER BY candidate.release_id
 LOOP
  SELECT lifecycle INTO locked_lifecycle FROM organization_profile.catalog_release
   WHERE release_id=locked_release_id FOR UPDATE;
  IF locked_lifecycle IN ('PUBLISHED','SUPERSEDED','ARCHIVED') THEN
   RAISE EXCEPTION 'F13_PROFILE_RELEASE_MEMBER_IMMUTABLE';
  END IF;
 END LOOP;
END $$;

CREATE FUNCTION organization_profile.guard_catalog_member_immutability() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,organization_profile AS $$
DECLARE old_release_id uuid; new_release_id uuid; locked_concept_id uuid; locked_concept_release_id uuid;
BEGIN
 IF TG_TABLE_NAME='concept_label' THEN
  FOR locked_concept_id IN
   SELECT candidate.concept_id FROM unnest(ARRAY[
    CASE WHEN TG_OP<>'INSERT' THEN OLD.concept_id END,
    CASE WHEN TG_OP<>'DELETE' THEN NEW.concept_id END
   ]) AS candidate(concept_id)
    WHERE candidate.concept_id IS NOT NULL GROUP BY candidate.concept_id ORDER BY candidate.concept_id
  LOOP
   SELECT release_id INTO locked_concept_release_id FROM organization_profile.concept
    WHERE concept_id=locked_concept_id FOR UPDATE;
   IF TG_OP<>'INSERT' AND locked_concept_id=OLD.concept_id THEN old_release_id:=locked_concept_release_id; END IF;
   IF TG_OP<>'DELETE' AND locked_concept_id=NEW.concept_id THEN new_release_id:=locked_concept_release_id; END IF;
  END LOOP;
 ELSE
  IF TG_OP<>'INSERT' THEN old_release_id:=OLD.release_id; END IF;
  IF TG_OP<>'DELETE' THEN new_release_id:=NEW.release_id; END IF;
 END IF;
  PERFORM organization_profile.lock_catalog_releases_mutable(old_release_id,new_release_id);
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER scheme_release_immutable BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.scheme FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_catalog_member_immutability();
CREATE TRIGGER concept_release_immutable BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.concept FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_catalog_member_immutability();
CREATE TRIGGER concept_label_release_immutable BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.concept_label FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_catalog_member_immutability();
CREATE TRIGGER concept_relation_release_immutable BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.concept_relation FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_catalog_member_immutability();
CREATE TRIGGER external_mapping_release_immutable BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.external_mapping FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_catalog_member_immutability();

CREATE FUNCTION organization_profile.guard_scheme_relation_contract() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,organization_profile AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.scheme_code<>OLD.scheme_code OR NEW.relation_domain<>OLD.relation_domain) THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('F13-TAXONOMY:' || OLD.release_id::text || ':' || OLD.scheme_id::text,43001302));
  IF EXISTS(SELECT 1 FROM organization_profile.concept_relation
      WHERE release_id=OLD.release_id AND scheme_id=OLD.scheme_id) THEN
   RAISE EXCEPTION 'F13_PROFILE_SCHEME_RELATION_DOMAIN_IMMUTABLE';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scheme_relation_contract_guard BEFORE UPDATE OF scheme_code,relation_domain ON organization_profile.scheme
FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_scheme_relation_contract();

CREATE FUNCTION organization_profile.guard_concept_relation_graph() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,organization_profile AS $$
DECLARE locked_release_id uuid; locked_scheme_id uuid; new_relation_domain text; cycle_found boolean;
BEGIN
 FOR locked_release_id,locked_scheme_id IN
  SELECT candidate.release_id,candidate.scheme_id FROM (VALUES
   (CASE WHEN TG_OP<>'INSERT' THEN OLD.release_id END,CASE WHEN TG_OP<>'INSERT' THEN OLD.scheme_id END),
   (CASE WHEN TG_OP<>'DELETE' THEN NEW.release_id END,CASE WHEN TG_OP<>'DELETE' THEN NEW.scheme_id END)
  ) AS candidate(release_id,scheme_id)
   WHERE candidate.release_id IS NOT NULL AND candidate.scheme_id IS NOT NULL
   GROUP BY candidate.release_id,candidate.scheme_id ORDER BY candidate.release_id,candidate.scheme_id
 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('F13-TAXONOMY:' || locked_release_id::text || ':' || locked_scheme_id::text,43001302));
  PERFORM 1 FROM organization_profile.scheme
   WHERE release_id=locked_release_id AND scheme_id=locked_scheme_id FOR UPDATE;
  IF TG_OP<>'DELETE' AND locked_release_id=NEW.release_id AND locked_scheme_id=NEW.scheme_id THEN
   SELECT relation_domain INTO new_relation_domain FROM organization_profile.scheme
    WHERE release_id=NEW.release_id AND scheme_id=NEW.scheme_id;
  END IF;
 END LOOP;
 IF TG_OP<>'DELETE' THEN
  IF (new_relation_domain='THEMATIC' AND NEW.relation_type<>'PARENT')
    OR (new_relation_domain='TERRITORY' AND NEW.relation_type<>'CONTAINS')
    OR new_relation_domain='NONE' OR new_relation_domain IS NULL THEN
   RAISE EXCEPTION 'F13_PROFILE_RELATION_DOMAIN_INVALID';
  END IF;
  WITH RECURSIVE reachable(concept_id) AS (
   SELECT relation.target_concept_id FROM organization_profile.concept_relation relation
    WHERE relation.release_id=NEW.release_id AND relation.scheme_id=NEW.scheme_id
      AND relation.relation_type=NEW.relation_type AND relation.source_concept_id=NEW.target_concept_id
      AND relation.relation_id<>CASE WHEN TG_OP='UPDATE' THEN OLD.relation_id ELSE NEW.relation_id END
   UNION
   SELECT relation.target_concept_id FROM organization_profile.concept_relation relation
    JOIN reachable ON reachable.concept_id=relation.source_concept_id
    WHERE relation.release_id=NEW.release_id AND relation.scheme_id=NEW.scheme_id
      AND relation.relation_type=NEW.relation_type
      AND relation.relation_id<>CASE WHEN TG_OP='UPDATE' THEN OLD.relation_id ELSE NEW.relation_id END
  )
  SELECT EXISTS(SELECT 1 FROM reachable WHERE concept_id=NEW.source_concept_id) INTO cycle_found;
  IF cycle_found THEN RAISE EXCEPTION 'F13_PROFILE_RELATION_CYCLE'; END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER concept_relation_graph_guard BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.concept_relation
FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_concept_relation_graph();

-- Statement-level fencing precedes PostgreSQL's UPDATE tuple locks. A row trigger
-- alone cannot prevent tuple -> advisory versus advisory -> tuple inversions.
-- Advisory locks are database-local: this serializes taxonomy writes in one tenant,
-- never across physical tenant databases. Graph-specific locks remain below it.
CREATE FUNCTION organization_profile.lock_taxonomy_statement() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,organization_profile AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('F13-TAXONOMY-DAG',43001304));
 RETURN NULL;
END $$;
CREATE TRIGGER catalog_release_statement_lock BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.catalog_release FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.lock_taxonomy_statement();
CREATE TRIGGER scheme_statement_lock BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.scheme FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.lock_taxonomy_statement();
CREATE TRIGGER concept_statement_lock BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.concept FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.lock_taxonomy_statement();
CREATE TRIGGER concept_label_statement_lock BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.concept_label FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.lock_taxonomy_statement();
CREATE TRIGGER concept_relation_statement_lock BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.concept_relation FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.lock_taxonomy_statement();
CREATE TRIGGER external_mapping_statement_lock BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.external_mapping FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.lock_taxonomy_statement();

CREATE FUNCTION organization_profile.guard_metric_member_immutability() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,organization_profile AS $$
DECLARE locked_release_id uuid; locked_lifecycle text;
BEGIN
 FOR locked_release_id IN
  SELECT candidate.metric_release_id FROM unnest(ARRAY[
   CASE WHEN TG_OP<>'INSERT' THEN OLD.metric_release_id END,
   CASE WHEN TG_OP<>'DELETE' THEN NEW.metric_release_id END
  ]) AS candidate(metric_release_id)
   WHERE candidate.metric_release_id IS NOT NULL GROUP BY candidate.metric_release_id ORDER BY candidate.metric_release_id
 LOOP
  SELECT lifecycle INTO locked_lifecycle FROM organization_profile.metric_catalog_release
   WHERE metric_release_id=locked_release_id FOR UPDATE;
  IF locked_lifecycle IN ('PUBLISHED','SUPERSEDED','ARCHIVED') THEN
   RAISE EXCEPTION 'F13_PROFILE_RELEASE_MEMBER_IMMUTABLE';
  END IF;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER metric_definition_release_immutable BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.metric_definition FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_metric_member_immutability();
CREATE TRIGGER band_policy_release_immutable BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.band_policy FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_metric_member_immutability();
CREATE TRIGGER derivation_policy_release_immutable BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.derivation_policy FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_metric_member_immutability();

CREATE FUNCTION organization_profile.guard_completion_member_immutability() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,organization_profile AS $$
DECLARE locked_policy_id uuid; locked_lifecycle text;
BEGIN
 FOR locked_policy_id IN
  SELECT candidate.completion_policy_id FROM unnest(ARRAY[
   CASE WHEN TG_OP<>'INSERT' THEN OLD.completion_policy_id END,
   CASE WHEN TG_OP<>'DELETE' THEN NEW.completion_policy_id END
  ]) AS candidate(completion_policy_id)
   WHERE candidate.completion_policy_id IS NOT NULL GROUP BY candidate.completion_policy_id ORDER BY candidate.completion_policy_id
 LOOP
  SELECT lifecycle INTO locked_lifecycle FROM organization_profile.completion_policy
   WHERE completion_policy_id=locked_policy_id FOR UPDATE;
  IF locked_lifecycle IN ('PUBLISHED','SUPERSEDED','ARCHIVED') THEN
   RAISE EXCEPTION 'F13_PROFILE_POLICY_MEMBER_IMMUTABLE';
  END IF;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER completion_slot_policy_immutable BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.completion_slot FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_completion_member_immutability();
CREATE TRIGGER completion_rule_policy_immutable BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.completion_rule FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_completion_member_immutability();

CREATE FUNCTION organization_profile.guard_bundle_immutability() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,organization_profile AS $$
DECLARE locked_manifest_id uuid; locked_lifecycle text;
BEGIN
 FOR locked_manifest_id IN
  SELECT candidate.manifest_id FROM unnest(ARRAY[
   CASE WHEN TG_OP<>'INSERT' THEN OLD.manifest_id END,
   CASE WHEN TG_OP<>'DELETE' THEN NEW.manifest_id END
  ]) AS candidate(manifest_id)
   WHERE candidate.manifest_id IS NOT NULL GROUP BY candidate.manifest_id ORDER BY candidate.manifest_id
 LOOP
  SELECT lifecycle INTO locked_lifecycle FROM organization_profile.compatibility_manifest
   WHERE manifest_id=locked_manifest_id FOR UPDATE;
  IF locked_lifecycle IN ('PUBLISHED','SUPERSEDED','ARCHIVED') THEN
   RAISE EXCEPTION 'F13_PROFILE_MANIFEST_MEMBER_IMMUTABLE';
  END IF;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER release_bundle_manifest_immutable BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.release_bundle FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_bundle_immutability();

CREATE FUNCTION organization_profile.guard_access_catalog_publication() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,organization_profile AS $$
DECLARE entry_count bigint; draft_count bigint;
BEGIN
 IF NEW.lifecycle='PUBLISHED' AND OLD.lifecycle<>'PUBLISHED' THEN
  IF TG_TABLE_NAME='purpose_catalog_release' THEN
   SELECT count(*),count(*) FILTER(WHERE lifecycle='DRAFT') INTO entry_count,draft_count
    FROM organization_profile.purpose_catalog_entry WHERE catalog_version=NEW.catalog_version;
  ELSE
   SELECT count(*),count(*) FILTER(WHERE lifecycle='DRAFT') INTO entry_count,draft_count
    FROM organization_profile.reason_catalog_entry WHERE catalog_version=NEW.catalog_version;
  END IF;
  IF entry_count=0 OR draft_count<>0 THEN RAISE EXCEPTION 'F13_PROFILE_CATALOG_PUBLICATION_INCOMPLETE'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER purpose_catalog_release_complete BEFORE UPDATE ON organization_profile.purpose_catalog_release FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_access_catalog_publication();
CREATE TRIGGER reason_catalog_release_complete BEFORE UPDATE ON organization_profile.reason_catalog_release FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_access_catalog_publication();

CREATE FUNCTION organization_profile.guard_access_catalog_member_immutability() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,organization_profile AS $$
DECLARE old_catalog_version text; new_catalog_version text; locked_catalog_version text; locked_lifecycle text;
BEGIN
 IF TG_OP<>'INSERT' THEN old_catalog_version:=OLD.catalog_version; END IF;
 IF TG_OP<>'DELETE' THEN new_catalog_version:=NEW.catalog_version; END IF;
 FOR locked_catalog_version IN
  SELECT candidate.catalog_version FROM unnest(ARRAY[old_catalog_version,new_catalog_version]) AS candidate(catalog_version)
   WHERE candidate.catalog_version IS NOT NULL GROUP BY candidate.catalog_version ORDER BY candidate.catalog_version COLLATE "C"
 LOOP
  IF TG_TABLE_NAME='purpose_catalog_entry' THEN
   SELECT lifecycle INTO locked_lifecycle FROM organization_profile.purpose_catalog_release
    WHERE catalog_version=locked_catalog_version FOR UPDATE;
  ELSE
   SELECT lifecycle INTO locked_lifecycle FROM organization_profile.reason_catalog_release
    WHERE catalog_version=locked_catalog_version FOR UPDATE;
  END IF;
  IF locked_lifecycle IN ('PUBLISHED','SUPERSEDED','ARCHIVED') THEN
   RAISE EXCEPTION 'F13_PROFILE_CATALOG_ENTRY_IMMUTABLE';
  END IF;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER purpose_entry_immutable BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.purpose_catalog_entry FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_access_catalog_member_immutability();
CREATE TRIGGER reason_entry_immutable BEFORE INSERT OR UPDATE OR DELETE ON organization_profile.reason_catalog_entry FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_access_catalog_member_immutability();

CREATE FUNCTION organization_profile.reject_catalog_truncate() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'F13_PROFILE_TRUNCATE_FORBIDDEN'; END $$;
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['catalog_release','scheme','concept','concept_label','concept_relation','external_mapping',
  'metric_catalog_release','metric_definition','band_policy','derivation_policy','completion_policy','completion_slot',
  'completion_rule','projection_policy','purpose_catalog_release','purpose_catalog_entry','reason_catalog_release','reason_catalog_entry','compatibility_manifest','release_bundle','taxonomy_idempotency_record'] LOOP
   EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON organization_profile.%I FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.reject_catalog_truncate()',table_name || '_truncate_forbidden',table_name);
 END LOOP;
END $$;

CREATE FUNCTION organization_profile.assert_007_down_safe() RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,organization_profile SET row_security=off AS $$
DECLARE root_name text; root_has_data boolean;
BEGIN
 FOR root_name IN SELECT name FROM unnest(ARRAY['profile_scope','catalog_release','metric_catalog_release',
   'completion_policy','projection_policy','compatibility_manifest','purpose_catalog_release','reason_catalog_release',
   'taxonomy_idempotency_record']) AS roots(name) ORDER BY name LOOP
  EXECUTE format('LOCK TABLE organization_profile.%I IN ACCESS EXCLUSIVE MODE',root_name);
 END LOOP;
 FOR root_name IN SELECT name FROM unnest(ARRAY['profile_scope','catalog_release','metric_catalog_release',
   'completion_policy','projection_policy','compatibility_manifest','purpose_catalog_release','reason_catalog_release',
   'taxonomy_idempotency_record']) AS roots(name) ORDER BY name LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM organization_profile.%I LIMIT 1)',root_name) INTO root_has_data;
  IF root_has_data THEN RAISE EXCEPTION 'F13_PROFILE_007_DOWN_REFUSES_DATA_LOSS'; END IF;
 END LOOP;
END $$;

DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['profile_scope','catalog_release','scheme','concept','concept_label','concept_relation','external_mapping','metric_catalog_release','metric_definition','band_policy','derivation_policy','completion_policy','completion_slot','completion_rule','projection_policy','purpose_catalog_release','purpose_catalog_entry','reason_catalog_release','reason_catalog_entry','compatibility_manifest','release_bundle','taxonomy_idempotency_record'] LOOP
   EXECUTE format('ALTER TABLE organization_profile.%I ENABLE ROW LEVEL SECURITY',table_name);
   EXECUTE format('ALTER TABLE organization_profile.%I FORCE ROW LEVEL SECURITY',table_name);
 END LOOP;
END $$;

CREATE POLICY profile_scope_isolation ON organization_profile.profile_scope USING(organization_id=current_setting('app.organization_id',true)::uuid) WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid);
CREATE POLICY catalog_release_read ON organization_profile.catalog_release FOR SELECT USING(organization_id IS NULL OR organization_id=current_setting('app.organization_id',true)::uuid);
CREATE POLICY catalog_release_insert ON organization_profile.catalog_release FOR INSERT WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid AND namespace='TENANT');
CREATE POLICY catalog_release_update ON organization_profile.catalog_release FOR UPDATE USING(organization_id=current_setting('app.organization_id',true)::uuid AND namespace='TENANT') WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid AND namespace='TENANT');
CREATE POLICY metric_release_isolation ON organization_profile.metric_catalog_release USING(organization_id IS NULL OR organization_id=current_setting('app.organization_id',true)::uuid) WITH CHECK(organization_id IS NULL OR organization_id=current_setting('app.organization_id',true)::uuid);
CREATE POLICY scheme_read ON organization_profile.scheme FOR SELECT USING(organization_id IS NULL OR organization_id=current_setting('app.organization_id',true)::uuid);
CREATE POLICY scheme_insert ON organization_profile.scheme FOR INSERT WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid);
CREATE POLICY scheme_update ON organization_profile.scheme FOR UPDATE USING(organization_id=current_setting('app.organization_id',true)::uuid) WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid);
CREATE POLICY concept_read ON organization_profile.concept FOR SELECT USING(organization_id IS NULL OR organization_id=current_setting('app.organization_id',true)::uuid);
CREATE POLICY concept_insert ON organization_profile.concept FOR INSERT WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid);
CREATE POLICY concept_update ON organization_profile.concept FOR UPDATE USING(organization_id=current_setting('app.organization_id',true)::uuid) WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid);
CREATE POLICY concept_label_read ON organization_profile.concept_label FOR SELECT USING(EXISTS(SELECT 1 FROM organization_profile.concept c WHERE c.concept_id=concept_label.concept_id AND (c.organization_id IS NULL OR c.organization_id=current_setting('app.organization_id',true)::uuid)));
CREATE POLICY concept_label_write ON organization_profile.concept_label FOR ALL USING(EXISTS(SELECT 1 FROM organization_profile.concept c WHERE c.concept_id=concept_label.concept_id AND c.organization_id=current_setting('app.organization_id',true)::uuid)) WITH CHECK(EXISTS(SELECT 1 FROM organization_profile.concept c WHERE c.concept_id=concept_label.concept_id AND c.organization_id=current_setting('app.organization_id',true)::uuid));
CREATE POLICY concept_relation_read ON organization_profile.concept_relation FOR SELECT USING(EXISTS(SELECT 1 FROM organization_profile.scheme s WHERE s.scheme_id=concept_relation.scheme_id AND s.release_id=concept_relation.release_id AND (s.organization_id IS NULL OR s.organization_id=current_setting('app.organization_id',true)::uuid)));
CREATE POLICY concept_relation_write ON organization_profile.concept_relation FOR ALL USING(EXISTS(SELECT 1 FROM organization_profile.scheme s WHERE s.scheme_id=concept_relation.scheme_id AND s.release_id=concept_relation.release_id AND s.organization_id=current_setting('app.organization_id',true)::uuid)) WITH CHECK(EXISTS(SELECT 1 FROM organization_profile.scheme s WHERE s.scheme_id=concept_relation.scheme_id AND s.release_id=concept_relation.release_id AND s.organization_id=current_setting('app.organization_id',true)::uuid));
CREATE POLICY external_mapping_read ON organization_profile.external_mapping FOR SELECT USING(EXISTS(SELECT 1 FROM organization_profile.scheme s WHERE s.scheme_id=external_mapping.scheme_id AND s.release_id=external_mapping.release_id AND (s.organization_id IS NULL OR s.organization_id=current_setting('app.organization_id',true)::uuid)));
CREATE POLICY external_mapping_write ON organization_profile.external_mapping FOR ALL USING(EXISTS(SELECT 1 FROM organization_profile.scheme s WHERE s.scheme_id=external_mapping.scheme_id AND s.release_id=external_mapping.release_id AND s.organization_id=current_setting('app.organization_id',true)::uuid)) WITH CHECK(EXISTS(SELECT 1 FROM organization_profile.scheme s WHERE s.scheme_id=external_mapping.scheme_id AND s.release_id=external_mapping.release_id AND s.organization_id=current_setting('app.organization_id',true)::uuid));
CREATE POLICY taxonomy_idempotency_isolation ON organization_profile.taxonomy_idempotency_record USING(organization_id=current_setting('app.organization_id',true)::uuid) WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid);

RESET ROLE;
REVOKE ALL ON ALL TABLES IN SCHEMA organization_profile FROM PUBLIC,c4g_organization_profile_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA organization_profile FROM PUBLIC,c4g_organization_profile_runtime;
GRANT SELECT,INSERT,UPDATE ON organization_profile.catalog_release,organization_profile.scheme,organization_profile.concept TO c4g_organization_profile_runtime;
GRANT SELECT,INSERT,UPDATE ON organization_profile.concept_label,organization_profile.concept_relation,organization_profile.external_mapping TO c4g_organization_profile_runtime;
GRANT SELECT,INSERT ON organization_profile.taxonomy_idempotency_record TO c4g_organization_profile_runtime;
GRANT EXECUTE ON FUNCTION organization_profile.lock_catalog_releases_mutable(uuid,uuid) TO c4g_organization_profile_runtime;
REVOKE DELETE,TRUNCATE ON ALL TABLES IN SCHEMA organization_profile FROM c4g_organization_profile_runtime;
GRANT USAGE ON SCHEMA audit TO c4g_organization_profile_runtime;
GRANT EXECUTE ON FUNCTION audit.prepare_append_v1(uuid,text) TO c4g_organization_profile_runtime;
GRANT EXECUTE ON FUNCTION audit.append_event_v1(uuid,text,text,integer,text,text,audit.ledger_location,uuid,uuid,audit.actor_type,text,text,text,bigint,timestamptz,timestamptz,uuid,uuid,text,text,text,text,jsonb) TO c4g_organization_profile_runtime;

ALTER TABLE audit.event_identity DROP CONSTRAINT event_identity_event_code_check;
ALTER TABLE audit.event_identity ADD CONSTRAINT event_identity_event_code_check CHECK(event_code IN (
 'AUTHORIZATION_ALLOWED','AUTHORIZATION_DENIED','AUTHORIZATION_POLICY_INVALID','AUTHORIZATION_MFA_REQUIRED','AUTHORIZATION_VERSION_ADVANCED','GRANT_CHANGED','PROFILE_CHANGED','SOD_CHANGED','SENSITIVE_ACTION_ALLOWED','SUPPORT_GRANTED','SUPPORT_STARTED','SUPPORT_USED','SUPPORT_REVOKED','SUPPORT_EXPIRED','SERVICE_JOB_DISPATCHED','SERVICE_JOB_COMPLETED','EXPORT_ALLOWED','EXPORT_COMPLETED','DOCUMENT_ALLOWED','DOCUMENT_COMPLETED','ASYNC_EFFECT_AUTHORIZED','ASYNC_REPLAY_AUTHORIZED','ASYNC_REPLAY_REQUESTED','ASYNC_REPLAY_APPROVED','ASYNC_REPLAY_EXECUTION_CREATED','ASYNC_AUTHORIZATION_DENIED','ASYNC_JOB_OBSERVED','ASYNC_RECONCILIATION_REQUIRED','DOCUMENT_UPLOAD_INTENT_ACCEPTED','DOCUMENT_UPLOAD_CONFIRMED','DOCUMENT_SCAN_COMPLETED','DOCUMENT_ACCESS_CAPABILITY_ISSUED','DOCUMENT_VERSION_CREATED','DOCUMENT_ACCESS_BLOCKED','DOCUMENT_RECONCILIATION_DETECTED','DOCUMENT_UPLOAD_CANCELLED','DOCUMENT_LIFECYCLE_REQUESTED','OPPORTUNITY_CREATED','OPPORTUNITY_REVISION_CREATED','OPPORTUNITY_ARCHIVED','OPPORTUNITY_RESTORED','OPPORTUNITY_PROVENANCE_LINKED','OPPORTUNITY_QUALITY_EVALUATED','OPPORTUNITY_EXACT_DUPLICATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_CANDIDATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_DECISION_RECORDED','OPPORTUNITY_ACCESS_DENIED','OPPORTUNITY_RECONCILIATION_REQUIRED','ORGANIZATIONAL_SCOPE_CREATED','ORGANIZATIONAL_SCOPE_RENAMED','ORGANIZATIONAL_SCOPE_REPARENTED','ORGANIZATIONAL_SCOPE_ARCHIVED','TAXONOMY_RELEASE_CREATED','TAXONOMY_LOCAL_CONCEPT_CREATED','TAXONOMY_LOCAL_CONCEPT_APPROVED','TAXONOMY_RELATION_CREATED','TAXONOMY_MAPPING_CREATED','TAXONOMY_RELEASE_PUBLISHED'));
ALTER TABLE audit.event DROP CONSTRAINT event_event_code_check,DROP CONSTRAINT event_catalog_version_check;
ALTER TABLE audit.event ADD CONSTRAINT event_event_code_check CHECK(event_code IN (
 'AUTHORIZATION_ALLOWED','AUTHORIZATION_DENIED','AUTHORIZATION_POLICY_INVALID','AUTHORIZATION_MFA_REQUIRED','AUTHORIZATION_VERSION_ADVANCED','GRANT_CHANGED','PROFILE_CHANGED','SOD_CHANGED','SENSITIVE_ACTION_ALLOWED','SUPPORT_GRANTED','SUPPORT_STARTED','SUPPORT_USED','SUPPORT_REVOKED','SUPPORT_EXPIRED','SERVICE_JOB_DISPATCHED','SERVICE_JOB_COMPLETED','EXPORT_ALLOWED','EXPORT_COMPLETED','DOCUMENT_ALLOWED','DOCUMENT_COMPLETED','ASYNC_EFFECT_AUTHORIZED','ASYNC_REPLAY_AUTHORIZED','ASYNC_REPLAY_REQUESTED','ASYNC_REPLAY_APPROVED','ASYNC_REPLAY_EXECUTION_CREATED','ASYNC_AUTHORIZATION_DENIED','ASYNC_JOB_OBSERVED','ASYNC_RECONCILIATION_REQUIRED','DOCUMENT_UPLOAD_INTENT_ACCEPTED','DOCUMENT_UPLOAD_CONFIRMED','DOCUMENT_SCAN_COMPLETED','DOCUMENT_ACCESS_CAPABILITY_ISSUED','DOCUMENT_VERSION_CREATED','DOCUMENT_ACCESS_BLOCKED','DOCUMENT_RECONCILIATION_DETECTED','DOCUMENT_UPLOAD_CANCELLED','DOCUMENT_LIFECYCLE_REQUESTED','OPPORTUNITY_CREATED','OPPORTUNITY_REVISION_CREATED','OPPORTUNITY_ARCHIVED','OPPORTUNITY_RESTORED','OPPORTUNITY_PROVENANCE_LINKED','OPPORTUNITY_QUALITY_EVALUATED','OPPORTUNITY_EXACT_DUPLICATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_CANDIDATE_IDENTIFIED','OPPORTUNITY_DUPLICATE_DECISION_RECORDED','OPPORTUNITY_ACCESS_DENIED','OPPORTUNITY_RECONCILIATION_REQUIRED','ORGANIZATIONAL_SCOPE_CREATED','ORGANIZATIONAL_SCOPE_RENAMED','ORGANIZATIONAL_SCOPE_REPARENTED','ORGANIZATIONAL_SCOPE_ARCHIVED','TAXONOMY_RELEASE_CREATED','TAXONOMY_LOCAL_CONCEPT_CREATED','TAXONOMY_LOCAL_CONCEPT_APPROVED','TAXONOMY_RELATION_CREATED','TAXONOMY_MAPPING_CREATED','TAXONOMY_RELEASE_PUBLISHED')),
 ADD CONSTRAINT event_catalog_version_check CHECK(catalog_version IN('f7-events-v1','f12-events-v1','f12-events-v2','f13-p1-events-v1','f13-taxonomy-events-v1'));
