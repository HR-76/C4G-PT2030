DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM async_exec.outbox LIMIT 1) OR EXISTS (SELECT 1 FROM async_exec.inbox LIMIT 1)
    OR EXISTS (SELECT 1 FROM async_exec.execution LIMIT 1) OR EXISTS (SELECT 1 FROM async_exec.dead_letter LIMIT 1)
    OR EXISTS (SELECT 1 FROM async_exec.reconciliation_item LIMIT 1) THEN
    RAISE EXCEPTION 'F9 rollback requires empty disposable schemas';
  END IF;
END $$;
DROP SCHEMA async_exec CASCADE;
DROP SCHEMA pgboss CASCADE;
