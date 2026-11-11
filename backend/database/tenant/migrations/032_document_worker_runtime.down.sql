REVOKE EXECUTE ON FUNCTION audit.append_event_v1(uuid,text,text,integer,text,text,audit.ledger_location,uuid,uuid,audit.actor_type,text,text,text,bigint,timestamptz,timestamptz,uuid,uuid,text,text,text,text,jsonb) FROM c4g_document_worker_runtime;
REVOKE EXECUTE ON FUNCTION audit.prepare_append_v1(uuid,text) FROM c4g_document_worker_runtime;
REVOKE UPDATE(state,queue_id,available_at,claim_owner,lease_until,fence,updated_at,published_at) ON async_exec.outbox FROM c4g_document_worker_runtime;
REVOKE UPDATE(state,claim_owner,lease_until,fence,result_code,execution_id,completed_at) ON async_exec.inbox FROM c4g_document_worker_runtime;
REVOKE SELECT,INSERT ON async_exec.inbox,async_exec.outbox FROM c4g_document_worker_runtime;
REVOKE USAGE ON SCHEMA async_exec,audit FROM c4g_document_worker_runtime;
