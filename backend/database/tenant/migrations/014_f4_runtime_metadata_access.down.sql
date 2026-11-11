-- Shared cluster roles may not be changed while another database uses them.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend d JOIN pg_catalog.pg_roles r ON r.oid=d.refobjid
    WHERE d.refclassid='pg_catalog.pg_authid'::regclass AND r.rolname IN('c4g_f4_metadata_owner','c4g_f4_metadata_executor')
      AND d.dbid<>0 AND d.dbid<>(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())) THEN
    RAISE EXCEPTION 'F4_METADATA_DOWN_SHARED_ROLE_IN_USE';
  END IF;
END $$;
DROP FUNCTION c4g_system.runtime_metadata_v1(uuid,uuid);
REVOKE SELECT ON c4g_system.tenant_identity,c4g_system.schema_migration FROM c4g_f4_metadata_owner;
REVOKE SELECT(lineage_version,state,delivery_kind,attempt,root_execution_id,content_digest,envelope_digest) ON async_exec.outbox FROM c4g_f4_metadata_owner;
REVOKE USAGE ON SCHEMA c4g_system FROM c4g_f4_metadata_owner,c4g_f4_metadata_executor;
REVOKE USAGE ON SCHEMA async_exec FROM c4g_f4_metadata_owner;
REVOKE c4g_f4_metadata_executor FROM c4g_tenant_api_capabilities;
REVOKE c4g_f4_metadata_owner FROM c4g_tenant_migrator;
DROP ROLE c4g_f4_metadata_executor,c4g_f4_metadata_owner;
CREATE OR REPLACE FUNCTION c4g_system.enforce_schema_migration_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, c4g_system
AS $$
DECLARE
  expected_ordinal INTEGER;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'tenant migration ledger is append-only';
  END IF;
  SELECT COALESCE(MAX(ordinal) + 1, 0)
    INTO expected_ordinal
    FROM c4g_system.schema_migration;
  IF NEW.ordinal <> expected_ordinal THEN
    RAISE EXCEPTION 'tenant migration ledger ordinal is not contiguous';
  END IF;
  RETURN NEW;
END;
$$;
