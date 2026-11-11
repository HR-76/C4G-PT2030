-- S2/S4 candidate only. Not registered in the executable migration manifest.
-- Assign a migration number/checksum/fingerprint only after isolated SQL gates.
ALTER TABLE opportunity_catalog.funding_run ADD COLUMN canonical_v2_required boolean NOT NULL DEFAULT false;
CREATE TABLE opportunity_catalog.funding_candidate_v2 (
 run_id uuid NOT NULL REFERENCES opportunity_catalog.funding_run(run_id),
 external_identifier text NOT NULL CHECK(length(external_identifier) BETWEEN 1 AND 128),
 source_selection text NOT NULL CHECK(source_selection IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS','INTERREG_EUROPE','POCTEP')),
 observed_at timestamptz NOT NULL,
 snapshot_schema_version smallint NOT NULL CHECK(snapshot_schema_version=2),
 mapping_version text NOT NULL CHECK(length(mapping_version) BETWEEN 1 AND 100),
 content_digest text NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 canonical_snapshot jsonb NOT NULL CHECK(jsonb_typeof(canonical_snapshot)='object' AND octet_length(canonical_snapshot::text)<=262144),
 -- json preserves the exact serialization whose SHA-256 is in provenance.
 source_evidence json NOT NULL CHECK(json_typeof(source_evidence)='object' AND octet_length(source_evidence::text)<=2097152),
 evidence_fingerprint text NOT NULL CHECK(evidence_fingerprint ~ '^[a-f0-9]{64}$'),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(run_id,external_identifier),
 CHECK((canonical_snapshot->>'schemaVersion') IS NOT DISTINCT FROM '2'),
 CHECK((canonical_snapshot->>'contractVersion') IS NOT DISTINCT FROM 'opportunity-v2.0'),
 CHECK((canonical_snapshot#>>'{provenance,mappingVersion}') IS NOT DISTINCT FROM mapping_version),
 CHECK((source_evidence->>'externalIdentifier') IS NOT DISTINCT FROM external_identifier),
 CHECK((source_evidence->>'fingerprint') IS NOT DISTINCT FROM evidence_fingerprint)
);
ALTER TABLE opportunity_catalog.funding_candidate_v2 OWNER TO c4g_opportunity_central_owner;
CREATE TRIGGER funding_candidate_v2_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.funding_candidate_v2
 FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER funding_candidate_v2_no_truncate BEFORE TRUNCATE ON opportunity_catalog.funding_candidate_v2
 FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
REVOKE ALL ON opportunity_catalog.funding_candidate_v2 FROM PUBLIC,c4g_catalog_reader;
GRANT SELECT,INSERT ON opportunity_catalog.funding_candidate_v2 TO c4g_opportunity_central_runtime;
