-- Snapshot, activation and evaluation persist atomically; publications stay inactive.
GRANT USAGE ON SCHEMA opportunity_catalog TO c4g_organization_profile_owner;
GRANT REFERENCES(organization_id,opportunity_id) ON opportunity_catalog.opportunity TO c4g_organization_profile_owner;
GRANT REFERENCES(organization_id,revision_id) ON opportunity_catalog.revision,opportunity_catalog.criteria_revision TO c4g_organization_profile_owner;
SET ROLE c4g_organization_profile_owner;
CREATE TABLE organization_profile.pq1_effective_release (
 release_code text PRIMARY KEY,definition jsonb NOT NULL,definition_digest char(64) NOT NULL CHECK(definition_digest ~ '^[a-f0-9]{64}$')
);
CREATE TABLE organization_profile.pq1_effective_snapshot (
 organization_id uuid NOT NULL,snapshot_id uuid NOT NULL,version_id uuid NOT NULL,
 snapshot_digest char(64) NOT NULL CHECK(snapshot_digest ~ '^[a-f0-9]{64}$'),content jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),PRIMARY KEY(organization_id,snapshot_id),
 FOREIGN KEY(organization_id,version_id) REFERENCES organization_profile.pq1_publication(organization_id,version_id),
 CHECK((content->>'state'='READY' AND content->>'schema'='F13_ORG_PQ1_EFFECTIVE_V1'
  AND content->>'organizationId'=organization_id::text AND content#>>'{origin,versionId}'=version_id::text) IS TRUE)
);
CREATE TABLE organization_profile.pq1_activation (
 organization_id uuid NOT NULL,activation_id uuid NOT NULL,snapshot_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>0),predecessor_id uuid,actor_subject_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,activation_id),UNIQUE(organization_id,generation),UNIQUE(organization_id,activation_id,generation),
 FOREIGN KEY(organization_id,snapshot_id) REFERENCES organization_profile.pq1_effective_snapshot(organization_id,snapshot_id),
 FOREIGN KEY(organization_id,predecessor_id) REFERENCES organization_profile.pq1_activation(organization_id,activation_id),
 CHECK((generation=1)=(predecessor_id IS NULL))
);
CREATE TABLE organization_profile.profile_active_baseline (
 organization_id uuid PRIMARY KEY,activation_id uuid NOT NULL,generation bigint NOT NULL,
 FOREIGN KEY(organization_id,activation_id,generation) REFERENCES organization_profile.pq1_activation(organization_id,activation_id,generation)
);
CREATE TABLE organization_profile.pq1_evaluation (
 organization_id uuid NOT NULL,evaluation_id uuid NOT NULL,opportunity_id uuid NOT NULL,
 opportunity_revision_id uuid NOT NULL,criteria_revision_id uuid NOT NULL,activation_id uuid NOT NULL,
 result jsonb NOT NULL,result_digest char(64) NOT NULL CHECK(result_digest ~ '^[a-f0-9]{64}$'),
 actor_subject_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),PRIMARY KEY(organization_id,evaluation_id),
 FOREIGN KEY(organization_id,opportunity_id) REFERENCES opportunity_catalog.opportunity(organization_id,opportunity_id),
 FOREIGN KEY(organization_id,opportunity_revision_id) REFERENCES opportunity_catalog.revision(organization_id,revision_id),
 FOREIGN KEY(organization_id,criteria_revision_id) REFERENCES opportunity_catalog.criteria_revision(organization_id,revision_id),
 FOREIGN KEY(organization_id,activation_id) REFERENCES organization_profile.pq1_activation(organization_id,activation_id),
 CHECK((result->>'schema'='F14_PQ1_RESULT_V1' AND result->>'globalResult'='INDETERMINATE'
  AND result->>'organizationId'=organization_id::text AND result#>>'{identity,opportunityId}'=opportunity_id::text
  AND result#>>'{identity,opportunityRevisionId}'=opportunity_revision_id::text
  AND result#>>'{identity,criteriaRevisionId}'=criteria_revision_id::text AND result#>>'{identity,activationId}'=activation_id::text) IS TRUE)
);
CREATE TABLE organization_profile.pq1_effective_receipt (
 organization_id uuid NOT NULL,operation text NOT NULL CHECK(operation IN('PQ1_ACTIVATE','PQ1_EVALUATE')),
 idempotency_key uuid NOT NULL,subject_id uuid NOT NULL,resource_id uuid NOT NULL,
 intention_digest char(64) NOT NULL CHECK(intention_digest ~ '^[a-f0-9]{64}$'),result_projection jsonb NOT NULL,
 PRIMARY KEY(organization_id,operation,idempotency_key)
);
CREATE FUNCTION organization_profile.guard_pq1_baseline() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,organization_profile AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.organization_id<>OLD.organization_id OR NEW.generation<>OLD.generation+1) THEN
  RAISE EXCEPTION 'PQ1_BASELINE_CAS_REQUIRED';
 END IF;
 IF TG_OP='INSERT' AND NEW.generation<>1 THEN RAISE EXCEPTION 'PQ1_BASELINE_CAS_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM organization_profile.pq1_activation a WHERE a.organization_id=NEW.organization_id
  AND a.activation_id=NEW.activation_id AND a.generation=NEW.generation
  AND a.predecessor_id IS NOT DISTINCT FROM CASE WHEN TG_OP='UPDATE' THEN OLD.activation_id ELSE NULL END)
 THEN RAISE EXCEPTION 'PQ1_BASELINE_CHAIN_INVALID'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pq1_baseline_cas BEFORE INSERT OR UPDATE ON organization_profile.profile_active_baseline
 FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_pq1_baseline();
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['pq1_effective_snapshot','pq1_activation','profile_active_baseline','pq1_evaluation','pq1_effective_receipt'] LOOP
  EXECUTE format('ALTER TABLE organization_profile.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE organization_profile.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY pq1_effective_isolation ON organization_profile.%I USING(organization_id=current_setting(''app.organization_id'',true)::uuid) WITH CHECK(organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
  IF tab<>'profile_active_baseline' THEN
   EXECUTE format('CREATE TRIGGER pq1_effective_immutable BEFORE UPDATE OR DELETE ON organization_profile.%I FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  ELSE
   EXECUTE format('CREATE TRIGGER pq1_effective_immutable BEFORE DELETE ON organization_profile.%I FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  END IF;
  EXECUTE format('CREATE TRIGGER pq1_effective_no_truncate BEFORE TRUNCATE ON organization_profile.%I FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  EXECUTE format('REVOKE ALL ON organization_profile.%I FROM PUBLIC,c4g_organization_profile_runtime',tab);
  EXECUTE format('GRANT SELECT,INSERT ON organization_profile.%I TO c4g_organization_profile_runtime',tab);
 END LOOP;
END $$;
GRANT UPDATE(activation_id,generation) ON organization_profile.profile_active_baseline TO c4g_organization_profile_runtime;
REVOKE ALL ON FUNCTION organization_profile.guard_pq1_baseline() FROM PUBLIC;
ALTER TABLE organization_profile.pq1_effective_release ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_profile.pq1_effective_release FORCE ROW LEVEL SECURITY;
CREATE POLICY pq1_effective_release_read ON organization_profile.pq1_effective_release FOR SELECT USING(true);
CREATE POLICY pq1_effective_release_seed ON organization_profile.pq1_effective_release FOR INSERT WITH CHECK(current_user='c4g_organization_profile_owner');
REVOKE ALL ON organization_profile.pq1_effective_release FROM PUBLIC,c4g_organization_profile_runtime;
GRANT SELECT ON organization_profile.pq1_effective_release TO c4g_organization_profile_runtime;
INSERT INTO organization_profile.pq1_effective_release VALUES('F13_F14_PQ1_MANIFEST_V1','{"tuple":{"activationBundle":"F13_PQ1_ACTIVATION_BUNDLE_V1","admissibility":"F14_PQ1_EVIDENCE_ADMISSIBILITY_V1","consumer":"F14_PQ1_CONSUMER_V1","manifest":"F13_F14_PQ1_MANIFEST_V1","materializer":"F13_PQ1_MATERIALIZER_V1","producer":"F13_PQ1_PUBLISH_BUNDLE_V1","producerDigest":"505572648e422e238347fbcfe44b5d9e577479d9cbb554cfec063e380935dd5d","readiness":"F13_PQ1_READINESS_V1","reasons":"F14_PQ1_REASONS_V1","result":"F14_PQ1_RESULT_V1","resultProjection":"F14_PQ1_RESULT_READ_V1","rules":"F14_PQ1_RULES_V1","snapshot":"F13_ORG_PQ1_EFFECTIVE_V1","snapshotProjection":"F13_PQ1_EFFECTIVE_READ_V1"},"limits":{"maxItems":100,"maxCollection":100,"maxBytes":1048576,"maxCanonicalBytes":262144,"maxRows":10000,"maxPageSize":100,"timeoutMs":10000}}'::jsonb,'3d331c1db2303d33216aa23dca598f5b83f3825c81d66756be6b5cfd5ebc7ca8');
DROP POLICY pq1_effective_release_seed ON organization_profile.pq1_effective_release;
CREATE TRIGGER pq1_effective_release_immutable BEFORE UPDATE OR DELETE ON organization_profile.pq1_effective_release
 FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER pq1_effective_release_no_truncate BEFORE TRUNCATE ON organization_profile.pq1_effective_release
 FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
RESET ROLE;
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK ((%s) OR event_code IN (''PROFILE_COHORT_ACTIVATED'',''PREQUALIFICATION_EVALUATED'',''PREQUALIFICATION_ACCESSED''))',tab,name,substring(definition from 8 for length(definition)-8));
 END LOOP;
END $$;
