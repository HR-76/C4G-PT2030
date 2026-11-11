-- C4G TENANT CONTROL BASELINE ONLY.
-- Roles and database-level properties are provisioned outside F4.3 and are
-- mandatory preconditions checked by the tenant preflight.

CREATE SCHEMA c4g_system AUTHORIZATION c4g_tenant_owner;
CREATE SCHEMA c4g_app AUTHORIZATION c4g_tenant_owner;

REVOKE ALL ON SCHEMA c4g_system FROM PUBLIC;
REVOKE ALL ON SCHEMA c4g_app FROM PUBLIC;
GRANT USAGE ON SCHEMA c4g_system, c4g_app TO c4g_tenant_runtime;

CREATE TABLE c4g_system.tenant_identity (
  singleton_key BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton_key IS TRUE),
  product_code TEXT NOT NULL CHECK (product_code = 'C4G'),
  database_role TEXT NOT NULL CHECK (database_role = 'TENANT'),
  marker_format_version INTEGER NOT NULL CHECK (marker_format_version = 1),
  tenant_id UUID NOT NULL,
  database_generation_id UUID NOT NULL,
  identity_revision BIGINT NOT NULL CHECK (identity_revision = 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE c4g_system.schema_migration (
  migration_id TEXT PRIMARY KEY CHECK (migration_id ~ '^[0-9]{3}_[a-z0-9_]+$'),
  ordinal INTEGER NOT NULL UNIQUE CHECK (ordinal >= 0),
  checksum_sha256 TEXT NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  irreversible BOOLEAN NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resulting_fingerprint TEXT NOT NULL CHECK (resulting_fingerprint ~ '^[a-f0-9]{64}$')
);

CREATE FUNCTION c4g_system.reject_tenant_identity_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'tenant identity is immutable';
END;
$$;

CREATE TRIGGER tenant_identity_immutable
BEFORE UPDATE OR DELETE ON c4g_system.tenant_identity
FOR EACH ROW EXECUTE FUNCTION c4g_system.reject_tenant_identity_mutation();

CREATE TRIGGER tenant_identity_truncate_immutable
BEFORE TRUNCATE ON c4g_system.tenant_identity
FOR EACH STATEMENT EXECUTE FUNCTION c4g_system.reject_tenant_identity_mutation();

CREATE FUNCTION c4g_system.enforce_schema_migration_append_only()
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

CREATE TRIGGER schema_migration_append_only
BEFORE INSERT OR UPDATE OR DELETE ON c4g_system.schema_migration
FOR EACH ROW EXECUTE FUNCTION c4g_system.enforce_schema_migration_append_only();

CREATE TRIGGER schema_migration_truncate_append_only
BEFORE TRUNCATE ON c4g_system.schema_migration
FOR EACH STATEMENT EXECUTE FUNCTION c4g_system.enforce_schema_migration_append_only();

REVOKE ALL ON FUNCTION c4g_system.reject_tenant_identity_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION c4g_system.enforce_schema_migration_append_only() FROM PUBLIC;
REVOKE ALL ON c4g_system.tenant_identity FROM PUBLIC;
REVOKE ALL ON c4g_system.schema_migration FROM PUBLIC;
GRANT SELECT ON c4g_system.tenant_identity, c4g_system.schema_migration TO c4g_tenant_runtime;
