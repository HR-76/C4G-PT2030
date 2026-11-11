-- Candidaturas / Pipeline
CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  coordinator_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'IDENTIFICADO'
    CHECK (status IN ('IDENTIFICADO', 'INTERESSE', 'PREPARACAO', 'SUBMISSAO', 'APROVADO', 'REJEITADO', 'CANCELADO')),
  internal_deadline DATE,
  submitted_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS application_members (
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_in_application VARCHAR(100),
  PRIMARY KEY (application_id, user_id)
);

-- Notificações
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  related_opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  related_application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
  dedupe_key TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_applications_opportunity_status
  ON applications (opportunity_id, status);

-- Fontes de integração
CREATE TABLE IF NOT EXISTS integration_sources (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('API', 'EXCEL', 'SCRAPING', 'MANUAL')),
  base_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Histórico de execuções de integração
CREATE TABLE IF NOT EXISTS integration_runs (
  id SERIAL PRIMARY KEY,
  source_id INTEGER REFERENCES integration_sources(id),
  status VARCHAR(30) NOT NULL CHECK (status IN ('RUNNING', 'SUCCESS', 'ERROR')),
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP,
  records_found INTEGER DEFAULT 0,
  records_created INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  error_message TEXT
);

-- Histórico de importações Excel
CREATE TABLE IF NOT EXISTS import_batches (
  id SERIAL PRIMARY KEY,
  source VARCHAR(100) NOT NULL,
  filename TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'ERROR')),
  records_found INTEGER DEFAULT 0,
  records_created INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  error_message TEXT,
  imported_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP
);

-- Cache de códigos de referência da Facet API europeia
CREATE TABLE IF NOT EXISTS eu_reference_codes (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  raw_payload JSONB,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(code, category)
);

-- Seed: fontes de integração
INSERT INTO integration_sources (code, name, type, base_url) VALUES
  ('EU_FUNDING_TENDERS', 'EU Funding & Tenders Portal', 'API', 'https://api.tech.ec.europa.eu/search-api/prod/rest/search'),
  ('CORDIS', 'CORDIS - EU Research Projects', 'API', 'https://cordis.europa.eu'),
  ('PORTUGAL_2030', 'Portugal 2030 - Plano Anual de Avisos', 'EXCEL', NULL),
  ('ERASMUS', 'Erasmus+', 'API', 'https://api.tech.ec.europa.eu/search-api/prod/rest/search')
ON CONFLICT (code) DO NOTHING;
