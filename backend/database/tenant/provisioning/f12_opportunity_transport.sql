-- Provision only on tenants registered for the F12 receipt worker.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'c4g_f12_opportunity_transport') THEN
    CREATE ROLE c4g_f12_opportunity_transport NOLOGIN NOINHERIT;
  END IF;
END $$;
GRANT USAGE ON SCHEMA async_exec TO c4g_f12_opportunity_transport;
GRANT SELECT, INSERT ON async_exec.inbox, async_exec.outbox TO c4g_f12_opportunity_transport;
GRANT UPDATE (state, claim_owner, lease_until, fence, result_code, execution_id, completed_at)
  ON async_exec.inbox TO c4g_f12_opportunity_transport;
GRANT UPDATE (state, queue_id, available_at, claim_owner, lease_until, fence, updated_at, published_at)
  ON async_exec.outbox TO c4g_f12_opportunity_transport;
COMMIT;
