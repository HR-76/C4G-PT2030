-- No implicit destruction of imported opportunities, observations or job evidence.
DO $$ BEGIN RAISE EXCEPTION 'FUNDING_TENDERS_DOWN_REQUIRES_EXPLICIT_ARCHIVAL_PLAN'; END $$;
