-- IRREVERSIBLE MIGRATION.
-- Identity is durable central data. This file deliberately aborts conventional
-- rollback so a migration runner cannot remove the ledger entry while leaving
-- users, identity references and privilege assignments in place.

DO $$
BEGIN
  RAISE EXCEPTION '000_central_identity_baseline is irreversible; use an approved additive forward migration';
END $$;
