DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM opportunity_catalog.application_document_head LIMIT 1)
 OR EXISTS(SELECT 1 FROM opportunity_catalog.application_document_link LIMIT 1)
 OR EXISTS(SELECT 1 FROM opportunity_catalog.application_review_request LIMIT 1)
 OR EXISTS(SELECT 1 FROM opportunity_catalog.application_review_item LIMIT 1)
 OR EXISTS(SELECT 1 FROM opportunity_catalog.application_review_decision LIMIT 1)
 OR EXISTS(SELECT 1 FROM opportunity_catalog.application_document_change LIMIT 1)
 OR EXISTS(SELECT 1 FROM opportunity_catalog.application_document_receipt LIMIT 1)
 THEN RAISE EXCEPTION 'Application document review history is occupied; downgrade refused'; END IF;
END $$;
DROP TABLE opportunity_catalog.application_document_receipt;
DROP TABLE opportunity_catalog.application_document_change;
DROP TABLE opportunity_catalog.application_review_decision;
DROP TABLE opportunity_catalog.application_review_item;
DROP TABLE opportunity_catalog.application_review_request;
DROP TABLE opportunity_catalog.application_document_link;
DROP TABLE opportunity_catalog.application_document_head;
REVOKE SELECT(organization_id,document_id) ON document_storage.document FROM c4g_opportunity_tenant_runtime;
REVOKE SELECT(version_number,display_filename,expected_file_class,created_at) ON document_storage.document_version FROM c4g_opportunity_tenant_runtime;
