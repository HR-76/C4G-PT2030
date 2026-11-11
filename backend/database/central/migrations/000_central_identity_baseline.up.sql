-- C4G CENTRAL DATABASE IDENTITY BASELINE ONLY.
-- This prerequisite is deliberately separate from the F2 session migration.

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

CREATE TABLE public.global_user (
  id UUID PRIMARY KEY,
  display_name TEXT NOT NULL,
  primary_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  session_revocation_version BIGINT NOT NULL DEFAULT 1 CHECK (session_revocation_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX global_user_primary_email_lower_uidx
  ON public.global_user (LOWER(primary_email));

CREATE TABLE public.auth_identity_ref (
  id UUID PRIMARY KEY,
  global_user_id UUID NOT NULL REFERENCES public.global_user(id),
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_authenticated_at TIMESTAMPTZ,
  UNIQUE (issuer, subject)
);

CREATE TABLE public.platform_admin_assignment (
  id UUID PRIMARY KEY,
  global_user_id UUID NOT NULL REFERENCES public.global_user(id),
  role_code TEXT NOT NULL CHECK (role_code IN ('C4G_ADMIN', 'SUPPORT')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  granted_by UUID REFERENCES public.global_user(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX platform_admin_assignment_user_status_idx
  ON public.platform_admin_assignment (global_user_id, status);
