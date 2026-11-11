-- Access role only. Login/password provisioning is external to migrations.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_catalog_reader') THEN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_catalog_reader'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit))
      OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member='c4g_catalog_reader'::regrole)
    THEN RAISE EXCEPTION 'CATALOG_READER_ROLE_DRIFT'; END IF;
  ELSE
    CREATE ROLE c4g_catalog_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
      NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='opportunity_catalog' AND c.relname IN ('opportunity','revision','funding_identity')
      AND pg_get_userbyid(c.relowner)<>'c4g_opportunity_central_owner')
  THEN RAISE EXCEPTION 'CATALOG_READER_OWNER_DRIFT'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
    LATERAL aclexplode(c.relacl) a WHERE n.nspname='opportunity_catalog'
    AND a.grantee='c4g_catalog_reader'::regrole)
    OR EXISTS (SELECT 1 FROM pg_namespace n,LATERAL aclexplode(n.nspacl) a
      WHERE n.nspname='opportunity_catalog' AND a.grantee='c4g_catalog_reader'::regrole)
  THEN RAISE EXCEPTION 'CATALOG_READER_ACL_ALREADY_PRESENT'; END IF;
  -- PostgreSQL has no per-role DENY: PUBLIC TEMP would otherwise allow reader DDL.
  -- Catalog queries/imports use no temporary tables. Explicit grants are untouched.
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC',current_database());
END $$;
GRANT USAGE ON SCHEMA opportunity_catalog TO c4g_catalog_reader;
GRANT SELECT ON opportunity_catalog.opportunity, opportunity_catalog.revision,
  opportunity_catalog.funding_identity TO c4g_catalog_reader;
