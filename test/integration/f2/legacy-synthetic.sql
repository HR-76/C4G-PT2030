-- Disposable legacy fixture only. This is not a central migration and contains
-- no real data; it completes the current pilot schema required by bootstrap.
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT,
  title TEXT,
  message TEXT,
  related_opportunity_id INTEGER,
  related_application_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);
