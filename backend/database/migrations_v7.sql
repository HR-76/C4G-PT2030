-- Correct COMPETE 2030 official URL.
UPDATE integration_sources
SET base_url = 'https://www.compete2030.gov.pt'
WHERE code = 'COMPETE_2030';
