-- S4 candidate only; excluded from the executable migration manifest.
-- Isolated SQL/role/idempotency gates and explicit activation are still required.
-- These are editorial candidates, not accepted catalog opportunity identities.
CREATE TABLE opportunity_catalog.manual_v2_candidate (
 candidate_id uuid PRIMARY KEY,
 requested_by uuid NOT NULL REFERENCES public.global_user(id),
 request_id uuid NOT NULL,
 editorial_id text NOT NULL UNIQUE CHECK(editorial_id ~ '^[a-f0-9]{64}$'),
 intent_digest text NOT NULL CHECK(intent_digest ~ '^[a-f0-9]{64}$'),
 content_digest text NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'),
 artifact jsonb NOT NULL CHECK(jsonb_typeof(artifact)='object' AND octet_length(artifact::text)<=270336),
 canonical_snapshot jsonb NOT NULL CHECK(jsonb_typeof(canonical_snapshot)='object' AND octet_length(canonical_snapshot::text)<=262144),
 observed_at timestamptz NOT NULL,
 mapping_version text NOT NULL CHECK(length(mapping_version) BETWEEN 1 AND 128),
 mapping_digest text NOT NULL CHECK(mapping_digest ~ '^[a-f0-9]{64}$'),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(requested_by,request_id),
 CHECK((artifact->>'mediaType') IS NOT DISTINCT FROM 'application/json'),
 CHECK((canonical_snapshot->>'schemaVersion') IS NOT DISTINCT FROM '2'),
 CHECK((canonical_snapshot->>'contractVersion') IS NOT DISTINCT FROM 'opportunity-v2.0'),
 CHECK((canonical_snapshot#>>'{sourceRecords,0,namespace}') IS NOT DISTINCT FROM 'C4G_MANUAL'),
 CHECK((canonical_snapshot#>>'{sourceRecords,0,transport}') IS NOT DISTINCT FROM 'MANUAL'),
 CHECK((canonical_snapshot#>>'{sourceRecords,0,role}') IS NOT DISTINCT FROM 'EDITORIAL'),
 CHECK((canonical_snapshot#>>'{sourceRecords,0,externalId}') IS NOT DISTINCT FROM ('EDITORIAL:'||editorial_id)),
 CHECK(jsonb_array_length(canonical_snapshot->'sourceRecords')=1)
);
ALTER TABLE opportunity_catalog.manual_v2_candidate OWNER TO c4g_opportunity_central_owner;
CREATE TRIGGER manual_v2_candidate_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.manual_v2_candidate FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER manual_v2_candidate_no_truncate BEFORE TRUNCATE ON opportunity_catalog.manual_v2_candidate FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
REVOKE ALL ON opportunity_catalog.manual_v2_candidate FROM PUBLIC,c4g_catalog_reader;
GRANT SELECT,INSERT ON opportunity_catalog.manual_v2_candidate TO c4g_opportunity_central_runtime;
