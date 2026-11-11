GRANT SELECT(organization_id,document_id) ON document_storage.document TO c4g_opportunity_tenant_runtime;
GRANT SELECT(version_number,display_filename,expected_file_class,created_at) ON document_storage.document_version TO c4g_opportunity_tenant_runtime;
SET ROLE c4g_opportunity_tenant_owner;
CREATE TABLE opportunity_catalog.application_document_head (
 organization_id uuid NOT NULL, application_id uuid NOT NULL, revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 PRIMARY KEY(organization_id,application_id),
 FOREIGN KEY(organization_id,application_id) REFERENCES opportunity_catalog.application(organization_id,application_id)
);
CREATE TABLE opportunity_catalog.application_document_link (
 organization_id uuid NOT NULL, application_id uuid NOT NULL, document_id uuid NOT NULL, version_id uuid NOT NULL,
 active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,application_id,document_id),
 FOREIGN KEY(organization_id,application_id) REFERENCES opportunity_catalog.application(organization_id,application_id)
);
CREATE TABLE opportunity_catalog.application_review_request (
 organization_id uuid NOT NULL, application_id uuid NOT NULL, request_id uuid NOT NULL,
 document_revision bigint NOT NULL, snapshot_digest char(64) NOT NULL CHECK(snapshot_digest ~ '^[a-f0-9]{64}$'),
 requested_by_subject_id uuid NOT NULL, requested_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,application_id,request_id), UNIQUE(request_id),
 FOREIGN KEY(organization_id,application_id) REFERENCES opportunity_catalog.application(organization_id,application_id)
);
CREATE TABLE opportunity_catalog.application_review_item (
 organization_id uuid NOT NULL, application_id uuid NOT NULL, request_id uuid NOT NULL,
 document_id uuid NOT NULL, version_id uuid NOT NULL,
 PRIMARY KEY(organization_id,application_id,request_id,document_id),
 FOREIGN KEY(organization_id,application_id,request_id) REFERENCES opportunity_catalog.application_review_request(organization_id,application_id,request_id)
);
CREATE TABLE opportunity_catalog.application_review_decision (
 organization_id uuid NOT NULL, application_id uuid NOT NULL, request_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('APPROVED','CHANGES_REQUESTED')),
 comment text NOT NULL CHECK(length(btrim(comment)) BETWEEN 1 AND 2000),
 decided_by_subject_id uuid NOT NULL, decided_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,application_id,request_id),
 FOREIGN KEY(organization_id,application_id,request_id) REFERENCES opportunity_catalog.application_review_request(organization_id,application_id,request_id)
);
CREATE TABLE opportunity_catalog.application_document_change (
 organization_id uuid NOT NULL, application_id uuid NOT NULL, revision bigint NOT NULL CHECK(revision>1),
 kind text NOT NULL CHECK(kind IN ('DOCUMENT_LINKED','DOCUMENT_REMOVED','REVIEW_REQUESTED','REVIEW_DECIDED')),
 document_id uuid, version_id uuid, request_id uuid, decision text CHECK(decision IN ('APPROVED','CHANGES_REQUESTED')),
 comment text, actor_subject_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,application_id,revision),
 FOREIGN KEY(organization_id,application_id) REFERENCES opportunity_catalog.application(organization_id,application_id)
);
CREATE TABLE opportunity_catalog.application_document_receipt (
 organization_id uuid NOT NULL, idempotency_key uuid NOT NULL, operation text NOT NULL CHECK(operation='DOCUMENT_REVIEW'),
 subject_id uuid NOT NULL, resource_id uuid NOT NULL, intention_digest char(64) NOT NULL CHECK(intention_digest ~ '^[a-f0-9]{64}$'),
 result_projection jsonb NOT NULL, PRIMARY KEY(organization_id,idempotency_key)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['application_document_head','application_document_link','application_review_request','application_review_item','application_review_decision','application_document_change','application_document_receipt'] LOOP
  EXECUTE format('ALTER TABLE opportunity_catalog.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE opportunity_catalog.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY application_document_isolation ON opportunity_catalog.%I USING(organization_id=current_setting(''app.organization_id'',true)::uuid) WITH CHECK(organization_id=current_setting(''app.organization_id'',true)::uuid)',tab);
  EXECUTE format('CREATE TRIGGER application_document_no_truncate BEFORE TRUNCATE ON opportunity_catalog.%I FOR EACH STATEMENT EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
  EXECUTE format('REVOKE ALL ON opportunity_catalog.%I FROM PUBLIC,c4g_opportunity_tenant_runtime',tab);
  EXECUTE format('GRANT SELECT,INSERT ON opportunity_catalog.%I TO c4g_opportunity_tenant_runtime',tab);
 END LOOP;
END $$;
GRANT UPDATE(revision) ON opportunity_catalog.application_document_head TO c4g_opportunity_tenant_runtime;
GRANT UPDATE(version_id,active,updated_at) ON opportunity_catalog.application_document_link TO c4g_opportunity_tenant_runtime;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['application_document_head','application_document_link','application_review_request','application_review_item','application_review_decision','application_document_change','application_document_receipt'] LOOP
  EXECUTE format('CREATE TRIGGER application_document_no_delete BEFORE DELETE ON opportunity_catalog.%I FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable()',tab);
 END LOOP;
END $$;
CREATE TRIGGER application_review_request_immutable BEFORE UPDATE ON opportunity_catalog.application_review_request FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER application_review_item_immutable BEFORE UPDATE ON opportunity_catalog.application_review_item FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER application_review_decision_immutable BEFORE UPDATE ON opportunity_catalog.application_review_decision FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER application_document_change_immutable BEFORE UPDATE ON opportunity_catalog.application_document_change FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
CREATE TRIGGER application_document_receipt_immutable BEFORE UPDATE ON opportunity_catalog.application_document_receipt FOR EACH ROW EXECUTE FUNCTION organization_profile.guard_authoring_immutable();
RESET ROLE;
