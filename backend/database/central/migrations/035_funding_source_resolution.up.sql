-- Specific human decisions, never a global precedence rule for provider feeds.
CREATE TABLE opportunity_catalog.funding_resolution (
 resolution_id uuid PRIMARY KEY,
 request_id uuid NOT NULL,
 batch_digest text NOT NULL CHECK(batch_digest ~ '^[a-f0-9]{64}$'),
 command_digest text NOT NULL CHECK(command_digest ~ '^[a-f0-9]{64}$'),
 decision_digest text NOT NULL CHECK(decision_digest ~ '^[a-f0-9]{64}$'),
 external_identifier text NOT NULL REFERENCES opportunity_catalog.funding_identity(external_identifier),
 opportunity_id uuid NOT NULL REFERENCES opportunity_catalog.opportunity(opportunity_id),
 previous_revision_id uuid NOT NULL REFERENCES opportunity_catalog.revision(revision_id),
 applied_revision_id uuid NOT NULL UNIQUE REFERENCES opportunity_catalog.revision(revision_id),
 source_fingerprint text NOT NULL CHECK(source_fingerprint ~ '^[a-f0-9]{64}$'),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=2097152),
 decision jsonb NOT NULL CHECK(jsonb_typeof(decision)='object' AND octet_length(decision::text)<=16384),
 decided_by uuid NOT NULL REFERENCES public.global_user(id),
 decided_at timestamptz NOT NULL,
 UNIQUE(request_id,external_identifier),
 CHECK(previous_revision_id<>applied_revision_id)
);
ALTER TABLE opportunity_catalog.funding_resolution OWNER TO c4g_opportunity_central_owner;
CREATE TRIGGER funding_resolution_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.funding_resolution
 FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER funding_resolution_no_truncate BEFORE TRUNCATE ON opportunity_catalog.funding_resolution
 FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
REVOKE ALL ON opportunity_catalog.funding_resolution FROM PUBLIC,c4g_catalog_reader;
GRANT SELECT,INSERT ON opportunity_catalog.funding_resolution TO c4g_opportunity_central_runtime;
-- A staged decision is bound to the exact archive used to verify its evidence.
ALTER TABLE opportunity_catalog.funding_run_item ADD COLUMN source_resolution_id uuid
 REFERENCES opportunity_catalog.funding_resolution(resolution_id);
