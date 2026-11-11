-- Partner identification records for applications in preparation.
CREATE TABLE IF NOT EXISTS application_partners (
  id SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  entity_name TEXT NOT NULL,
  country VARCHAR(120),
  research_area_interest TEXT,
  responsible_person VARCHAR(200),
  contact VARCHAR(120),
  email VARCHAR(200),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_application_partners_application
  ON application_partners(application_id);
