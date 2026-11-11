-- Performance indexes for search, listing and dashboard queries.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_opportunities_source_closing
ON opportunities (source, closing_date);

CREATE INDEX IF NOT EXISTS idx_opportunities_status_closing
ON opportunities (status, closing_date);

CREATE INDEX IF NOT EXISTS idx_opportunities_title_trgm
ON opportunities USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_opportunities_programme_trgm
ON opportunities USING gin (programme gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_opportunities_raw_call_title_trgm
ON opportunities USING gin ((raw_payload->>'callTitle') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_applications_title_trgm
ON applications USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_applications_updated_at
ON applications (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_applications_opportunity_updated_at
ON applications (opportunity_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_application_status_history_application_status_changed
ON application_status_history (application_id, to_status, changed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_integration_runs_source_started
ON integration_runs (source_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_batches_created
ON import_batches (created_at DESC);
