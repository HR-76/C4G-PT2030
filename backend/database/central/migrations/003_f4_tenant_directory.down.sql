-- Protected rollback for an empty F4.1 directory. CENTRAL ONLY.
DO $$
DECLARE identity_matches BOOLEAN := FALSE; occupied TEXT;
BEGIN
  IF to_regclass('public.c4g_database_identity') IS NULL THEN RAISE EXCEPTION 'Central database identity precondition is missing'; END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.c4g_database_identity WHERE product_code=$1 AND database_role=$2)'
    INTO identity_matches USING 'C4G', 'CENTRAL';
  IF NOT identity_matches THEN RAISE EXCEPTION 'Database is not identified as the C4G central database'; END IF;
  SELECT name INTO occupied FROM (VALUES
    ('tenant_directory_event'),('tenant_health_observation'),('organization_provisioning'),('tenant_schema_state'),
    ('organization_connection'),('organization_connection_version'),('tenant_database_generation'),('tenant')) v(name)
    WHERE EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=v.name)
      AND CASE v.name
        WHEN 'tenant_directory_event' THEN EXISTS(SELECT 1 FROM public.tenant_directory_event)
        WHEN 'tenant_health_observation' THEN EXISTS(SELECT 1 FROM public.tenant_health_observation)
        WHEN 'organization_provisioning' THEN EXISTS(SELECT 1 FROM public.organization_provisioning)
        WHEN 'tenant_schema_state' THEN EXISTS(SELECT 1 FROM public.tenant_schema_state)
        WHEN 'organization_connection' THEN EXISTS(SELECT 1 FROM public.organization_connection)
        WHEN 'organization_connection_version' THEN EXISTS(SELECT 1 FROM public.organization_connection_version)
        WHEN 'tenant_database_generation' THEN EXISTS(SELECT 1 FROM public.tenant_database_generation)
        WHEN 'tenant' THEN EXISTS(SELECT 1 FROM public.tenant) END LIMIT 1;
  IF occupied IS NOT NULL THEN RAISE EXCEPTION 'F4.1 rollback refused: table % contains durable data', occupied; END IF;
END $$;

DROP TABLE public.tenant_directory_event;
DROP TABLE public.tenant_health_observation;
DROP TABLE public.organization_provisioning;
DROP TABLE public.tenant_schema_state;
DROP TABLE public.organization_connection;
DROP TABLE public.organization_connection_version;
DROP TABLE public.tenant_database_generation;
DROP TABLE public.tenant;
DROP FUNCTION public.f4_event_append_only();
DROP FUNCTION public.f4_provisioning_guard();
DROP FUNCTION public.f4_schema_state_guard();
DROP FUNCTION public.f4_connection_guard();
DROP FUNCTION public.f4_connection_version_guard();
DROP FUNCTION public.f4_generation_guard();
DROP FUNCTION public.f4_tenant_immutable();
