-- Run after the Central receipt package and pg-boss schema have been installed.
-- Give each role to a separate login. Provision queues with the pg-boss owner.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'c4g_f12_worker_directory') THEN
    CREATE ROLE c4g_f12_worker_directory NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'c4g_f12_worker_queue') THEN
    CREATE ROLE c4g_f12_worker_queue NOLOGIN NOINHERIT;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public, async_exec TO c4g_f12_worker_directory;
GRANT SELECT ON public.organization, public.tenant, public.organization_provisioning,
  public.tenant_workload_binding, public.tenant_workload_connection_version,
  public.organization_connection_version, public.tenant_database_generation,
  public.tenant_schema_state, public.tenant_health_observation TO c4g_f12_worker_directory;
GRANT SELECT, INSERT ON async_exec.execution, async_exec.dead_letter TO c4g_f12_worker_directory;

GRANT USAGE ON SCHEMA pgboss TO c4g_f12_worker_queue;
GRANT SELECT ON pgboss.version, pgboss.queue TO c4g_f12_worker_queue;
GRANT INSERT ON pgboss.job TO c4g_f12_worker_queue;
GRANT DELETE, INSERT, SELECT ON pgboss.job_common TO c4g_f12_worker_queue;
GRANT UPDATE (blocked, completed_on, heartbeat_on, output, pending_dependencies,
  retry_count, started_on, state) ON pgboss.job_common TO c4g_f12_worker_queue;
GRANT DELETE, INSERT, SELECT, UPDATE ON pgboss.instance TO c4g_f12_worker_queue;
COMMIT;
