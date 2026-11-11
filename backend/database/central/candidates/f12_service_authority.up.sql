-- Isolated candidate. Dedicated roles are assigned to limited logins separately.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c4g_f12_guard_issuer') THEN
    CREATE ROLE c4g_f12_guard_issuer NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c4g_f12_guard_recovery') THEN
    CREATE ROLE c4g_f12_guard_recovery NOLOGIN NOINHERIT;
  END IF;
END $$;
CREATE SCHEMA f12_service_authority AUTHORIZATION c4g_central_owner;
REVOKE ALL ON SCHEMA f12_service_authority FROM PUBLIC;

CREATE TABLE f12_service_authority.service_grant (
  organization_id uuid NOT NULL REFERENCES public.organization(id),
  job_type text NOT NULL CHECK (job_type IN ('opportunity.duplicate.scan', 'opportunity.catalog.reconcile')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  active boolean NOT NULL,
  PRIMARY KEY (organization_id, job_type)
);

CREATE TABLE f12_service_authority.commit_guard (
  transaction_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  database_generation_id uuid NOT NULL REFERENCES public.tenant_database_generation(database_generation_id),
  job_type text NOT NULL,
  grant_version bigint NOT NULL CHECK (grant_version > 0),
  execution_id uuid NOT NULL,
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'PREPARED' CHECK (state IN ('PREPARED','UNKNOWN','COMMITTED','ROLLED_BACK')),
  FOREIGN KEY (organization_id, job_type) REFERENCES f12_service_authority.service_grant,
  FOREIGN KEY (tenant_id, organization_id) REFERENCES public.tenant(tenant_id, organization_id)
);

CREATE INDEX f12_pending_service_guard ON f12_service_authority.commit_guard(organization_id, job_type)
  WHERE state IN ('PREPARED','UNKNOWN');

CREATE FUNCTION f12_service_authority.check_grant_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'F12_GRANT_DELETE_FORBIDDEN'; END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'F12_GRANT_ISOLATION_REQUIRED';
  END IF;
  IF (NEW.organization_id, NEW.job_type) IS DISTINCT FROM (OLD.organization_id, OLD.job_type)
      OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'F12_GRANT_VERSION_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM f12_service_authority.commit_guard
    WHERE organization_id = OLD.organization_id AND job_type = OLD.job_type AND state IN ('PREPARED','UNKNOWN')) THEN
    RAISE EXCEPTION 'F12_SERVICE_GUARD_PENDING';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION f12_service_authority.check_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'F12_GUARD_DELETE_FORBIDDEN'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'state') IS DISTINCT FROM (to_jsonb(OLD) - 'state')
       OR OLD.state NOT IN ('PREPARED','UNKNOWN') OR NEW.state = 'PREPARED' THEN
      RAISE EXCEPTION 'F12_GUARD_TRANSITION_INVALID';
    END IF;
    RETURN NEW;
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' OR NEW.state <> 'PREPARED' THEN
    RAISE EXCEPTION 'F12_GUARD_PREPARATION_INVALID';
  END IF;
  SELECT version INTO current_version FROM f12_service_authority.service_grant
    WHERE organization_id = NEW.organization_id AND job_type = NEW.job_type AND active FOR UPDATE;
  IF NOT FOUND OR current_version <> NEW.grant_version THEN RAISE EXCEPTION 'F12_GRANT_STALE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_database_generation
    WHERE database_generation_id = NEW.database_generation_id AND tenant_id = NEW.tenant_id AND retired_at IS NULL) THEN
    RAISE EXCEPTION 'F12_DATABASE_GENERATION_INVALID';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER check_grant_change BEFORE UPDATE OR DELETE ON f12_service_authority.service_grant
  FOR EACH ROW EXECUTE FUNCTION f12_service_authority.check_grant_change();
CREATE TRIGGER check_guard BEFORE INSERT OR UPDATE OR DELETE ON f12_service_authority.commit_guard
  FOR EACH ROW EXECUTE FUNCTION f12_service_authority.check_guard();
ALTER TABLE f12_service_authority.service_grant OWNER TO c4g_central_owner;
ALTER TABLE f12_service_authority.commit_guard OWNER TO c4g_central_owner;
ALTER FUNCTION f12_service_authority.check_grant_change() OWNER TO c4g_central_owner;
ALTER FUNCTION f12_service_authority.check_guard() OWNER TO c4g_central_owner;
REVOKE ALL ON ALL TABLES IN SCHEMA f12_service_authority FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA f12_service_authority FROM PUBLIC;
GRANT USAGE ON SCHEMA f12_service_authority TO c4g_f12_guard_issuer, c4g_f12_guard_recovery;
GRANT SELECT (organization_id, job_type, version, active) ON f12_service_authority.service_grant TO c4g_f12_guard_issuer;
GRANT INSERT (transaction_id, organization_id, tenant_id, database_generation_id, job_type, grant_version,
  execution_id, content_digest) ON f12_service_authority.commit_guard TO c4g_f12_guard_issuer;
GRANT SELECT ON f12_service_authority.commit_guard TO c4g_f12_guard_recovery;
GRANT UPDATE (state) ON f12_service_authority.commit_guard TO c4g_f12_guard_recovery;
