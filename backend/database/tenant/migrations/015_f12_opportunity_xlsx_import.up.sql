SET ROLE c4g_document_owner;
ALTER TABLE document_storage.document_version DROP CONSTRAINT document_version_expected_file_class_check;
ALTER TABLE document_storage.document_version ADD CONSTRAINT document_version_expected_file_class_check CHECK(expected_file_class IN ('PDF','IMAGE','OOXML','CSV'));
RESET ROLE;
SET ROLE c4g_opportunity_tenant_owner;
CREATE TABLE opportunity_catalog.import_job (
 organization_id uuid NOT NULL,
 import_id uuid NOT NULL,
 original_document_id uuid NOT NULL,
 original_document_version_id uuid NOT NULL,
 report_document_id uuid,
 report_document_version_id uuid,
 file_digest char(64) NOT NULL CHECK(file_digest ~ '^[a-f0-9]{64}$'),
 mapping_digest char(64) CHECK(mapping_digest ~ '^[a-f0-9]{64}$'),
 mapping jsonb CHECK(jsonb_typeof(mapping)='object' AND octet_length(mapping::text)<=16384),
 sheet_name text CHECK(length(sheet_name) BETWEEN 1 AND 128),
 state text NOT NULL CHECK(state IN ('UPLOADED','READY_FOR_CONFIRMATION','QUEUED','RUNNING','CANCELLATION_REQUESTED','CANCELLED','COMPLETED','COMPLETED_WITH_ISSUES','FAILED','RECONCILIATION_REQUIRED','ARCHIVED')),
 request_id uuid NOT NULL,
 request_digest char(64) NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 total_rows integer NOT NULL DEFAULT 0 CHECK(total_rows BETWEEN 0 AND 5000),
 valid_rows integer NOT NULL DEFAULT 0 CHECK(valid_rows BETWEEN 0 AND 5000),
 error_rows integer NOT NULL DEFAULT 0 CHECK(error_rows BETWEEN 0 AND 5000),
 processed_rows integer NOT NULL DEFAULT 0 CHECK(processed_rows BETWEEN 0 AND 5000),
 created_rows integer NOT NULL DEFAULT 0 CHECK(created_rows BETWEEN 0 AND 5000),
 exact_rows integer NOT NULL DEFAULT 0 CHECK(exact_rows BETWEEN 0 AND 5000),
 possible_rows integer NOT NULL DEFAULT 0 CHECK(possible_rows BETWEEN 0 AND 5000),
 rejected_rows integer NOT NULL DEFAULT 0 CHECK(rejected_rows BETWEEN 0 AND 5000),
 conflict_rows integer NOT NULL DEFAULT 0 CHECK(conflict_rows BETWEEN 0 AND 5000),
 created_by_actor_type text NOT NULL CHECK(created_by_actor_type IN ('HUMAN','SERVICE')),
 created_by_actor_reference text NOT NULL CHECK(length(created_by_actor_reference) BETWEEN 1 AND 128),
 correlation_id uuid NOT NULL,
 causation_id uuid,
 row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0),
 cancel_requested_at timestamptz,
 started_at timestamptz,
 finished_at timestamptz,
 archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,import_id),
 UNIQUE(import_id),
 UNIQUE(organization_id,request_id),
 UNIQUE(organization_id,file_digest),
 CHECK((report_document_id IS NULL)=(report_document_version_id IS NULL)),
 CHECK((mapping_digest IS NULL AND mapping IS NULL AND sheet_name IS NULL AND state IN ('UPLOADED','CANCELLED','ARCHIVED')) OR
       (mapping_digest IS NOT NULL AND mapping IS NOT NULL AND sheet_name IS NOT NULL AND state<>'UPLOADED')),
 CHECK(total_rows=valid_rows+error_rows),
 FOREIGN KEY(organization_id,original_document_id,original_document_version_id) REFERENCES document_storage.document_version(organization_id,document_id,version_id),
 FOREIGN KEY(organization_id,report_document_id,report_document_version_id) REFERENCES document_storage.document_version(organization_id,document_id,version_id)
);
CREATE UNIQUE INDEX opportunity_import_one_active_per_org ON opportunity_catalog.import_job(organization_id)
 WHERE state IN ('QUEUED','RUNNING','CANCELLATION_REQUESTED');
CREATE INDEX opportunity_import_recent ON opportunity_catalog.import_job(organization_id,created_at DESC,import_id DESC);

