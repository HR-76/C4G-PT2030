-- Add institution and bio fields to professor_profiles
ALTER TABLE professor_profiles
  ADD COLUMN IF NOT EXISTS institution VARCHAR(200),
  ADD COLUMN IF NOT EXISTS bio TEXT;
