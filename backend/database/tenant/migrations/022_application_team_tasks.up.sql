SET ROLE c4g_opportunity_tenant_owner;
CREATE TABLE opportunity_catalog.application_work (
 organization_id uuid NOT NULL, application_id uuid NOT NULL, revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 PRIMARY KEY(organization_id,application_id),
 FOREIGN KEY(organization_id,application_id) REFERENCES opportunity_catalog.application(organization_id,application_id)
);
CREATE TABLE opportunity_catalog.application_participant (
 organization_id uuid NOT NULL, application_id uuid NOT NULL, membership_id uuid NOT NULL,
 active boolean NOT NULL DEFAULT true, added_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,application_id,membership_id),
 FOREIGN KEY(organization_id,application_id) REFERENCES opportunity_catalog.application(organization_id,application_id)
);
CREATE TABLE opportunity_catalog.application_task (
 organization_id uuid NOT NULL, application_id uuid NOT NULL, task_id uuid NOT NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200), responsible_membership_id uuid NOT NULL,
 deadline date NOT NULL, status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','COMPLETED','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,application_id,task_id), UNIQUE(task_id),
 FOREIGN KEY(organization_id,application_id) REFERENCES opportunity_catalog.application(organization_id,application_id)
);
CREATE TABLE opportunity_catalog.application_work_change (
 organization_id uuid NOT NULL, application_id uuid NOT NULL, revision bigint NOT NULL CHECK(revision>1),
 kind text NOT NULL CHECK(kind IN ('PARTICIPANT_ADDED','PARTICIPANT_REMOVED','TASK_CREATED','TASK_EDITED','TASK_COMPLETED','TASK_CANCELLED')),
 membership_id uuid, task_id uuid, title text, responsible_membership_id uuid, deadline date,
 status text CHECK(status IN ('OPEN','COMPLETED','CANCELLED')),
 actor_subject_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,application_id,revision),
 FOREIGN KEY(organization_id,application_id) REFERENCES opportunity_catalog.application(organization_id,application_id),
 CHECK ((kind LIKE 'PARTICIPANT_%' AND membership_id IS NOT NULL AND task_id IS NULL)
   OR (kind LIKE 'TASK_%' AND task_id IS NOT NULL AND title IS NOT NULL AND responsible_membership_id IS NOT NULL AND deadline IS NOT NULL AND status IS NOT NULL))
);
CREATE TABLE opportunity_catalog.application_work_receipt (
 organization_id uuid NOT NULL, idempotency_key uuid NOT NULL, operation text NOT NULL CHECK(operation='WORK'),
 subject_id uuid NOT NULL, resource_id uuid NOT NULL, intention_digest char(64) NOT NULL CHECK(intention_digest ~ '^[a-f0-9]{64}$'),
 result_projection jsonb NOT NULL, PRIMARY KEY(organization_id,idempotency_key)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['application_work','application_participant','application_task','application_work_change','application_work_receipt'] LOOP
  EXECUTE format('ALTER TABLE opportunity_catalog.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE opportunity_catalog.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY application_work_isolation ON opportunity_catalog.%I USING(organization_id=current_setting(''app.organization_id'',true)::uuid) WITH CHECK(organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
  EXECUTE format('CREATE TRIGGER application_work_no_truncate BEFORE TRUNCATE ON opportunity_catalog.%I FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  EXECUTE format('REVOKE ALL ON opportunity_catalog.%I FROM PUBLIC,c4g_opportunity_tenant_runtime',tab);
  EXECUTE format('GRANT SELECT,INSERT ON opportunity_catalog.%I TO c4g_opportunity_tenant_runtime',tab);
 END LOOP;
END $$;
GRANT UPDATE(revision) ON opportunity_catalog.application_work TO c4g_opportunity_tenant_runtime;
GRANT UPDATE(active,updated_at) ON opportunity_catalog.application_participant TO c4g_opportunity_tenant_runtime;
GRANT UPDATE(title,responsible_membership_id,deadline,status,updated_at) ON opportunity_catalog.application_task TO c4g_opportunity_tenant_runtime;
CREATE TRIGGER application_work_no_delete BEFORE DELETE ON opportunity_catalog.application_work FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER application_participant_no_delete BEFORE DELETE ON opportunity_catalog.application_participant FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER application_task_no_delete BEFORE DELETE ON opportunity_catalog.application_task FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER application_work_change_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.application_work_change FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER application_work_receipt_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.application_work_receipt FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
RESET ROLE;
