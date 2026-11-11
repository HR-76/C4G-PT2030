-- Three pilot selections share a canonical central opportunity identity.
ALTER TABLE opportunity_catalog.funding_run DROP CONSTRAINT funding_run_source_code_check;
ALTER TABLE opportunity_catalog.funding_run ADD CONSTRAINT funding_run_source_code_check
 CHECK(source_code IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS'));
DROP INDEX opportunity_catalog.funding_one_active_run;
CREATE UNIQUE INDEX funding_one_active_run ON opportunity_catalog.funding_run((1))
 WHERE status IN ('QUEUED','RUNNING');
