-- Isolated simulation ledger only; never used as evidence of real delivery.
SET ROLE c4g_opportunity_tenant_owner;
CREATE TABLE opportunity_catalog.application_status_simulation (
 organization_id uuid NOT NULL,delivery_id uuid NOT NULL,event_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('RESERVED','UNKNOWN','ACCEPTED','SKIPPED','FAILED')),
 message jsonb, destination text, first_attempt_at timestamptz,lease_until timestamptz,
 fence bigint NOT NULL DEFAULT 1,reason text,
 PRIMARY KEY(organization_id,delivery_id),UNIQUE(organization_id,event_id,destination),
 FOREIGN KEY(organization_id,delivery_id) REFERENCES opportunity_catalog.application_status_delivery(organization_id,delivery_id),
 FOREIGN KEY(organization_id,event_id) REFERENCES opportunity_catalog.application_status_event(organization_id,event_id)
);
ALTER TABLE opportunity_catalog.application_status_simulation ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_catalog.application_status_simulation FORCE ROW LEVEL SECURITY;
CREATE POLICY status_simulation_isolation ON opportunity_catalog.application_status_simulation USING(organization_id=current_setting('app.organization_id',true)::uuid) WITH CHECK(organization_id=current_setting('app.organization_id',true)::uuid);
REVOKE ALL ON opportunity_catalog.application_status_simulation FROM PUBLIC;
RESET ROLE;
