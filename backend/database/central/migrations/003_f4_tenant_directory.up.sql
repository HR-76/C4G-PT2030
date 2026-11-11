-- C4G CENTRAL DATABASE ONLY. F4.1 tenant directory; no tenant connections.

DO $$
DECLARE identity_matches BOOLEAN := FALSE;
BEGIN
  IF to_regclass('public.c4g_database_identity') IS NULL THEN
    RAISE EXCEPTION 'Central database identity precondition is missing';
  END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.c4g_database_identity WHERE product_code=$1 AND database_role=$2)'
    INTO identity_matches USING 'C4G', 'CENTRAL';
  IF NOT identity_matches THEN RAISE EXCEPTION 'Database is not identified as the C4G central database'; END IF;
END $$;

CREATE TABLE public.tenant (
  tenant_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  deployment_mode TEXT NOT NULL CHECK (deployment_mode = 'DATABASE_PER_ORGANIZATION'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  CONSTRAINT tenant_organization_uid UNIQUE (organization_id),
  CONSTRAINT tenant_identity_organization_uid UNIQUE (tenant_id, organization_id),
  CONSTRAINT tenant_organization_fk FOREIGN KEY (organization_id) REFERENCES public.organization(id)
    MATCH SIMPLE ON UPDATE RESTRICT ON DELETE RESTRICT NOT DEFERRABLE INITIALLY IMMEDIATE
);

CREATE FUNCTION public.f4_tenant_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.deployment_mode IS DISTINCT FROM OLD.deployment_mode THEN
    RAISE EXCEPTION 'Tenant identity is immutable';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;
CREATE TRIGGER tenant_immutable_before_update BEFORE UPDATE ON public.tenant
  FOR EACH ROW EXECUTE FUNCTION public.f4_tenant_immutable();

CREATE TABLE public.tenant_database_generation (
  database_generation_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  database_ref TEXT NOT NULL CHECK (database_ref ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ,
  CONSTRAINT tenant_database_generation_database_ref_uid UNIQUE (database_ref),
  CONSTRAINT tenant_database_generation_identity_uid UNIQUE (tenant_id, database_generation_id, database_ref),
  CONSTRAINT tenant_database_generation_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenant(tenant_id)
    MATCH SIMPLE ON UPDATE RESTRICT ON DELETE RESTRICT NOT DEFERRABLE INITIALLY IMMEDIATE
);

CREATE FUNCTION public.f4_generation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.database_generation_id IS DISTINCT FROM OLD.database_generation_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.database_ref IS DISTINCT FROM OLD.database_ref OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Database generation identity is immutable';
  END IF;
  IF OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
    RAISE EXCEPTION 'Database generation retirement is irreversible';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenant_database_generation_guard_before_update BEFORE UPDATE ON public.tenant_database_generation
  FOR EACH ROW EXECUTE FUNCTION public.f4_generation_guard();

CREATE TABLE public.organization_connection_version (
  tenant_id UUID NOT NULL,
  connection_version BIGINT NOT NULL CHECK (connection_version > 0),
  deployment_mode TEXT NOT NULL CHECK (deployment_mode = 'DATABASE_PER_ORGANIZATION'),
  database_generation_id UUID NOT NULL,
  database_ref TEXT NOT NULL CHECK (database_ref ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$'),
  credential_ref TEXT NOT NULL CHECK (credential_ref ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$'),
  region_code TEXT NOT NULL CHECK (region_code ~ '^[A-Z][A-Z0-9_-]{0,31}$'),
  residency_policy_version TEXT NOT NULL CHECK (BTRIM(residency_policy_version) <> ''),
  observed_system_identifier TEXT,
  binding_digest TEXT,
  version_state TEXT NOT NULL CHECK (version_state IN ('CANDIDATE','VALIDATED','DRAINING','REVOKED','FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validated_at TIMESTAMPTZ,
  draining_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason_code TEXT,
  PRIMARY KEY (tenant_id, connection_version),
  CONSTRAINT organization_connection_version_credential_uid UNIQUE (credential_ref),
  CONSTRAINT organization_connection_version_binding_uid UNIQUE (binding_digest),
  CHECK (failure_reason_code IS NULL OR failure_reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT organization_connection_version_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenant(tenant_id)
    MATCH SIMPLE ON UPDATE RESTRICT ON DELETE RESTRICT NOT DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT organization_connection_version_generation_fk FOREIGN KEY (tenant_id, database_generation_id, database_ref)
    REFERENCES public.tenant_database_generation(tenant_id, database_generation_id, database_ref)
    MATCH SIMPLE ON UPDATE RESTRICT ON DELETE RESTRICT NOT DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT organization_connection_version_state_shape_chk CHECK (
    (version_state='CANDIDATE' AND observed_system_identifier IS NULL AND binding_digest IS NULL AND validated_at IS NULL AND draining_at IS NULL AND revoked_at IS NULL AND failed_at IS NULL)
    OR (version_state='VALIDATED' AND observed_system_identifier IS NOT NULL AND binding_digest IS NOT NULL AND validated_at IS NOT NULL AND draining_at IS NULL AND revoked_at IS NULL AND failed_at IS NULL)
    OR (version_state='DRAINING' AND observed_system_identifier IS NOT NULL AND binding_digest IS NOT NULL AND validated_at IS NOT NULL AND draining_at IS NOT NULL AND revoked_at IS NULL AND failed_at IS NULL)
    OR (version_state='REVOKED' AND observed_system_identifier IS NOT NULL AND binding_digest IS NOT NULL AND validated_at IS NOT NULL AND draining_at IS NOT NULL AND revoked_at IS NOT NULL AND failed_at IS NULL)
    OR (version_state='FAILED' AND failed_at IS NOT NULL)
  )
);

CREATE FUNCTION public.f4_connection_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.organization_connection_version WHERE tenant_id=NEW.tenant_id AND connection_version >= NEW.connection_version) THEN
      RAISE EXCEPTION 'Connection version must increase monotonically';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.connection_version IS DISTINCT FROM OLD.connection_version
     OR NEW.deployment_mode IS DISTINCT FROM OLD.deployment_mode OR NEW.database_generation_id IS DISTINCT FROM OLD.database_generation_id
     OR NEW.database_ref IS DISTINCT FROM OLD.database_ref OR NEW.credential_ref IS DISTINCT FROM OLD.credential_ref
     OR NEW.region_code IS DISTINCT FROM OLD.region_code OR NEW.residency_policy_version IS DISTINCT FROM OLD.residency_policy_version
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'Connection version identity is immutable'; END IF;
  IF OLD.observed_system_identifier IS NOT NULL AND NEW.observed_system_identifier IS DISTINCT FROM OLD.observed_system_identifier THEN RAISE EXCEPTION 'Observed identity is immutable'; END IF;
  IF OLD.binding_digest IS NOT NULL AND NEW.binding_digest IS DISTINCT FROM OLD.binding_digest THEN RAISE EXCEPTION 'Binding digest is immutable'; END IF;
  IF NEW.version_state IS DISTINCT FROM OLD.version_state AND NEW.version_state <> 'VALIDATED' THEN
    PERFORM 1 FROM public.organization_connection c
      WHERE c.tenant_id=OLD.tenant_id AND c.current_connection_version=OLD.connection_version
      FOR UPDATE;
    IF FOUND THEN RAISE EXCEPTION 'Current connection version cannot leave VALIDATED in place'; END IF;
  END IF;
  IF NOT ((OLD.version_state='CANDIDATE' AND NEW.version_state IN ('VALIDATED','FAILED'))
       OR (OLD.version_state='VALIDATED' AND NEW.version_state IN ('DRAINING','FAILED'))
       OR (OLD.version_state='DRAINING' AND NEW.version_state='REVOKED')) THEN
    RAISE EXCEPTION 'Connection version transition is not allowed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_connection_version_guard_before_write BEFORE INSERT OR UPDATE ON public.organization_connection_version
  FOR EACH ROW EXECUTE FUNCTION public.f4_connection_version_guard();

CREATE TABLE public.organization_connection (
  tenant_id UUID PRIMARY KEY,
  current_connection_version BIGINT,
  operational_state TEXT NOT NULL DEFAULT 'PENDING' CHECK (operational_state IN ('PENDING','AVAILABLE','BLOCKED','DRAINING','ARCHIVED')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  last_transition_code TEXT,
  transition_reason_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_connection_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenant(tenant_id)
    MATCH SIMPLE ON UPDATE RESTRICT ON DELETE RESTRICT NOT DEFERRABLE INITIALLY IMMEDIATE,
  CHECK (last_transition_code IS NULL OR last_transition_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CHECK (transition_reason_code IS NULL OR transition_reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT organization_connection_version_fk FOREIGN KEY (tenant_id, current_connection_version)
    REFERENCES public.organization_connection_version(tenant_id, connection_version)
    MATCH SIMPLE ON UPDATE RESTRICT ON DELETE RESTRICT NOT DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT organization_connection_pointer_chk CHECK (
    (operational_state='PENDING' AND current_connection_version IS NULL)
    OR (operational_state IN ('AVAILABLE','BLOCKED') AND current_connection_version IS NOT NULL)
    OR operational_state IN ('DRAINING','ARCHIVED')
  )
);

CREATE FUNCTION public.f4_connection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate_state TEXT; activation_ready BOOLEAN; organization_terminating BOOLEAN;
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN RAISE EXCEPTION 'Connection tenant is immutable'; END IF;
  IF NEW.current_connection_version IS DISTINCT FROM OLD.current_connection_version THEN
    SELECT version_state INTO candidate_state FROM public.organization_connection_version
      WHERE tenant_id=NEW.tenant_id AND connection_version=NEW.current_connection_version;
    IF candidate_state IS DISTINCT FROM 'VALIDATED' THEN RAISE EXCEPTION 'Current connection must reference a validated version'; END IF;
  END IF;
  IF NEW.operational_state IS DISTINCT FROM OLD.operational_state AND NOT (
    (OLD.operational_state='PENDING' AND NEW.operational_state IN ('AVAILABLE','DRAINING')) OR
    (OLD.operational_state='AVAILABLE' AND NEW.operational_state IN ('BLOCKED','DRAINING')) OR
    (OLD.operational_state='BLOCKED' AND NEW.operational_state IN ('AVAILABLE','DRAINING')) OR
    (OLD.operational_state='DRAINING' AND NEW.operational_state='ARCHIVED')) THEN
    RAISE EXCEPTION 'Connection transition is not allowed';
  END IF;
  IF OLD.operational_state IN ('PENDING','BLOCKED') AND NEW.operational_state='AVAILABLE' THEN
    IF OLD.operational_state='BLOCKED' AND (NEW.current_connection_version IS NOT DISTINCT FROM OLD.current_connection_version
       OR NEW.current_connection_version <= OLD.current_connection_version) THEN
      RAISE EXCEPTION 'Connection recovery requires a newer validated version';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.organization_provisioning p
      JOIN public.tenant_schema_state s ON s.tenant_id=p.tenant_id
      WHERE p.tenant_id=NEW.tenant_id AND p.status='READY' AND s.compatibility_state='COMPATIBLE'
    ) INTO activation_ready;
    IF NOT activation_ready THEN RAISE EXCEPTION 'Connection activation preconditions are not satisfied'; END IF;
  END IF;
  IF NEW.operational_state='DRAINING' AND OLD.operational_state IN ('PENDING','AVAILABLE','BLOCKED') THEN
    SELECT EXISTS (
      SELECT 1 FROM public.tenant t JOIN public.organization o ON o.id=t.organization_id
      WHERE t.tenant_id=NEW.tenant_id AND o.status='TERMINATING'
    ) INTO organization_terminating;
    IF NOT organization_terminating THEN RAISE EXCEPTION 'Connection draining requires a terminating organization'; END IF;
  END IF;
  NEW.revision := OLD.revision + 1; NEW.updated_at := NOW(); RETURN NEW;
END $$;
CREATE TRIGGER organization_connection_guard_before_update BEFORE UPDATE ON public.organization_connection
  FOR EACH ROW EXECUTE FUNCTION public.f4_connection_guard();

CREATE TABLE public.tenant_schema_state (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenant(tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  current_version TEXT,
  target_version TEXT,
  minimum_read_version TEXT,
  minimum_write_version TEXT,
  compatibility_state TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (compatibility_state IN ('UNKNOWN','COMPATIBLE','READ_ONLY','MIGRATION_REQUIRED','MIGRATING','INCOMPATIBLE','FAILED')),
  verified_capabilities JSONB,
  migration_lock_ref TEXT,
  lock_expires_at TIMESTAMPTZ,
  checked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  last_error_code TEXT,
  CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CHECK (verified_capabilities IS NULL OR jsonb_typeof(verified_capabilities)='object'),
  CHECK ((migration_lock_ref IS NULL) = (lock_expires_at IS NULL)),
  CHECK (migration_lock_ref IS NULL OR migration_lock_ref ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$'),
  CONSTRAINT tenant_schema_state_shape_chk CHECK (
    (compatibility_state='UNKNOWN' AND current_version IS NULL AND target_version IS NULL
      AND minimum_read_version IS NULL AND minimum_write_version IS NULL AND verified_capabilities IS NULL
      AND migration_lock_ref IS NULL AND checked_at IS NULL AND last_error_code IS NULL)
    OR
    (compatibility_state IN ('COMPATIBLE','READ_ONLY','MIGRATION_REQUIRED')
      AND current_version IS NOT NULL AND BTRIM(current_version)<>'' AND target_version IS NOT NULL AND BTRIM(target_version)<>''
      AND minimum_read_version IS NOT NULL AND BTRIM(minimum_read_version)<>''
      AND minimum_write_version IS NOT NULL AND BTRIM(minimum_write_version)<>''
      AND verified_capabilities IS NOT NULL AND jsonb_typeof(verified_capabilities)='object'
      AND checked_at IS NOT NULL AND migration_lock_ref IS NULL AND last_error_code IS NULL)
    OR
    (compatibility_state='MIGRATING' AND current_version IS NOT NULL AND BTRIM(current_version)<>''
      AND target_version IS NOT NULL AND BTRIM(target_version)<>'' AND minimum_read_version IS NOT NULL
      AND BTRIM(minimum_read_version)<>'' AND minimum_write_version IS NOT NULL AND BTRIM(minimum_write_version)<>''
      AND verified_capabilities IS NOT NULL AND jsonb_typeof(verified_capabilities)='object' AND checked_at IS NOT NULL
      AND migration_lock_ref IS NOT NULL AND BTRIM(migration_lock_ref)<>'' AND lock_expires_at IS NOT NULL
      AND lock_expires_at>checked_at AND last_error_code IS NULL)
    OR
    (compatibility_state='INCOMPATIBLE' AND current_version IS NOT NULL AND BTRIM(current_version)<>''
      AND target_version IS NOT NULL AND BTRIM(target_version)<>'' AND minimum_read_version IS NOT NULL
      AND BTRIM(minimum_read_version)<>'' AND minimum_write_version IS NOT NULL AND BTRIM(minimum_write_version)<>''
      AND verified_capabilities IS NOT NULL AND jsonb_typeof(verified_capabilities)='object' AND checked_at IS NOT NULL
      AND migration_lock_ref IS NULL AND last_error_code IS NOT NULL AND BTRIM(last_error_code)<>'')
    OR
    (compatibility_state='FAILED' AND checked_at IS NOT NULL AND migration_lock_ref IS NULL
      AND last_error_code IS NOT NULL AND BTRIM(last_error_code)<>'')
  )
);

CREATE FUNCTION public.f4_schema_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN RAISE EXCEPTION 'Schema tenant is immutable'; END IF;
  IF NEW.compatibility_state IS DISTINCT FROM OLD.compatibility_state AND NOT (
    (OLD.compatibility_state='UNKNOWN' AND NEW.compatibility_state IN ('COMPATIBLE','READ_ONLY','MIGRATION_REQUIRED','INCOMPATIBLE')) OR
    (OLD.compatibility_state IN ('COMPATIBLE','READ_ONLY') AND NEW.compatibility_state='MIGRATION_REQUIRED') OR
    (OLD.compatibility_state='MIGRATION_REQUIRED' AND NEW.compatibility_state IN ('MIGRATING','INCOMPATIBLE')) OR
    (OLD.compatibility_state='MIGRATING' AND NEW.compatibility_state IN ('COMPATIBLE','FAILED','INCOMPATIBLE')) OR
    (OLD.compatibility_state NOT IN ('INCOMPATIBLE','FAILED') AND NEW.compatibility_state='INCOMPATIBLE')) THEN
    RAISE EXCEPTION 'Schema compatibility transition is not allowed';
  END IF;
  IF NEW.revision IS DISTINCT FROM OLD.revision + 1 THEN RAISE EXCEPTION 'Schema revision must increase exactly once'; END IF;
  NEW.updated_at:=NOW(); RETURN NEW;
END $$;
CREATE TRIGGER tenant_schema_state_guard_before_update BEFORE UPDATE ON public.tenant_schema_state
  FOR EACH ROW EXECUTE FUNCTION public.f4_schema_state_guard();

CREATE TABLE public.organization_provisioning (
  organization_id UUID PRIMARY KEY REFERENCES public.organization(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  tenant_id UUID,
  tenant_assignment_state TEXT NOT NULL CHECK (tenant_assignment_state IN ('UNASSIGNED','ASSIGNED')),
  status TEXT NOT NULL CHECK (status IN ('NOT_STARTED','QUEUED','RUNNING','VERIFYING','READY','FAILED','CANCELLED')),
  current_step_code TEXT NOT NULL CHECK (current_step_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (BTRIM(idempotency_key) <> ''),
  manifest_version TEXT NOT NULL CHECK (BTRIM(manifest_version) <> ''),
  lock_ref TEXT,
  lock_expires_at TIMESTAMPTZ,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  last_error_code TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  CONSTRAINT organization_provisioning_tenant_fk FOREIGN KEY (tenant_id, organization_id)
    REFERENCES public.tenant(tenant_id, organization_id) MATCH SIMPLE ON UPDATE RESTRICT ON DELETE RESTRICT NOT DEFERRABLE INITIALLY IMMEDIATE,
  CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CHECK ((lock_ref IS NULL) = (lock_expires_at IS NULL)),
  CHECK (lock_ref IS NULL OR lock_ref ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$'),
  CHECK ((tenant_assignment_state='UNASSIGNED' AND tenant_id IS NULL AND status IN ('NOT_STARTED','QUEUED','RUNNING','FAILED','CANCELLED')) OR
         (tenant_assignment_state='ASSIGNED' AND tenant_id IS NOT NULL AND status IN ('QUEUED','RUNNING','VERIFYING','READY','FAILED','CANCELLED')))
);

CREATE FUNCTION public.f4_provisioning_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok BOOLEAN;
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.manifest_version IS DISTINCT FROM OLD.manifest_version THEN RAISE EXCEPTION 'Provisioning identity is immutable'; END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.tenant_assignment_state IS DISTINCT FROM OLD.tenant_assignment_state THEN
    IF NOT (OLD.tenant_assignment_state='UNASSIGNED' AND OLD.tenant_id IS NULL AND NEW.tenant_assignment_state='ASSIGNED' AND NEW.tenant_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Tenant assignment is write-once'; END IF;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status='NOT_STARTED' AND NEW.status='QUEUED') OR (OLD.status='QUEUED' AND NEW.status IN ('RUNNING','CANCELLED')) OR
    (OLD.status='RUNNING' AND NEW.status IN ('VERIFYING','FAILED','CANCELLED')) OR
    (OLD.status='VERIFYING' AND NEW.status IN ('READY','FAILED')) OR (OLD.status='FAILED' AND NEW.status IN ('QUEUED','CANCELLED'))) THEN
    RAISE EXCEPTION 'Provisioning transition is not allowed'; END IF;
  IF NEW.status='READY' THEN
    SELECT EXISTS (SELECT 1 FROM public.organization_connection_version v
      JOIN public.tenant_schema_state s ON s.tenant_id=v.tenant_id
      WHERE v.tenant_id=NEW.tenant_id AND v.version_state='VALIDATED' AND s.compatibility_state='COMPATIBLE') INTO ok;
    IF NOT ok THEN RAISE EXCEPTION 'Provisioning readiness preconditions are not satisfied'; END IF;
  END IF;
  NEW.revision:=OLD.revision+1; NEW.updated_at:=NOW(); RETURN NEW;
END $$;
CREATE TRIGGER organization_provisioning_guard_before_update BEFORE UPDATE ON public.organization_provisioning
  FOR EACH ROW EXECUTE FUNCTION public.f4_provisioning_guard();

CREATE TABLE public.tenant_health_observation (
  tenant_id UUID NOT NULL,
  connection_version BIGINT NOT NULL,
  health_state TEXT NOT NULL CHECK (health_state IN ('UNKNOWN','HEALTHY','DEGRADED','UNREACHABLE')),
  probe_type TEXT NOT NULL CHECK (probe_type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  observed_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_error_code TEXT,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (tenant_id, connection_version),
  FOREIGN KEY (tenant_id, connection_version) REFERENCES public.organization_connection_version(tenant_id, connection_version)
    MATCH SIMPLE ON UPDATE RESTRICT ON DELETE RESTRICT NOT DEFERRABLE INITIALLY IMMEDIATE,
  CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CHECK (expires_at > observed_at)
);

CREATE TABLE public.tenant_directory_event (
  event_id UUID PRIMARY KEY,
  tenant_id UUID,
  organization_id UUID,
  aggregate_type TEXT NOT NULL CHECK (aggregate_type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  aggregate_id UUID NOT NULL,
  action_code TEXT NOT NULL CHECK (action_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  from_state TEXT CHECK (from_state IS NULL OR (from_state ~ '^[A-Z][A-Z0-9_]*(\|[A-Z][A-Z0-9_]*)*$' AND CHAR_LENGTH(from_state) <= 64)),
  to_state TEXT CHECK (to_state IS NULL OR to_state ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  reason_code TEXT,
  correlation_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (BTRIM(idempotency_key) <> ''),
  intent_digest TEXT NOT NULL CHECK (intent_digest ~ '^[a-f0-9]{64}$'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload)='object'),
  CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  UNIQUE (idempotency_key, action_code),
  FOREIGN KEY (tenant_id) REFERENCES public.tenant(tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE FUNCTION public.f4_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Tenant directory events are append-only'; END $$;
CREATE TRIGGER tenant_directory_event_append_only BEFORE UPDATE OR DELETE ON public.tenant_directory_event
  FOR EACH ROW EXECUTE FUNCTION public.f4_event_append_only();

CREATE INDEX organization_connection_version_state_idx ON public.organization_connection_version (tenant_id, version_state, connection_version DESC);
CREATE INDEX organization_connection_state_idx ON public.organization_connection (operational_state, tenant_id);
CREATE INDEX tenant_schema_state_compatibility_idx ON public.tenant_schema_state (compatibility_state, tenant_id);
CREATE INDEX organization_provisioning_status_idx ON public.organization_provisioning (status, organization_id);
CREATE INDEX organization_provisioning_lock_expiry_idx ON public.organization_provisioning (lock_expires_at) WHERE lock_expires_at IS NOT NULL;
CREATE INDEX tenant_health_state_expiry_idx ON public.tenant_health_observation (health_state, expires_at);
CREATE INDEX tenant_directory_event_aggregate_time_idx ON public.tenant_directory_event (aggregate_type, aggregate_id, occurred_at DESC);
