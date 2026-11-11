SET ROLE c4g_opportunity_tenant_owner;
CREATE TABLE opportunity_catalog.application_partners (
 organization_id uuid NOT NULL, application_id uuid NOT NULL, revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 PRIMARY KEY(organization_id,application_id),
 FOREIGN KEY(organization_id,application_id) REFERENCES opportunity_catalog.application(organization_id,application_id)
);
CREATE TABLE opportunity_catalog.application_partner (
 organization_id uuid NOT NULL, application_id uuid NOT NULL, partner_id uuid NOT NULL,
 active boolean NOT NULL DEFAULT true, body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,application_id,partner_id), UNIQUE(partner_id),
 FOREIGN KEY(organization_id,application_id) REFERENCES opportunity_catalog.application(organization_id,application_id)
);
CREATE TABLE opportunity_catalog.application_partner_change (
 organization_id uuid NOT NULL, application_id uuid NOT NULL, revision bigint NOT NULL CHECK(revision>1),
 kind text NOT NULL CHECK(kind IN ('PARTNER_CREATED','PARTNER_EDITED','PARTNER_REMOVED')),
 partner_id uuid NOT NULL, snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 actor_subject_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,application_id,revision),
 FOREIGN KEY(organization_id,application_id,partner_id) REFERENCES opportunity_catalog.application_partner(organization_id,application_id,partner_id)
);
CREATE TABLE opportunity_catalog.application_partner_receipt (
 organization_id uuid NOT NULL, idempotency_key uuid NOT NULL, subject_id uuid NOT NULL, resource_id uuid NOT NULL,
 intention_digest char(64) NOT NULL CHECK(intention_digest ~ '^[a-f0-9]{64}$'), result_projection jsonb NOT NULL,
 PRIMARY KEY(organization_id,idempotency_key)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['application_partners','application_partner','application_partner_change','application_partner_receipt'] LOOP
  EXECUTE format('ALTER TABLE opportunity_catalog.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE opportunity_catalog.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY application_partner_isolation ON opportunity_catalog.%I USING(organization_id=current_setting(''app.organization_id'',true)::uuid) WITH CHECK(organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
  EXECUTE format('CREATE TRIGGER application_partner_no_truncate BEFORE TRUNCATE ON opportunity_catalog.%I FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  EXECUTE format('CREATE TRIGGER application_partner_no_delete BEFORE DELETE ON opportunity_catalog.%I FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  EXECUTE format('REVOKE ALL ON opportunity_catalog.%I FROM PUBLIC,c4g_opportunity_tenant_runtime',tab);
  EXECUTE format('GRANT SELECT,INSERT ON opportunity_catalog.%I TO c4g_opportunity_tenant_runtime',tab);
 END LOOP;
END $$;
GRANT UPDATE(revision) ON opportunity_catalog.application_partners TO c4g_opportunity_tenant_runtime;
GRANT UPDATE(active,body,updated_at) ON opportunity_catalog.application_partner TO c4g_opportunity_tenant_runtime;
CREATE TRIGGER application_partner_change_immutable BEFORE UPDATE ON opportunity_catalog.application_partner_change FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER application_partner_receipt_immutable BEFORE UPDATE ON opportunity_catalog.application_partner_receipt FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
RESET ROLE;
