-- S6 candidate only. Not registered in the active tenant manifest.
-- Apply transactionally after the existing tenant033 baseline in an isolated gate.
SET ROLE c4g_opportunity_tenant_owner;
ALTER TABLE opportunity_catalog.application DROP CONSTRAINT application_exact_origin;
ALTER TABLE opportunity_catalog.application ADD CONSTRAINT application_exact_origin CHECK(
 (opportunity_id IS NOT NULL AND central_opportunity_id IS NULL AND central_revision_id IS NULL AND central_snapshot IS NULL)
 OR (opportunity_id IS NULL AND central_opportunity_id IS NOT NULL AND central_revision_id IS NOT NULL AND central_snapshot IS NOT NULL
 AND evaluation_id IS NULL AND jsonb_typeof(central_snapshot)='object'));
ALTER TABLE opportunity_catalog.application ADD CONSTRAINT application_v2_snapshot_capacity CHECK(
 central_snapshot IS NULL OR CASE WHEN central_snapshot->>'schemaVersion'='2'
 THEN central_snapshot->>'contractVersion' IS NOT DISTINCT FROM 'opportunity-v2.0' AND octet_length(central_snapshot::text)<=262144
 ELSE octet_length(central_snapshot::text)<=32768 END);
RESET ROLE;
