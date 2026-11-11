-- Registered as 049_pt2030_document_upload; explicit central package installation only.
-- Does not publish opportunities or change tenant schemas.
CREATE TABLE opportunity_catalog.pt2030_document_upload (
 document_id uuid PRIMARY KEY,
 document_version_id uuid NOT NULL UNIQUE,
 requested_by uuid NOT NULL REFERENCES public.global_user(id),
 request_id uuid NOT NULL,
 filename text NOT NULL CHECK(length(filename) BETWEEN 6 AND 120),
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 4 AND 10485760),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 sheets jsonb NOT NULL CHECK(jsonb_typeof(sheets)='array' AND jsonb_array_length(sheets) BETWEEN 1 AND 100),
 scan_state text NOT NULL DEFAULT 'CLEAN' CHECK(scan_state='CLEAN'),
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(requested_by,request_id)
);
ALTER TABLE opportunity_catalog.pt2030_document_upload OWNER TO c4g_opportunity_central_owner;
CREATE TRIGGER pt2030_document_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.pt2030_document_upload FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER pt2030_document_no_truncate BEFORE TRUNCATE ON opportunity_catalog.pt2030_document_upload FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
REVOKE ALL ON opportunity_catalog.pt2030_document_upload FROM PUBLIC,c4g_catalog_reader;
GRANT SELECT,INSERT ON opportunity_catalog.pt2030_document_upload TO c4g_opportunity_central_runtime;
