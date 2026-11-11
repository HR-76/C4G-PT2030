-- Stable idempotency key for notification creation.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

WITH keyed AS (
  SELECT
    id,
    user_id,
    CASE
      WHEN type = 'NEW_OPPORTUNITY' THEN CONCAT_WS(':', type, COALESCE(related_opportunity_id::text, 'none'), 'none', 'created')
      WHEN type = 'OPPORTUNITY_OPENED' THEN CONCAT_WS(':', type, COALESCE(related_opportunity_id::text, 'none'), 'none', 'opened')
      WHEN type LIKE 'DEADLINE_%_DAYS' THEN CONCAT_WS(':', type, COALESCE(related_opportunity_id::text, 'none'), COALESCE(related_application_id::text, 'none'), split_part(type, '_', 2))
      ELSE CONCAT_WS(':', type, COALESCE(related_opportunity_id::text, 'none'), COALESCE(related_application_id::text, 'none'), 'legacy', id::text)
    END AS computed_key
  FROM notifications
),
ranked AS (
  SELECT
    id,
    computed_key,
    ROW_NUMBER() OVER (PARTITION BY user_id, computed_key ORDER BY id ASC) AS row_number
  FROM keyed
)
UPDATE notifications n
SET dedupe_key = CASE
  WHEN ranked.row_number = 1 THEN ranked.computed_key
  ELSE CONCAT(ranked.computed_key, ':duplicate:', n.id::text)
END
FROM ranked
WHERE n.id = ranked.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe_key
  ON notifications (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
