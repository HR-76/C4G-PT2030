DO $$ BEGIN IF EXISTS(SELECT 1 FROM async_exec.outbox LIMIT 1) OR EXISTS(SELECT 1 FROM async_exec.inbox LIMIT 1) OR EXISTS(SELECT 1 FROM async_exec.effect_fence LIMIT 1) THEN RAISE EXCEPTION 'F9 rollback requires empty disposable schema'; END IF; END $$;
DROP SCHEMA async_exec CASCADE;
