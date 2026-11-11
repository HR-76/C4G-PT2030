-- Separate the total application budget from the amount allocated to UBI.
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS total_budget NUMERIC(14,2);

UPDATE applications
SET total_budget = university_budget
WHERE total_budget IS NULL
  AND university_budget IS NOT NULL;
