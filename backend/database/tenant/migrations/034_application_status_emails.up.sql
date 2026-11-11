SET ROLE c4g_opportunity_tenant_owner;
CREATE TABLE opportunity_catalog.application_status_event (
 organization_id uuid NOT NULL, event_id uuid NOT NULL, application_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>0), snapshot jsonb NOT NULL,
 PRIMARY KEY(organization_id,event_id), UNIQUE(organization_id,application_id,revision),
 FOREIGN KEY(organization_id,application_id,revision) REFERENCES opportunity_catalog.application_change(organization_id,application_id,revision),
 CHECK(jsonb_typeof(snapshot)='object'),
 CHECK(snapshot ?& ARRAY['organizationId','applicationId']),
 CHECK(snapshot->>'organizationId'=organization_id::text AND snapshot->>'applicationId'=application_id::text)
);
CREATE TABLE opportunity_catalog.application_status_delivery (
 organization_id uuid NOT NULL, delivery_id uuid NOT NULL, event_id uuid NOT NULL, membership_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RESERVED','ACCEPTED','UNKNOWN','SKIPPED','FAILED')),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,delivery_id), UNIQUE(organization_id,event_id,membership_id),
 FOREIGN KEY(organization_id,event_id) REFERENCES opportunity_catalog.application_status_event(organization_id,event_id)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['application_status_event','application_status_delivery'] LOOP
  EXECUTE format('ALTER TABLE opportunity_catalog.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE opportunity_catalog.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY status_email_isolation ON opportunity_catalog.%I USING(organization_id=current_setting(''app.organization_id'',true)::uuid) WITH CHECK(organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
  EXECUTE format('REVOKE ALL ON opportunity_catalog.%I FROM PUBLIC,c4g_opportunity_tenant_runtime',tab);
  EXECUTE format('GRANT SELECT,INSERT ON opportunity_catalog.%I TO c4g_opportunity_tenant_runtime',tab);
  EXECUTE format('CREATE TRIGGER status_email_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON opportunity_catalog.%I FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
 END LOOP;
END $$;
RESET ROLE;
