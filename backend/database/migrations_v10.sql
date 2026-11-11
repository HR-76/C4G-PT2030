CREATE TABLE IF NOT EXISTS application_partner_people (
  id SERIAL PRIMARY KEY,
  partner_id INTEGER NOT NULL REFERENCES application_partners(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  role VARCHAR(60) NOT NULL DEFAULT 'INVESTIGADOR'
    CHECK (role IN ('RESPONSAVEL', 'INVESTIGADOR', 'OUTRO')),
  research_area VARCHAR(200),
  contact VARCHAR(120),
  email VARCHAR(200),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_application_partner_people_partner
  ON application_partner_people(partner_id);
