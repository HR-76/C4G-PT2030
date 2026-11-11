-- Never discard collection history to make a downgrade possible.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM opportunity_catalog.funding_run WHERE source_code<>'EU_FUNDING_TENDERS') THEN
  RAISE EXCEPTION 'FUNDING_PROGRAMME_HISTORY_REQUIRES_017';
 END IF;
END $$;
ALTER TABLE opportunity_catalog.funding_run DROP CONSTRAINT funding_run_source_code_check;
ALTER TABLE opportunity_catalog.funding_run ADD CONSTRAINT funding_run_source_code_check CHECK(source_code='EU_FUNDING_TENDERS');
DROP INDEX opportunity_catalog.funding_one_active_run;
CREATE UNIQUE INDEX funding_one_active_run ON opportunity_catalog.funding_run(source_code) WHERE status IN ('QUEUED','RUNNING');
