SET ROLE c4g_opportunity_tenant_owner;
ALTER TABLE opportunity_catalog.application ALTER COLUMN opportunity_id DROP NOT NULL;
ALTER TABLE opportunity_catalog.application ADD COLUMN central_opportunity_id uuid;
ALTER TABLE opportunity_catalog.application ADD COLUMN central_revision_id uuid;
ALTER TABLE opportunity_catalog.application ADD COLUMN central_snapshot jsonb;
ALTER TABLE opportunity_catalog.application ADD CONSTRAINT application_exact_origin CHECK(
 (opportunity_id IS NOT NULL AND central_opportunity_id IS NULL AND central_revision_id IS NULL AND central_snapshot IS NULL)
 OR (opportunity_id IS NULL AND central_opportunity_id IS NOT NULL AND central_revision_id IS NOT NULL AND central_snapshot IS NOT NULL
 AND evaluation_id IS NULL AND jsonb_typeof(central_snapshot)='object' AND octet_length(central_snapshot::text)<=32768));
CREATE INDEX application_central_origin ON opportunity_catalog.application(organization_id,central_opportunity_id,application_id) WHERE central_opportunity_id IS NOT NULL;
RESET ROLE;
