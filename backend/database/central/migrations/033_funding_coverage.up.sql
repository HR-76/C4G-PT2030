-- Additive coverage state. Existing identities, revisions and run history stay intact.
CREATE TABLE opportunity_catalog.funding_cycle (
 cycle_id uuid PRIMARY KEY REFERENCES opportunity_catalog.funding_run(run_id),
 status text NOT NULL CHECK(status IN ('RUNNING','SUCCESS','PARTIAL','ERROR')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz,
 received integer NOT NULL DEFAULT 0 CHECK(received>=0), unique_count integer NOT NULL DEFAULT 0 CHECK(unique_count>=0),
 duplicate_count integer NOT NULL DEFAULT 0 CHECK(duplicate_count>=0), excluded_count integer NOT NULL DEFAULT 0 CHECK(excluded_count>=0),
 invalid_count integer NOT NULL DEFAULT 0 CHECK(invalid_count>=0), pages integer NOT NULL DEFAULT 0 CHECK(pages>=0),
 created_count integer NOT NULL DEFAULT 0 CHECK(created_count>=0), updated_count integer NOT NULL DEFAULT 0 CHECK(updated_count>=0),
 unchanged_count integer NOT NULL DEFAULT 0 CHECK(unchanged_count>=0), failed_count integer NOT NULL DEFAULT 0 CHECK(failed_count>=0),
 remote_total integer CHECK(remote_total>=0), total_changed boolean NOT NULL DEFAULT false,
 contract_hash text CHECK(contract_hash ~ '^[a-f0-9]{64}$'), reference_date date,
 error_code text,
 CHECK(received=unique_count+duplicate_count+excluded_count+invalid_count)
);
CREATE TABLE opportunity_catalog.funding_batch (
 run_id uuid PRIMARY KEY REFERENCES opportunity_catalog.funding_run(run_id),
 cycle_id uuid NOT NULL REFERENCES opportunity_catalog.funding_cycle(cycle_id),
 ordinal integer NOT NULL CHECK(ordinal>0),
 input_cursor jsonb CHECK(input_cursor IS NULL OR jsonb_typeof(input_cursor)='object' AND octet_length(input_cursor::text)<=2048),
 next_cursor jsonb CHECK(next_cursor IS NULL OR jsonb_typeof(next_cursor)='object' AND octet_length(next_cursor::text)<=2048),
 UNIQUE(cycle_id,ordinal)
);
CREATE TABLE opportunity_catalog.funding_cycle_seen (
 cycle_id uuid NOT NULL REFERENCES opportunity_catalog.funding_cycle(cycle_id),
 external_identifier text NOT NULL CHECK(length(external_identifier) BETWEEN 1 AND 128),
 PRIMARY KEY(cycle_id,external_identifier)
);
ALTER TABLE opportunity_catalog.funding_cycle OWNER TO c4g_opportunity_central_owner;
ALTER TABLE opportunity_catalog.funding_batch OWNER TO c4g_opportunity_central_owner;
ALTER TABLE opportunity_catalog.funding_cycle_seen OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON opportunity_catalog.funding_cycle,opportunity_catalog.funding_batch,opportunity_catalog.funding_cycle_seen FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON opportunity_catalog.funding_cycle,opportunity_catalog.funding_batch TO c4g_opportunity_central_runtime;
GRANT SELECT,INSERT ON opportunity_catalog.funding_cycle_seen TO c4g_opportunity_central_runtime;
