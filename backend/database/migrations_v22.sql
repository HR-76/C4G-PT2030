-- UBI faculties, research centers, and investigator-center affiliation.
CREATE TABLE IF NOT EXISTS faculties (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS research_centers (
  id SERIAL PRIMARY KEY,
  faculty_id INTEGER NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
  name VARCHAR(220) NOT NULL,
  short_name VARCHAR(80),
  area VARCHAR(160),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (faculty_id, name)
);

CREATE TABLE IF NOT EXISTS professor_research_centers (
  professor_profile_id INTEGER NOT NULL REFERENCES professor_profiles(id) ON DELETE CASCADE,
  research_center_id INTEGER NOT NULL REFERENCES research_centers(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (professor_profile_id, research_center_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_professor_research_centers_one_primary
ON professor_research_centers (professor_profile_id)
WHERE is_primary = TRUE;

CREATE INDEX IF NOT EXISTS idx_research_centers_faculty
ON research_centers (faculty_id);

CREATE INDEX IF NOT EXISTS idx_professor_research_centers_center
ON professor_research_centers (research_center_id);

INSERT INTO faculties (name) VALUES
  ('Faculdade de Engenharia'),
  ('Faculdade de Ciencias Sociais e Humanas'),
  ('Faculdade de Artes e Letras'),
  ('Faculdade de Ciencias'),
  ('Faculdade de Ciencias da Saude')
ON CONFLICT (name) DO NOTHING;

WITH faculty_rows AS (
  SELECT id, name FROM faculties
)
INSERT INTO research_centers (faculty_id, name, short_name, area)
SELECT f.id, seed.name, seed.short_name, seed.area
FROM (
  VALUES
    ('Faculdade de Engenharia', 'FibEnTech - Materiais Fibrosos e Tecnologias Ambientais', 'FibEnTech', 'Textil / Ambiente'),
    ('Faculdade de Engenharia', 'C-MAST - Center for Mechanical and Aerospace Sciences and Technologies', 'C-MAST', 'Aeroespacial / Mecanica'),
    ('Faculdade de Engenharia', 'C-MADE - Centre of Materials and Civil Engineering for Sustainability', 'C-MADE', 'Engenharia Civil / Materiais'),
    ('Faculdade de Engenharia', 'CISE - Centro de Investigacao em Sistemas Electromecatronicos', 'CISE', 'Engenharia Eletromecanica'),
    ('Faculdade de Engenharia', 'IT-UBI - Instituto de Telecomunicacoes (Polo UBI)', 'IT-UBI', 'Telecomunicacoes / TIC'),
    ('Faculdade de Engenharia', 'AeroG / LAETA-UBI - Laboratorio Associado de Energia, Transportes e Aeronautica', 'AeroG / LAETA-UBI', 'Energia / Aeronautica'),
    ('Faculdade de Engenharia', 'GeoBioTec-UBI - Geobiociencias, Geoengenharias e Geotecnologias', 'GeoBioTec-UBI', 'Geociencias'),
    ('Faculdade de Engenharia', 'NOVA LINCS-UBI - Polo de Informatica', 'NOVA LINCS-UBI', 'Informatica / IA'),
    ('Faculdade de Engenharia', 'CiAUD - Centro de Investigacao em Arquitetura, Urbanismo e Design', 'CiAUD', 'Arquitetura / Design'),
    ('Faculdade de Ciencias Sociais e Humanas', 'NECE - Nucleo de Estudos em Ciencias Empresariais', 'NECE', 'Gestao / Empreendedorismo'),
    ('Faculdade de Ciencias Sociais e Humanas', 'CIDESD-UBI - Research Center in Sports Sciences, Health Sciences and Human Development', 'CIDESD-UBI', 'Ciencias do Desporto'),
    ('Faculdade de Ciencias Sociais e Humanas', 'CEFAGE-UBI - Center for Advanced Studies in Management and Economics', 'CEFAGE-UBI', 'Economia / Gestao'),
    ('Faculdade de Ciencias Sociais e Humanas', 'CIES-UBI - Centre for Research and Studies in Sociology', 'CIES-UBI', 'Sociologia'),
    ('Faculdade de Artes e Letras', 'LabCom - Comunicacao e Artes', 'LabCom', 'Comunicacao / Media'),
    ('Faculdade de Artes e Letras', 'Praxis - Centro de Filosofia, Politica e Cultura', 'Praxis', 'Filosofia / Politica'),
    ('Faculdade de Artes e Letras', 'iA* - Unidade de Investigacao em Artes', 'iA*', 'Artes'),
    ('Faculdade de Ciencias', 'CMA - Centro de Matematica e Aplicacoes', 'CMA', 'Matematica'),
    ('Faculdade de Ciencias', 'IDL-UBI - Instituto Dom Luiz (Polo UBI)', 'IDL-UBI', 'Geofisica e Ciencias da Terra'),
    ('Faculdade de Ciencias da Saude', 'RISE-Health - Research in Health and Data Science', 'RISE-Health', 'Saude / Biomedicina')
) AS seed(faculty_name, name, short_name, area)
INNER JOIN faculty_rows f ON f.name = seed.faculty_name
ON CONFLICT (faculty_id, name) DO UPDATE
SET short_name = EXCLUDED.short_name,
    area = EXCLUDED.area;
