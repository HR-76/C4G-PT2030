GRANT REFERENCES(organization_id,evaluation_id) ON organization_profile.pq1_evaluation TO c4g_opportunity_tenant_owner;
GRANT USAGE ON SCHEMA organization_profile TO c4g_opportunity_tenant_owner,c4g_opportunity_tenant_runtime;
GRANT SELECT(organization_id,evaluation_id,opportunity_id) ON organization_profile.pq1_evaluation TO c4g_opportunity_tenant_runtime;
GRANT EXECUTE ON FUNCTION organization_profile.guard_authoring_immutable() TO c4g_opportunity_tenant_owner;
SET ROLE c4g_opportunity_tenant_owner;
CREATE TABLE opportunity_catalog.application (
 organization_id uuid NOT NULL, application_id uuid NOT NULL, opportunity_id uuid NOT NULL,
 evaluation_id uuid, title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 responsible_membership_id uuid NOT NULL, deadline date NOT NULL, status text NOT NULL DEFAULT 'INTENTION'
   CHECK(status IN ('INTENTION','PREPARATION','CANCELLED','ARCHIVED')),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,application_id), UNIQUE(application_id),
 FOREIGN KEY(organization_id,opportunity_id) REFERENCES opportunity_catalog.opportunity(organization_id,opportunity_id),
 FOREIGN KEY(organization_id,evaluation_id) REFERENCES organization_profile.pq1_evaluation(organization_id,evaluation_id)
);
CREATE INDEX application_opportunity ON opportunity_catalog.application(organization_id,opportunity_id,application_id);
CREATE INDEX application_list ON opportunity_catalog.application(organization_id,application_id);
CREATE TABLE opportunity_catalog.application_change (
 organization_id uuid NOT NULL, application_id uuid NOT NULL, revision bigint NOT NULL CHECK(revision>0),
 kind text NOT NULL CHECK(kind IN ('CREATE','EDIT','TRANSITION')),
 from_status text, to_status text NOT NULL CHECK(to_status IN ('INTENTION','PREPARATION','CANCELLED','ARCHIVED')),
 title text NOT NULL, responsible_membership_id uuid NOT NULL, deadline date NOT NULL, reason text,
 actor_subject_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,application_id,revision),
 FOREIGN KEY(organization_id,application_id) REFERENCES opportunity_catalog.application(organization_id,application_id),
 CHECK((kind='CREATE' AND revision=1 AND from_status IS NULL AND to_status='INTENTION' AND reason IS NULL)
    OR (kind='EDIT' AND revision>1 AND from_status=to_status AND reason IS NULL)
    OR (kind='TRANSITION' AND revision>1 AND from_status IS NOT NULL AND from_status<>to_status
      AND length(btrim(reason)) BETWEEN 1 AND 500))
);
CREATE TABLE opportunity_catalog.application_receipt (
 organization_id uuid NOT NULL, idempotency_key uuid NOT NULL, operation text NOT NULL CHECK(operation IN ('CREATE','EDIT','TRANSITION')),
 subject_id uuid NOT NULL, resource_id uuid NOT NULL, intention_digest char(64) NOT NULL CHECK(intention_digest ~ '^[a-f0-9]{64}$'),
 result_projection jsonb NOT NULL, PRIMARY KEY(organization_id,idempotency_key)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['application','application_change','application_receipt'] LOOP
  EXECUTE format('ALTER TABLE opportunity_catalog.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE opportunity_catalog.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY application_isolation ON opportunity_catalog.%I USING(organization_id=current_setting(''app.organization_id'',true)::uuid) WITH CHECK(organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
  EXECUTE format('CREATE TRIGGER application_no_truncate BEFORE TRUNCATE ON opportunity_catalog.%I FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  EXECUTE format('REVOKE ALL ON opportunity_catalog.%I FROM PUBLIC,c4g_opportunity_tenant_runtime',tab);
  EXECUTE format('GRANT SELECT,INSERT ON opportunity_catalog.%I TO c4g_opportunity_tenant_runtime',tab);
 END LOOP;
END $$;
GRANT UPDATE(title,responsible_membership_id,deadline,status,revision,updated_at) ON opportunity_catalog.application TO c4g_opportunity_tenant_runtime;
CREATE TRIGGER application_no_delete BEFORE DELETE ON opportunity_catalog.application FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER application_change_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.application_change FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER application_receipt_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.application_receipt FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
RESET ROLE;
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK ((%s) OR event_code IN (''APPLICATION_CREATED'',''APPLICATION_CHANGED'',''APPLICATION_STAGE_CHANGED''))',tab,name,substring(definition from 8 for length(definition)-8));
 END LOOP;
END $$;
