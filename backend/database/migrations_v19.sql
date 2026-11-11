-- Add external opportunity sources with implemented connectors.
INSERT INTO integration_sources (code, name, type, base_url, is_active)
VALUES
  (
    'UNDP_PROCUREMENT',
    'UNDP Procurement Notices',
    'API',
    'https://procurement-notices.undp.org/proc_notices_rss_feed.cfm',
    TRUE
  ),
  (
    'INTERREG_EUROPE',
    'Interreg Europe',
    'EXCEL',
    'https://www.interregeurope.eu/call-for-projects',
    TRUE
  ),
  (
    'POCTEP',
    'Interreg POCTEP',
    'SCRAPING',
    'https://www.poctep.eu/proximas-convocatorias/',
    TRUE
  )
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    type = EXCLUDED.type,
    base_url = EXCLUDED.base_url,
    is_active = TRUE;
