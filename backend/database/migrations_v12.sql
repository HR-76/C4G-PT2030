CREATE TABLE IF NOT EXISTS password_setup_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_setup_tokens_user_id
  ON password_setup_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_password_setup_tokens_active
  ON password_setup_tokens(token_hash)
  WHERE used_at IS NULL;