CREATE TABLE opportunity_catalog.import_row_outcome (
 organization_id uuid NOT NULL,
 import_id uuid NOT NULL,
 line_number integer NOT NULL CHECK(line_number>0 AND line_number<=5002),
 row_digest char(64) NOT NULL CHECK(row_digest ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('INVALID','EXACT','POSSIBLE','CREATED','REJECTED','CONFLICT','CANCELLED','UNCERTAIN')),
 result_code text NOT NULL CHECK(result_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 conflict_opportunity_id uuid,
 conflict_revision_id uuid,
 result_opportunity_id uuid,
 result_revision_id uuid,
 decision text CHECK(decision IN ('CREATE','REJECT')),
 reviewed_by_actor_reference text CHECK(length(reviewed_by_actor_reference) BETWEEN 1 AND 128),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,import_id,line_number),
 FOREIGN KEY(organization_id,import_id) REFERENCES opportunity_catalog.import_job(organization_id,import_id),
 FOREIGN KEY(organization_id,result_opportunity_id) REFERENCES opportunity_catalog.opportunity(organization_id,opportunity_id),
 CHECK((result_opportunity_id IS NULL)=(result_revision_id IS NULL)),
 CHECK((decision IS NULL AND reviewed_by_actor_reference IS NULL AND reviewed_at IS NULL) OR (decision IS NOT NULL AND reviewed_by_actor_reference IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX opportunity_import_possible ON opportunity_catalog.import_row_outcome(organization_id,import_id,line_number) WHERE state='POSSIBLE';
ALTER TABLE opportunity_catalog.import_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_catalog.import_row_outcome ENABLE ROW LEVEL SECURITY;
CREATE POLICY opportunity_import_job_isolation ON opportunity_catalog.import_job USING(organization_id=current_setting('app.organization_id',true)::uuid) WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid);
CREATE POLICY opportunity_import_row_isolation ON opportunity_catalog.import_row_outcome USING(organization_id=current_setting('app.organization_id',true)::uuid) WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid);
GRANT SELECT,INSERT ON opportunity_catalog.import_job,opportunity_catalog.import_row_outcome TO c4g_opportunity_tenant_runtime;
GRANT UPDATE(mapping_digest,mapping,sheet_name,state,total_rows,valid_rows,error_rows,report_document_id,report_document_version_id,processed_rows,created_rows,exact_rows,possible_rows,rejected_rows,conflict_rows,row_version,cancel_requested_at,started_at,finished_at,archived_at,updated_at) ON opportunity_catalog.import_job TO c4g_opportunity_tenant_runtime;
GRANT UPDATE(state,result_code,conflict_opportunity_id,conflict_revision_id,result_opportunity_id,result_revision_id,decision,reviewed_by_actor_reference,reviewed_at,updated_at) ON opportunity_catalog.import_row_outcome TO c4g_opportunity_tenant_runtime;
REVOKE DELETE,TRUNCATE ON opportunity_catalog.import_job,opportunity_catalog.import_row_outcome FROM c4g_opportunity_tenant_runtime;

RESET ROLE;
GRANT USAGE ON SCHEMA opportunity_catalog,async_exec,audit TO c4g_import_worker_runtime;
GRANT SELECT,INSERT ON opportunity_catalog.opportunity,opportunity_catalog.revision,
 opportunity_catalog.provenance,opportunity_catalog.idempotency_record TO c4g_import_worker_runtime;
GRANT SELECT,INSERT ON opportunity_catalog.import_job,opportunity_catalog.import_row_outcome TO c4g_import_worker_runtime;
GRANT UPDATE(mapping_digest,mapping,sheet_name,state,total_rows,valid_rows,error_rows,report_document_id,report_document_version_id,processed_rows,created_rows,exact_rows,possible_rows,rejected_rows,conflict_rows,row_version,cancel_requested_at,started_at,finished_at,archived_at,updated_at) ON opportunity_catalog.import_job TO c4g_import_worker_runtime;
GRANT UPDATE(state,result_code,conflict_opportunity_id,conflict_revision_id,result_opportunity_id,result_revision_id,decision,reviewed_by_actor_reference,reviewed_at,updated_at) ON opportunity_catalog.import_row_outcome TO c4g_import_worker_runtime;
GRANT SELECT ON async_exec.outbox TO c4g_import_worker_runtime;
GRANT SELECT,INSERT ON async_exec.inbox TO c4g_import_worker_runtime;
GRANT UPDATE(state,queue_id,available_at,claim_owner,lease_until,fence,updated_at,published_at) ON async_exec.outbox TO c4g_import_worker_runtime;
GRANT UPDATE(state,claim_owner,lease_until,fence,result_code,execution_id,completed_at) ON async_exec.inbox TO c4g_import_worker_runtime;
GRANT EXECUTE ON FUNCTION audit.prepare_append_v1(uuid,text) TO c4g_import_worker_runtime;
GRANT EXECUTE ON FUNCTION audit.append_event_v1(uuid,text,text,integer,text,text,audit.ledger_location,uuid,uuid,audit.actor_type,text,text,text,bigint,timestamptz,timestamptz,uuid,uuid,text,text,text,text,jsonb) TO c4g_import_worker_runtime;
REVOKE DELETE,TRUNCATE ON ALL TABLES IN SCHEMA opportunity_catalog,async_exec FROM c4g_import_worker_runtime;
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK ((%s) OR event_code IN (''OPPORTUNITY_IMPORT_UPLOADED'',''OPPORTUNITY_IMPORT_CONFIRMED'',''OPPORTUNITY_IMPORT_CANCELLED'',''OPPORTUNITY_IMPORT_POSSIBLE_REVIEWED'',''OPPORTUNITY_IMPORT_COMPLETED'',''OPPORTUNITY_IMPORT_FAILED''))',tab,name,substring(definition from 8 for length(definition)-8));
 END LOOP;
 SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid='audit.event'::regclass AND conname='event_catalog_version_check';
 ALTER TABLE audit.event DROP CONSTRAINT event_catalog_version_check;
 EXECUTE 'ALTER TABLE audit.event ADD CONSTRAINT event_catalog_version_check CHECK (('||substring(definition from 8 for length(definition)-8)||') OR catalog_version=''f12-import-events-v3'')';
END $$;
