-- Deactivate UNDP Procurement source and hide previously imported opportunities.
UPDATE integration_sources
SET is_active = FALSE
WHERE code = 'UNDP_PROCUREMENT';

UPDATE opportunities
SET status = 'Cancelado',
    updated_at = CURRENT_TIMESTAMP
WHERE source = 'UNDP_PROCUREMENT'
  AND status <> 'Cancelado';
