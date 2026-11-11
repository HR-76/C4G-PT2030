CREATE TABLE public.tenant_workload_binding (
  tenant_id UUID NOT NULL REFERENCES public.tenant(tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  workload TEXT NOT NULL CHECK (workload IN ('API','WORKER')),
  current_connection_version BIGINT,
  lifecycle_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (lifecycle_status IN ('PENDING','AVAILABLE','BLOCKED','DRAINING','ARCHIVED')),
  compatibility_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (compatibility_status IN ('UNKNOWN','COMPATIBLE','READ_ONLY','MIGRATION_REQUIRED','MIGRATING','INCOMPATIBLE','FAILED')),
  provisioning_status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (provisioning_status IN ('NOT_STARTED','QUEUED','RUNNING','VERIFYING','READY','FAILED','CANCELLED')),
  fence BIGINT NOT NULL DEFAULT 0 CHECK (fence >= 0), binding_digest TEXT, credential_ref TEXT,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0), published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (tenant_id, workload),
  CHECK ((lifecycle_status = 'PENDING' AND current_connection_version IS NULL AND credential_ref IS NULL
      AND binding_digest IS NULL AND compatibility_status = 'UNKNOWN' AND provisioning_status = 'NOT_STARTED' AND published_at IS NULL)
    OR (lifecycle_status IN ('AVAILABLE','BLOCKED','DRAINING','ARCHIVED') AND current_connection_version > 0
      AND credential_ref IS NOT NULL AND binding_digest IS NOT NULL AND published_at IS NOT NULL)),
  CHECK (lifecycle_status <> 'AVAILABLE' OR (compatibility_status = 'COMPATIBLE' AND provisioning_status = 'READY'))
);
CREATE TABLE public.tenant_workload_connection_version (
  tenant_id UUID NOT NULL, workload TEXT NOT NULL CHECK (workload IN ('API','WORKER')),
  connection_version BIGINT NOT NULL CHECK (connection_version > 0), credential_ref TEXT NOT NULL UNIQUE,
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('CANDIDATE','VALIDATED','AVAILABLE','DRAINING','REVOKED','FAILED')),
  compatibility_status TEXT NOT NULL CHECK (compatibility_status IN ('UNKNOWN','COMPATIBLE','READ_ONLY','MIGRATION_REQUIRED','MIGRATING','INCOMPATIBLE','FAILED')),
  provisioning_status TEXT NOT NULL CHECK (provisioning_status IN ('NOT_STARTED','QUEUED','RUNNING','VERIFYING','READY','FAILED','CANCELLED')),
  fence BIGINT NOT NULL CHECK (fence >= 0), binding_digest TEXT NOT NULL,
  intent_digest TEXT NOT NULL CHECK (intent_digest ~ '^[a-f0-9]{64}$'),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), validated_at TIMESTAMPTZ, published_at TIMESTAMPTZ,
  draining_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0), PRIMARY KEY (tenant_id, workload, connection_version),
  FOREIGN KEY (tenant_id, workload) REFERENCES public.tenant_workload_binding(tenant_id,workload) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK ((lifecycle_status = 'CANDIDATE' AND compatibility_status = 'UNKNOWN' AND provisioning_status = 'VERIFYING'
      AND failure_code IS NULL AND validated_at IS NULL AND published_at IS NULL AND draining_at IS NULL AND revoked_at IS NULL)
    OR (lifecycle_status = 'VALIDATED' AND compatibility_status = 'COMPATIBLE' AND provisioning_status = 'READY'
      AND failure_code IS NULL AND validated_at IS NOT NULL AND published_at IS NULL AND draining_at IS NULL AND revoked_at IS NULL)
    OR (lifecycle_status = 'AVAILABLE' AND compatibility_status = 'COMPATIBLE' AND provisioning_status = 'READY'
      AND failure_code IS NULL AND validated_at IS NOT NULL AND published_at IS NOT NULL AND draining_at IS NULL AND revoked_at IS NULL)
    OR (lifecycle_status = 'DRAINING' AND compatibility_status = 'COMPATIBLE' AND provisioning_status = 'READY'
      AND failure_code IS NULL AND validated_at IS NOT NULL AND published_at IS NOT NULL AND draining_at IS NOT NULL AND revoked_at IS NULL)
    OR (lifecycle_status = 'REVOKED' AND compatibility_status = 'COMPATIBLE' AND provisioning_status = 'READY'
      AND failure_code IS NULL AND validated_at IS NOT NULL AND published_at IS NOT NULL AND draining_at IS NOT NULL AND revoked_at IS NOT NULL)
    OR (lifecycle_status = 'FAILED' AND compatibility_status IN ('INCOMPATIBLE','FAILED') AND provisioning_status = 'FAILED'
      AND failure_code IS NOT NULL AND published_at IS NULL AND draining_at IS NULL AND revoked_at IS NULL))
);
CREATE UNIQUE INDEX tenant_workload_one_available ON public.tenant_workload_connection_version (tenant_id, workload)
  WHERE lifecycle_status = 'AVAILABLE';
CREATE FUNCTION public.f4_workload_version_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $guard$
BEGIN
  IF ROW(NEW.tenant_id,NEW.workload,NEW.connection_version,NEW.credential_ref,NEW.binding_digest,NEW.intent_digest)
    IS DISTINCT FROM ROW(OLD.tenant_id,OLD.workload,OLD.connection_version,OLD.credential_ref,OLD.binding_digest,OLD.intent_digest)
  THEN RAISE EXCEPTION 'F44_IMMUTABLE_INTENT'; END IF;
  IF NEW.revision <= OLD.revision THEN RAISE EXCEPTION 'F44_REVISION_REGRESSION'; END IF;
  RETURN NEW;
END $guard$;
CREATE TRIGGER tenant_workload_version_guard BEFORE UPDATE ON public.tenant_workload_connection_version
  FOR EACH ROW EXECUTE FUNCTION public.f4_workload_version_guard();
CREATE FUNCTION public.f4_workload_binding_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $guard$
BEGIN
  IF ROW(NEW.tenant_id,NEW.workload) IS DISTINCT FROM ROW(OLD.tenant_id,OLD.workload) THEN RAISE EXCEPTION 'F44_IMMUTABLE_BINDING'; END IF;
  IF NEW.revision <= OLD.revision OR NEW.fence < OLD.fence THEN RAISE EXCEPTION 'F44_BINDING_REGRESSION'; END IF;
  RETURN NEW;
END $guard$;
CREATE TRIGGER tenant_workload_binding_guard BEFORE UPDATE ON public.tenant_workload_binding
  FOR EACH ROW EXECUTE FUNCTION public.f4_workload_binding_guard();
ALTER TABLE public.tenant_workload_binding ADD CONSTRAINT tenant_workload_current_fk
  FOREIGN KEY (tenant_id,workload,current_connection_version)
  REFERENCES public.tenant_workload_connection_version(tenant_id,workload,connection_version) DEFERRABLE INITIALLY DEFERRED;
REVOKE ALL ON public.tenant_workload_binding, public.tenant_workload_connection_version FROM PUBLIC;
REVOKE ALL ON FUNCTION public.f4_workload_version_guard(), public.f4_workload_binding_guard() FROM PUBLIC;
-- Existing tenant-level records are intentionally not backfilled: workload is not inferable safely.
