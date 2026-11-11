-- Deactivate sources that should not appear as operational integrations.
UPDATE integration_sources
SET is_active = FALSE
WHERE code IN ('ANI', 'COMPETE_2030', 'OPENAIRE');

-- Ensure the Erasmus+ connector has a visible active source record.
INSERT INTO integration_sources (code, name, type, base_url, is_active)
VALUES (
  'ERASMUS',
  'Erasmus+',
  'API',
  'https://api.tech.ec.europa.eu/search-api/prod/rest/search',
  TRUE
)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    type = EXCLUDED.type,
    base_url = EXCLUDED.base_url,
    is_active = TRUE;
