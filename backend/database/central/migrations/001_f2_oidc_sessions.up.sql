-- C4G CENTRAL DATABASE ONLY. The precondition below must succeed before any
-- object is created. This migration must never run against a tenant or UBI DB.

DO $$
DECLARE
  identity_matches BOOLEAN := FALSE;
BEGIN
  IF to_regclass('public.c4g_database_identity') IS NULL THEN
    RAISE EXCEPTION 'Central database identity precondition is missing';
  END IF;
  EXECUTE 'SELECT EXISTS (
    SELECT 1 FROM public.c4g_database_identity
    WHERE product_code = $1 AND database_role = $2
  )' INTO identity_matches USING 'C4G', 'CENTRAL';
  IF NOT identity_matches THEN
    RAISE EXCEPTION 'Database is not identified as the C4G central database';
  END IF;
END $$;

-- connect-pg-simple payload. It contains application identity/assurance and
-- CSRF state only, never Keycloak tokens or credentials.
CREATE TABLE public.application_session_store (
  sid VARCHAR PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);

CREATE INDEX application_session_store_expire_idx
  ON public.application_session_store (expire);

CREATE TABLE public.oidc_transaction (
  sid VARCHAR NOT NULL,
  state TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  PRIMARY KEY (sid, state)
);

CREATE UNIQUE INDEX oidc_transaction_state_uidx ON public.oidc_transaction (state);
CREATE INDEX oidc_transaction_expiry_idx ON public.oidc_transaction (expires_at, consumed_at);

-- Normalized revocation metadata; revocation never searches session JSON.
CREATE TABLE public.application_session (
  sid VARCHAR PRIMARY KEY,
  global_user_id UUID NOT NULL REFERENCES public.global_user(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  revocation_version BIGINT NOT NULL CHECK (revocation_version > 0),
  created_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

CREATE INDEX application_session_global_user_status_version_idx
  ON public.application_session (global_user_id, status, revocation_version);

CREATE INDEX application_session_expiry_idx
  ON public.application_session (expires_at, status);
