-- Private editorial interpretations; immutable revisions and confirmations.
SET ROLE c4g_opportunity_tenant_owner;
CREATE TABLE opportunity_catalog.criteria_set (
 organization_id uuid NOT NULL, set_id uuid NOT NULL, opportunity_id uuid NOT NULL,
 authority text NOT NULL DEFAULT 'ORGANIZATION' CHECK(authority='ORGANIZATION'),
 head_revision bigint NOT NULL CHECK(head_revision>0), head_revision_id uuid NOT NULL,
 PRIMARY KEY(organization_id,set_id), UNIQUE(organization_id,opportunity_id),
 FOREIGN KEY(organization_id,opportunity_id) REFERENCES opportunity_catalog.opportunity(organization_id,opportunity_id)
);
CREATE TABLE opportunity_catalog.criteria_revision (
 organization_id uuid NOT NULL,set_id uuid NOT NULL,revision_id uuid NOT NULL,revision_number bigint NOT NULL CHECK(revision_number>0),
 parent_revision_id uuid, opportunity_revision_id uuid NOT NULL, opportunity_digest text NOT NULL CHECK(opportunity_digest~'^[a-f0-9]{64}$'),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),content_digest text NOT NULL CHECK(content_digest~'^[a-f0-9]{64}$'),
 author_subject_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,revision_id),UNIQUE(organization_id,set_id,revision_number),UNIQUE(organization_id,set_id,revision_id),
 FOREIGN KEY(organization_id,set_id) REFERENCES opportunity_catalog.criteria_set(organization_id,set_id),
 FOREIGN KEY(organization_id,opportunity_revision_id) REFERENCES opportunity_catalog.revision(organization_id,revision_id),
 FOREIGN KEY(organization_id,set_id,parent_revision_id) REFERENCES opportunity_catalog.criteria_revision(organization_id,set_id,revision_id)
);
ALTER TABLE opportunity_catalog.criteria_set ADD FOREIGN KEY(organization_id,set_id,head_revision_id) REFERENCES opportunity_catalog.criteria_revision(organization_id,set_id,revision_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE opportunity_catalog.criteria_confirmation (
 organization_id uuid NOT NULL,revision_id uuid NOT NULL,confirmed_by uuid NOT NULL,confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),contract_version text NOT NULL CHECK(contract_version='criteria-v1'),
 PRIMARY KEY(organization_id,revision_id),FOREIGN KEY(organization_id,revision_id) REFERENCES opportunity_catalog.criteria_revision(organization_id,revision_id)
);
CREATE TABLE opportunity_catalog.criteria_receipt (
 organization_id uuid NOT NULL,subject_id uuid NOT NULL,operation text NOT NULL CHECK(operation IN('CRITERIA_SAVE','CRITERIA_CONFIRM')),request_id uuid NOT NULL,resource_id uuid NOT NULL,
 intention_digest text NOT NULL CHECK(intention_digest~'^[a-f0-9]{64}$'),result_projection jsonb NOT NULL,
 PRIMARY KEY(organization_id,operation,request_id)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['criteria_set','criteria_revision','criteria_confirmation','criteria_receipt'] LOOP
 EXECUTE format('ALTER TABLE opportunity_catalog.%I OWNER TO c4g_opportunity_tenant_owner',tab);
 EXECUTE format('ALTER TABLE opportunity_catalog.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE opportunity_catalog.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY criteria_isolation ON opportunity_catalog.%I USING(organization_id=current_setting(''app.organization_id'',true)::uuid) WITH CHECK(organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
 EXECUTE format('REVOKE ALL ON opportunity_catalog.%I FROM PUBLIC,c4g_tenant_runtime',tab);
 EXECUTE format('GRANT SELECT,INSERT ON opportunity_catalog.%I TO c4g_opportunity_tenant_runtime',tab);
 IF tab<>'criteria_set' THEN EXECUTE format('CREATE TRIGGER criteria_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.%I FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation()',tab); END IF;
 END LOOP;
END $$;
GRANT UPDATE(head_revision,head_revision_id) ON opportunity_catalog.criteria_set TO c4g_opportunity_tenant_runtime;

RESET ROLE;
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
 name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
 SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
 definition:=regexp_replace(definition,'^CHECK \((.*)\)$','CHECK (\1 OR event_code IN (''OPPORTUNITY_CRITERIA_ACCESSED'',''OPPORTUNITY_CRITERIA_REVISION_CREATED'',''OPPORTUNITY_CRITERIA_REVISION_CONFIRMED''))');
 EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
 EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I %s',tab,name,definition);
 END LOOP;
END $$;
