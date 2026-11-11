-- Explicit rollback for 001_f2_oidc_sessions.up.sql. CENTRAL DATABASE ONLY.

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

DROP TABLE public.application_session;
DROP TABLE public.oidc_transaction;
DROP TABLE public.application_session_store;
