CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(30) NOT NULL CHECK (role IN ('ADMIN', 'PROFESSOR')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS research_areas (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS professor_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department VARCHAR(150),
  orcid VARCHAR(50),
  keywords TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS professor_research_areas (
  professor_profile_id INTEGER NOT NULL REFERENCES professor_profiles(id) ON DELETE CASCADE,
  research_area_id INTEGER NOT NULL REFERENCES research_areas(id) ON DELETE CASCADE,
  PRIMARY KEY (professor_profile_id, research_area_id)
);

CREATE TABLE IF NOT EXISTS opportunities (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  programme VARCHAR(150),
  funding_entity VARCHAR(150),
  source VARCHAR(100),
  country_scope VARCHAR(30),
  opening_date DATE,
  closing_date DATE,
  budget NUMERIC(14,2),
  status VARCHAR(50),
  url TEXT,
  description TEXT,
  raw_payload JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Otimizacao de consultas por oportunidade e estado (inclui filtros com EXISTS em candidaturas)
CREATE INDEX IF NOT EXISTS idx_opportunities_closing ON opportunities (closing_date);

CREATE TABLE IF NOT EXISTS opportunity_research_areas (
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  research_area_id INTEGER NOT NULL REFERENCES research_areas(id) ON DELETE CASCADE,
  PRIMARY KEY (opportunity_id, research_area_id)
);
