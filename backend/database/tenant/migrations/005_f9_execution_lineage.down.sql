REVOKE SELECT,INSERT ON async_exec.outbox FROM c4g_opportunity_tenant_runtime;
REVOKE USAGE ON SCHEMA async_exec FROM c4g_opportunity_tenant_runtime;
LOCK TABLE async_exec.outbox IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM async_exec.outbox WHERE lineage_version=1) THEN RAISE EXCEPTION 'F9_LINEAGE_ROLLBACK_REQUIRES_NO_V1'; END IF; END $$;
DROP TRIGGER guard_outbox_lineage_v1 ON async_exec.outbox;
DROP FUNCTION async_exec.guard_outbox_lineage_v1();
DROP INDEX async_exec.f9_tenant_outbox_previous_v1;
DROP INDEX async_exec.f9_tenant_outbox_replay_request_v1;
DROP INDEX async_exec.f9_tenant_outbox_execution_v1;
ALTER TABLE async_exec.outbox DROP CONSTRAINT outbox_lineage_shape_check, DROP CONSTRAINT outbox_lineage_version_check,
 DROP COLUMN replay_request_id,DROP COLUMN envelope_digest,DROP COLUMN content_digest,DROP COLUMN previous_execution_id,
 DROP COLUMN root_execution_id,DROP COLUMN attempt,DROP COLUMN delivery_kind,DROP COLUMN lineage_version;
DROP TYPE async_exec.delivery_kind;
GRANT UPDATE,DELETE ON async_exec.outbox TO c4g_tenant_runtime;
