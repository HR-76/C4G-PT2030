CREATE INDEX IF NOT EXISTS idx_applications_opportunity_status
  ON applications (opportunity_id, status);

