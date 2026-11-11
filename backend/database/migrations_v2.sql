-- Campos adicionais na tabela opportunities para suportar Portugal 2030 e EU APIs
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS eligibility TEXT,
  ADD COLUMN IF NOT EXISTS aviso_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS fundo VARCHAR(100),
  ADD COLUMN IF NOT EXISTS nuts_ii VARCHAR(200),
  ADD COLUMN IF NOT EXISTS quadrimestre VARCHAR(10),
  ADD COLUMN IF NOT EXISTS modalidade VARCHAR(200),
  ADD COLUMN IF NOT EXISTS objetivo_especifico TEXT;

-- Índice para deduplicação por fonte + id externo
CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunities_source_external
  ON opportunities(source, external_id)
  WHERE external_id IS NOT NULL;

-- Índice para queries por programa
CREATE INDEX IF NOT EXISTS idx_opportunities_programme ON opportunities(programme);

-- Índice para queries por fundo
CREATE INDEX IF NOT EXISTS idx_opportunities_fundo ON opportunities(fundo);

-- Índice para queries por data de fecho
CREATE INDEX IF NOT EXISTS idx_opportunities_closing ON opportunities(closing_date);
