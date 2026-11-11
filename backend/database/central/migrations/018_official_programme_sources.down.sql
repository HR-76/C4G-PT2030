DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM opportunity_catalog.funding_run WHERE source_code IN ('INTERREG_EUROPE','POCTEP'))
 OR EXISTS(SELECT 1 FROM opportunity_catalog.provenance WHERE source_type='OFFICIAL_PROGRAMME') THEN
  RAISE EXCEPTION 'OFFICIAL_SOURCE_HISTORY_REQUIRES_018';
 END IF;
END $$;
ALTER TABLE opportunity_catalog.provenance DROP CONSTRAINT official_programme_namespace_check;
ALTER TABLE opportunity_catalog.provenance DROP CONSTRAINT provenance_source_type_check;
ALTER TABLE opportunity_catalog.provenance ADD CONSTRAINT provenance_source_type_check CHECK(source_type IN ('C4G_MANUAL','EU_FUNDING_API'));
ALTER TABLE opportunity_catalog.funding_run DROP CONSTRAINT funding_run_source_code_check;
ALTER TABLE opportunity_catalog.funding_run ADD CONSTRAINT funding_run_source_code_check CHECK(source_code IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS'));
