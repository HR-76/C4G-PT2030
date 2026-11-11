SET ROLE c4g_opportunity_tenant_owner;
LOCK TABLE opportunity_catalog.import_job,opportunity_catalog.import_row_outcome IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM opportunity_catalog.import_job) OR EXISTS(SELECT 1 FROM opportunity_catalog.import_row_outcome) THEN
  RAISE EXCEPTION 'F12_IMPORT_015_DOWN_REFUSES_DATA_LOSS';
 END IF;
END $$;
REVOKE SELECT,INSERT ON opportunity_catalog.import_job,opportunity_catalog.import_row_outcome FROM c4g_import_worker_runtime;
REVOKE UPDATE(mapping_digest,mapping,sheet_name,state,total_rows,valid_rows,error_rows,report_document_id,report_document_version_id,processed_rows,created_rows,exact_rows,possible_rows,rejected_rows,conflict_rows,row_version,cancel_requested_at,started_at,finished_at,archived_at,updated_at) ON opportunity_catalog.import_job FROM c4g_import_worker_runtime;
REVOKE UPDATE(state,result_code,conflict_opportunity_id,conflict_revision_id,result_opportunity_id,result_revision_id,decision,reviewed_by_actor_reference,reviewed_at,updated_at) ON opportunity_catalog.import_row_outcome FROM c4g_import_worker_runtime;
DROP TABLE opportunity_catalog.import_row_outcome,opportunity_catalog.import_job;
RESET ROLE;
SET ROLE c4g_document_owner;
ALTER TABLE document_storage.document_version DROP CONSTRAINT document_version_expected_file_class_check;
ALTER TABLE document_storage.document_version ADD CONSTRAINT document_version_expected_file_class_check CHECK(expected_file_class IN ('PDF','IMAGE','OOXML'));
RESET ROLE;
DO $$ DECLARE tab text; name text; definition text; BEGIN
 FOREACH tab IN ARRAY ARRAY['event','event_identity'] LOOP
  name:=CASE WHEN tab='event' THEN 'event_event_code_check' ELSE 'event_identity_event_code_check' END;
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid=('audit.'||tab)::regclass AND conname=name;
  definition:=regexp_replace(definition,' OR \(event_code = ANY \(ARRAY\[''OPPORTUNITY_IMPORT_UPLOADED''::text, ''OPPORTUNITY_IMPORT_CONFIRMED''::text, ''OPPORTUNITY_IMPORT_CANCELLED''::text, ''OPPORTUNITY_IMPORT_POSSIBLE_REVIEWED''::text, ''OPPORTUNITY_IMPORT_COMPLETED''::text, ''OPPORTUNITY_IMPORT_FAILED''::text\]\)\)','');
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',tab,name);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I %s',tab,name,definition);
 END LOOP;
 SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint WHERE conrelid='audit.event'::regclass AND conname='event_catalog_version_check';
 definition:=replace(definition,' OR (catalog_version = ''f12-import-events-v3''::text)','');
 ALTER TABLE audit.event DROP CONSTRAINT event_catalog_version_check;
 EXECUTE 'ALTER TABLE audit.event ADD CONSTRAINT event_catalog_version_check '||definition;
END $$;
REVOKE SELECT,INSERT ON opportunity_catalog.opportunity,opportunity_catalog.revision,
 opportunity_catalog.provenance,opportunity_catalog.idempotency_record FROM c4g_import_worker_runtime;
REVOKE SELECT ON async_exec.outbox FROM c4g_import_worker_runtime;
REVOKE SELECT,INSERT ON async_exec.inbox FROM c4g_import_worker_runtime;
REVOKE UPDATE(state,queue_id,available_at,claim_owner,lease_until,fence,updated_at,published_at) ON async_exec.outbox FROM c4g_import_worker_runtime;
REVOKE UPDATE(state,claim_owner,lease_until,fence,result_code,execution_id,completed_at) ON async_exec.inbox FROM c4g_import_worker_runtime;
REVOKE EXECUTE ON FUNCTION audit.prepare_append_v1(uuid,text) FROM c4g_import_worker_runtime;
REVOKE EXECUTE ON FUNCTION audit.append_event_v1(uuid,text,text,integer,text,text,audit.ledger_location,uuid,uuid,audit.actor_type,text,text,text,bigint,timestamptz,timestamptz,uuid,uuid,text,text,text,text,jsonb) FROM c4g_import_worker_runtime;
REVOKE USAGE ON SCHEMA opportunity_catalog,async_exec,audit FROM c4g_import_worker_runtime;
