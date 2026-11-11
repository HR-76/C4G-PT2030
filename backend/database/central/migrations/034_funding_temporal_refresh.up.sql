-- Frozen maintenance targets. Discovery counters retain their original meaning.
ALTER TABLE opportunity_catalog.funding_cycle ADD COLUMN refresh_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE opportunity_catalog.funding_identity ADD COLUMN source_review text CHECK(source_review IN ('CONFLICT','ABSENT','ERROR'));
ALTER TABLE opportunity_catalog.funding_identity ADD COLUMN source_reviewed_at timestamptz;
CREATE TABLE opportunity_catalog.funding_refresh_target (
 cycle_id uuid NOT NULL REFERENCES opportunity_catalog.funding_cycle(cycle_id),
 external_identifier text NOT NULL REFERENCES opportunity_catalog.funding_identity(external_identifier),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','DISCOVERED','STAGED','UPDATED','UNCHANGED','CONFLICT','ABSENT','ERROR')),
 run_id uuid REFERENCES opportunity_catalog.funding_run(run_id),
 observed_at timestamptz,
 received integer NOT NULL DEFAULT 0 CHECK(received BETWEEN 0 AND 25),
 PRIMARY KEY(cycle_id,external_identifier)
);
CREATE INDEX funding_refresh_pending ON opportunity_catalog.funding_refresh_target(cycle_id,external_identifier) WHERE state='PENDING';
ALTER TABLE opportunity_catalog.funding_refresh_target OWNER TO c4g_opportunity_central_owner;
REVOKE ALL ON opportunity_catalog.funding_refresh_target FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON opportunity_catalog.funding_refresh_target TO c4g_opportunity_central_runtime;
