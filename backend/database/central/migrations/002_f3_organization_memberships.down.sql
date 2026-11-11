-- Explicit rollback for 002_f3_organization_memberships.up.sql. CENTRAL ONLY.

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

DROP INDEX public.application_session_selected_organization_status_idx;
DROP INDEX public.application_session_selected_membership_status_idx;

ALTER TABLE public.application_session
  DROP CONSTRAINT application_session_selected_membership_fk,
  DROP CONSTRAINT application_session_selected_membership_version_chk,
  DROP CONSTRAINT application_session_organization_context_all_or_none_chk,
  DROP COLUMN selected_membership_version,
  DROP COLUMN selected_membership_id,
  DROP COLUMN selected_organization_id;

DROP TABLE public.organization_membership;
DROP TABLE public.organization;
