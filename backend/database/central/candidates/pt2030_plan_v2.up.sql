-- S3 candidate only: not part of the executable migration manifest.
-- Number, checksum, schema fingerprint and deployment require isolated gates.
CREATE TABLE opportunity_catalog.pt2030_plan_preview (
 preview_id uuid PRIMARY KEY,
 requested_by uuid NOT NULL REFERENCES public.global_user(id),
 request_id uuid NOT NULL,
 preview_digest text NOT NULL CHECK(preview_digest ~ '^[a-f0-9]{64}$'),
 intent_digest text NOT NULL CHECK(intent_digest ~ '^[a-f0-9]{64}$'),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 document_binding jsonb NOT NULL CHECK(jsonb_typeof(document_binding)='object' AND octet_length(document_binding::text)<=8192),
 bundle jsonb NOT NULL CHECK(jsonb_typeof(bundle)='object' AND octet_length(bundle::text)<=33554432),
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(requested_by,request_id),
 CHECK((document_binding->>'authority') IS NOT DISTINCT FROM 'CENTRAL'),
 CHECK((document_binding->'organizationId') IS NOT DISTINCT FROM 'null'::jsonb),
 CHECK((bundle->>'sourceNamespace') IS NOT DISTINCT FROM 'PORTUGAL2030_PLAN')
);
CREATE INDEX pt2030_plan_preview_digest ON opportunity_catalog.pt2030_plan_preview(requested_by,preview_digest);

