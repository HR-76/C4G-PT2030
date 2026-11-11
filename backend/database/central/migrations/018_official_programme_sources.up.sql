-- Keep every identity, revision, relation and historical receipt unchanged.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM opportunity_catalog.funding_identity WHERE external_identifier ~* '^(INTERREG_EUROPE|POCTEP):') THEN
  RAISE EXCEPTION 'OFFICIAL_SOURCE_IDENTITY_RECONCILIATION_REQUIRED';
 END IF;
END $$;
ALTER TABLE opportunity_catalog.funding_run DROP CONSTRAINT funding_run_source_code_check;
ALTER TABLE opportunity_catalog.funding_run ADD CONSTRAINT funding_run_source_code_check
 CHECK(source_code IN ('EU_FUNDING_TENDERS','CORDIS','ERASMUS','INTERREG_EUROPE','POCTEP'));
ALTER TABLE opportunity_catalog.provenance DROP CONSTRAINT provenance_source_type_check;
ALTER TABLE opportunity_catalog.provenance ADD CONSTRAINT provenance_source_type_check
 CHECK(source_type IN ('C4G_MANUAL','EU_FUNDING_API','OFFICIAL_PROGRAMME'));
ALTER TABLE opportunity_catalog.provenance ADD CONSTRAINT official_programme_namespace_check
 CHECK(source_type<>'OFFICIAL_PROGRAMME' OR (source_namespace IN ('INTERREG_EUROPE','POCTEP') AND external_identifier IS NOT NULL AND external_identifier ~ ('^' || source_namespace || ':2021-2027:CALL:[1-9][0-9]{0,2}$')));
