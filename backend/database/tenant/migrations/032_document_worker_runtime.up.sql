DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4g_document_worker_runtime') THEN
    CREATE ROLE c4g_document_worker_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA async_exec,audit TO c4g_document_worker_runtime;
GRANT SELECT,INSERT ON async_exec.inbox,async_exec.outbox TO c4g_document_worker_runtime;
GRANT UPDATE(state,claim_owner,lease_until,fence,result_code,execution_id,completed_at) ON async_exec.inbox TO c4g_document_worker_runtime;
GRANT UPDATE(state,queue_id,available_at,claim_owner,lease_until,fence,updated_at,published_at) ON async_exec.outbox TO c4g_document_worker_runtime;
GRANT EXECUTE ON FUNCTION audit.prepare_append_v1(uuid,text) TO c4g_document_worker_runtime;
GRANT EXECUTE ON FUNCTION audit.append_event_v1(uuid,text,text,integer,text,text,audit.ledger_location,uuid,uuid,audit.actor_type,text,text,text,bigint,timestamptz,timestamptz,uuid,uuid,text,text,text,text,jsonb) TO c4g_document_worker_runtime;
REVOKE DELETE,TRUNCATE ON async_exec.inbox,async_exec.outbox FROM c4g_document_worker_runtime;
