-- Remove FCT from active/manual integration sources.
UPDATE integration_sources
SET is_active = FALSE
WHERE code = 'FCT';