-- These are source-candidate identities, independent from published opportunity
-- UUIDs, tenant data and funding_identity. A head is not an accepted fact.
CREATE TABLE opportunity_catalog.pt2030_plan_identity (
 external_identifier text PRIMARY KEY CHECK(length(external_identifier) BETWEEN 1 AND 128),
 revision_number integer NOT NULL DEFAULT 0 CHECK(revision_number>=0),
 latest_revision_id uuid,
 CHECK((revision_number=0)=(latest_revision_id IS NULL))
);
CREATE TABLE opportunity_catalog.pt2030_plan_revision (
 revision_id uuid PRIMARY KEY,
 external_identifier text NOT NULL REFERENCES opportunity_catalog.pt2030_plan_identity(external_identifier),
 revision_number integer NOT NULL CHECK(revision_number>0),
 previous_revision_id uuid,
 content_digest text NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'),
 canonical_snapshot jsonb NOT NULL CHECK(jsonb_typeof(canonical_snapshot)='object' AND octet_length(canonical_snapshot::text)<=262144),
 comparison jsonb NOT NULL CHECK(jsonb_typeof(comparison)='object' AND octet_length(comparison::text)<=65536),
 review_required boolean NOT NULL,
 observed_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(external_identifier,revision_number),
 UNIQUE(revision_id,external_identifier),
 UNIQUE(revision_id,external_identifier,revision_number),
 FOREIGN KEY(previous_revision_id,external_identifier) REFERENCES opportunity_catalog.pt2030_plan_revision(revision_id,external_identifier),
 CHECK((canonical_snapshot->>'schemaVersion') IS NOT DISTINCT FROM '2'),
 CHECK((canonical_snapshot->>'contractVersion') IS NOT DISTINCT FROM 'opportunity-v2.0'),
 CHECK((canonical_snapshot#>>'{publication,value}') IS NOT DISTINCT FROM 'PLANNED'),
 CHECK((canonical_snapshot#>>'{sourceRecords,0,namespace}') IS NOT DISTINCT FROM 'PORTUGAL2030_PLAN'),
 CHECK((canonical_snapshot#>>'{sourceRecords,0,externalId}') IS NOT DISTINCT FROM external_identifier),
 CHECK((revision_number=1)=(previous_revision_id IS NULL)),
 CHECK(previous_revision_id IS DISTINCT FROM revision_id)
);
ALTER TABLE opportunity_catalog.pt2030_plan_identity ADD CONSTRAINT pt2030_plan_latest_revision
 FOREIGN KEY(latest_revision_id,external_identifier,revision_number) REFERENCES opportunity_catalog.pt2030_plan_revision(revision_id,external_identifier,revision_number);

CREATE TABLE opportunity_catalog.pt2030_plan_import (
 import_id uuid PRIMARY KEY,
 requested_by uuid NOT NULL REFERENCES public.global_user(id),
 request_id uuid NOT NULL,
 preview_id uuid NOT NULL REFERENCES opportunity_catalog.pt2030_plan_preview(preview_id),
 preview_digest text NOT NULL CHECK(preview_digest ~ '^[a-f0-9]{64}$'),
 intent_digest text NOT NULL CHECK(intent_digest ~ '^[a-f0-9]{64}$'),
 observed_at timestamptz NOT NULL,
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=8192),
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(requested_by,request_id)
);
CREATE TABLE opportunity_catalog.pt2030_plan_observation (
 import_id uuid NOT NULL REFERENCES opportunity_catalog.pt2030_plan_import(import_id),
 physical_row integer NOT NULL CHECK(physical_row>0),
 external_identifier text CHECK(length(external_identifier) BETWEEN 1 AND 128),
 source_columns_digest text NOT NULL CHECK(source_columns_digest ~ '^[a-f0-9]{64}$'),
 source_cells jsonb NOT NULL CHECK(jsonb_typeof(source_cells)='object' AND octet_length(source_cells::text)<=262144),
 candidate_revision_id uuid,
 outcome text NOT NULL CHECK(outcome IN ('CREATED','UNCHANGED','CANDIDATE_REVISION','REVIEW_REQUIRED','REJECTED')),
 errors jsonb NOT NULL CHECK(jsonb_typeof(errors)='array' AND octet_length(errors::text)<=8192),
 PRIMARY KEY(import_id,physical_row),
 FOREIGN KEY(candidate_revision_id,external_identifier) REFERENCES opportunity_catalog.pt2030_plan_revision(revision_id,external_identifier),
 CHECK((outcome='REJECTED')=(candidate_revision_id IS NULL)),
 CHECK(outcome='REJECTED' OR external_identifier IS NOT NULL)
);

ALTER TABLE opportunity_catalog.pt2030_plan_preview OWNER TO c4g_opportunity_central_owner;
ALTER TABLE opportunity_catalog.pt2030_plan_identity OWNER TO c4g_opportunity_central_owner;
ALTER TABLE opportunity_catalog.pt2030_plan_revision OWNER TO c4g_opportunity_central_owner;
ALTER TABLE opportunity_catalog.pt2030_plan_import OWNER TO c4g_opportunity_central_owner;
ALTER TABLE opportunity_catalog.pt2030_plan_observation OWNER TO c4g_opportunity_central_owner;

CREATE TRIGGER pt2030_plan_preview_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.pt2030_plan_preview FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER pt2030_plan_preview_no_truncate BEFORE TRUNCATE ON opportunity_catalog.pt2030_plan_preview FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER pt2030_plan_revision_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.pt2030_plan_revision FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER pt2030_plan_revision_no_truncate BEFORE TRUNCATE ON opportunity_catalog.pt2030_plan_revision FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER pt2030_plan_import_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.pt2030_plan_import FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER pt2030_plan_import_no_truncate BEFORE TRUNCATE ON opportunity_catalog.pt2030_plan_import FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER pt2030_plan_observation_immutable BEFORE UPDATE OR DELETE ON opportunity_catalog.pt2030_plan_observation FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER pt2030_plan_observation_no_truncate BEFORE TRUNCATE ON opportunity_catalog.pt2030_plan_observation FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER pt2030_plan_identity_no_delete BEFORE DELETE ON opportunity_catalog.pt2030_plan_identity FOR EACH ROW EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();
CREATE TRIGGER pt2030_plan_identity_no_truncate BEFORE TRUNCATE ON opportunity_catalog.pt2030_plan_identity FOR EACH STATEMENT EXECUTE FUNCTION opportunity_catalog.reject_history_mutation();

REVOKE ALL ON opportunity_catalog.pt2030_plan_preview,opportunity_catalog.pt2030_plan_identity,opportunity_catalog.pt2030_plan_revision,opportunity_catalog.pt2030_plan_import,opportunity_catalog.pt2030_plan_observation FROM PUBLIC,c4g_catalog_reader;
GRANT SELECT,INSERT ON opportunity_catalog.pt2030_plan_preview,opportunity_catalog.pt2030_plan_identity,opportunity_catalog.pt2030_plan_revision,opportunity_catalog.pt2030_plan_import,opportunity_catalog.pt2030_plan_observation TO c4g_opportunity_central_runtime;
GRANT UPDATE(revision_number,latest_revision_id) ON opportunity_catalog.pt2030_plan_identity TO c4g_opportunity_central_runtime;
