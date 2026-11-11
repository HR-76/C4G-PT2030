-- IRREVERSIBLE MIGRATION.
-- A published tenant identity and its ledger are durable evidence. Disposable
-- test databases are removed as a whole instead of rolling this migration back.

DO $$
BEGIN
  RAISE EXCEPTION '000_tenant_control_baseline is irreversible; use an approved forward migration or discard the synthetic database';
END $$;
