-- F4 metadata only. No functional rows or caller SQL are exposed.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='c4g_f4_metadata_owner') THEN
    CREATE ROLE c4g_f4_metadata_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='c4g_f4_metadata_executor') THEN
    CREATE ROLE c4g_f4_metadata_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='c4g_tenant_api_capabilities') THEN
    CREATE ROLE c4g_tenant_api_capabilities NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;
GRANT c4g_f4_metadata_owner TO c4g_tenant_migrator WITH SET TRUE, INHERIT FALSE, ADMIN FALSE;
GRANT c4g_f4_metadata_executor TO c4g_tenant_api_capabilities WITH SET TRUE, INHERIT FALSE, ADMIN FALSE;
GRANT USAGE ON SCHEMA c4g_system TO c4g_f4_metadata_owner,c4g_f4_metadata_executor;
GRANT USAGE ON SCHEMA async_exec TO c4g_f4_metadata_owner;
GRANT SELECT ON c4g_system.tenant_identity,c4g_system.schema_migration TO c4g_f4_metadata_owner;
GRANT SELECT(lineage_version,state,delivery_kind,attempt,root_execution_id,content_digest,envelope_digest) ON async_exec.outbox TO c4g_f4_metadata_owner;
CREATE FUNCTION c4g_system.runtime_metadata_v1(expected_tenant uuid,expected_generation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE marker jsonb; ledger jsonb; flags jsonb;
BEGIN
  IF expected_tenant IS NULL OR expected_generation IS NULL THEN RAISE EXCEPTION 'F4_METADATA_CONTEXT_REQUIRED'; END IF;
  SELECT jsonb_build_object('product_code',product_code,'database_role',database_role,
    'marker_format_version',marker_format_version,'tenant_id',tenant_id::text,
    'database_generation_id',database_generation_id::text,'identity_revision',identity_revision)
    INTO STRICT marker FROM c4g_system.tenant_identity
    WHERE tenant_id=expected_tenant AND database_generation_id=expected_generation;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('migration_id',migration_id,'ordinal',ordinal,
    'checksum_sha256',checksum_sha256,'irreversible',irreversible,'resulting_fingerprint',resulting_fingerprint) ORDER BY ordinal),'[]'::jsonb)
    INTO ledger FROM c4g_system.schema_migration;
  SELECT jsonb_build_object(
    'legacy_drained',NOT EXISTS(SELECT 1 FROM async_exec.outbox WHERE lineage_version=0 AND state NOT IN('PUBLISHED','FAILED','CANCELLED')),
    'v1_complete',NOT EXISTS(SELECT 1 FROM async_exec.outbox WHERE lineage_version=1 AND
      (delivery_kind IS NULL OR attempt IS NULL OR root_execution_id IS NULL OR content_digest IS NULL OR envelope_digest IS NULL))) INTO flags;
  RETURN jsonb_build_object('marker',marker,'ledger',ledger,'flags',flags);
END $$;
GRANT CREATE ON SCHEMA c4g_system TO c4g_f4_metadata_owner;
ALTER FUNCTION c4g_system.runtime_metadata_v1(uuid,uuid) OWNER TO c4g_f4_metadata_owner;
REVOKE CREATE ON SCHEMA c4g_system FROM c4g_f4_metadata_owner;
REVOKE ALL ON FUNCTION c4g_system.runtime_metadata_v1(uuid,uuid) FROM PUBLIC,c4g_tenant_runtime;
GRANT EXECUTE ON FUNCTION c4g_system.runtime_metadata_v1(uuid,uuid) TO c4g_f4_metadata_executor;
-- 013 is RESERVED, not applied. No other ordinal can be skipped.
CREATE OR REPLACE FUNCTION c4g_system.enforce_schema_migration_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,c4g_system AS $$
DECLARE expected_ordinal INTEGER;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'tenant migration ledger is append-only'; END IF;
  SELECT COALESCE(MAX(ordinal)+1,0) INTO expected_ordinal FROM c4g_system.schema_migration;
  IF NEW.ordinal <> expected_ordinal AND NOT(expected_ordinal=13 AND NEW.ordinal=14
    AND NEW.migration_id='014_f4_runtime_metadata_access') THEN
    RAISE EXCEPTION 'tenant migration ledger ordinal is not contiguous or explicitly reserved';
  END IF;
  RETURN NEW;
END $$;
