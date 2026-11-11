-- C4G CENTRAL DATABASE ONLY. F3 organization and membership context.

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

CREATE TABLE public.organization (
  id UUID PRIMARY KEY,
  legal_name TEXT NOT NULL CHECK (BTRIM(legal_name) <> ''),
  display_name TEXT NOT NULL CHECK (BTRIM(display_name) <> ''),
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  type_code TEXT NOT NULL CHECK (type_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  status TEXT NOT NULL CHECK (status IN ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'TERMINATING', 'ARCHIVED')),
  reporting_currency TEXT NOT NULL CHECK (reporting_currency ~ '^[A-Z]{3}$'),
  mfa_policy_code TEXT NOT NULL CHECK (mfa_policy_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  data_residency_code TEXT CHECK (data_residency_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX organization_slug_lower_uidx ON public.organization (LOWER(slug));
CREATE INDEX organization_status_idx ON public.organization (status, id);

CREATE TABLE public.organization_membership (
  id UUID PRIMARY KEY,
  global_user_id UUID NOT NULL REFERENCES public.global_user(id),
  organization_id UUID NOT NULL REFERENCES public.organization(id),
  base_role_code TEXT NOT NULL CHECK (base_role_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  status TEXT NOT NULL CHECK (status IN ('PENDING_PROJECTION', 'ACTIVE', 'SUSPENDED', 'REMOVED')),
  membership_version BIGINT NOT NULL DEFAULT 1 CHECK (membership_version > 0),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  status_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (global_user_id, organization_id),
  UNIQUE (id, global_user_id, organization_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK (status <> 'ACTIVE' OR activated_at IS NOT NULL),
  CHECK (status <> 'SUSPENDED' OR suspended_at IS NOT NULL),
  CHECK (status <> 'REMOVED' OR removed_at IS NOT NULL)
);

CREATE INDEX organization_membership_user_eligibility_idx
  ON public.organization_membership (global_user_id, status, valid_from, valid_until);
CREATE INDEX organization_membership_organization_status_idx
  ON public.organization_membership (organization_id, status, global_user_id);

ALTER TABLE public.application_session
  ADD COLUMN selected_organization_id UUID,
  ADD COLUMN selected_membership_id UUID,
  ADD COLUMN selected_membership_version BIGINT,
  ADD CONSTRAINT application_session_organization_context_all_or_none_chk CHECK (
    (selected_organization_id IS NULL AND selected_membership_id IS NULL AND selected_membership_version IS NULL)
    OR
    (selected_organization_id IS NOT NULL AND selected_membership_id IS NOT NULL AND selected_membership_version IS NOT NULL)
  ),
  ADD CONSTRAINT application_session_selected_membership_version_chk CHECK (
    selected_membership_version IS NULL OR selected_membership_version > 0
  ),
  ADD CONSTRAINT application_session_selected_membership_fk FOREIGN KEY (
    selected_membership_id, global_user_id, selected_organization_id
  ) REFERENCES public.organization_membership (id, global_user_id, organization_id);

CREATE INDEX application_session_selected_membership_status_idx
  ON public.application_session (selected_membership_id, status)
  WHERE selected_membership_id IS NOT NULL;
CREATE INDEX application_session_selected_organization_status_idx
  ON public.application_session (selected_organization_id, status)
  WHERE selected_organization_id IS NOT NULL;
