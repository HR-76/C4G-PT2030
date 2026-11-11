CREATE SCHEMA f12_replay_failure AUTHORIZATION c4g_tenant_owner;
REVOKE ALL ON SCHEMA f12_replay_failure FROM PUBLIC;
CREATE TABLE f12_replay_failure.receipt (
  proof_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  database_generation_id uuid NOT NULL,
  root_execution_id uuid NOT NULL,
  replay_execution_id uuid NOT NULL UNIQUE,
  execution_id uuid NOT NULL,
  job_type text NOT NULL,
  content_digest text NOT NULL CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  fence bigint NOT NULL CHECK (fence>0),
  outcome text NOT NULL CHECK (outcome IN ('PERMANENT','CANCELLED','AUTHORIZATION_REVOKED','INCOMPATIBLE','POISON_MESSAGE','EXPIRED'))
);
ALTER TABLE f12_replay_failure.receipt OWNER TO c4g_tenant_owner;
REVOKE ALL ON f12_replay_failure.receipt FROM PUBLIC;
GRANT USAGE ON SCHEMA f12_replay_failure TO c4g_f12_receipt_issuer,c4g_opportunity_tenant_runtime;
GRANT INSERT ON f12_replay_failure.receipt TO c4g_f12_receipt_issuer;
GRANT SELECT ON async_exec.inbox,async_exec.outbox TO c4g_tenant_owner;
CREATE FUNCTION f12_replay_failure.check_terminal_inbox()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'F12_FAILURE_RECEIPT_IMMUTABLE'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM async_exec.inbox i JOIN async_exec.outbox o
      ON o.organization_id=i.organization_id AND (o.envelope->>'executionId')::uuid=i.execution_id
      AND o.lineage_version=1
    WHERE i.organization_id=NEW.organization_id AND i.job_type=NEW.job_type
      AND i.consumer='f12-opportunity-worker' AND i.execution_id=NEW.execution_id
      AND i.fence=NEW.fence AND i.digest_sha256=NEW.content_digest AND i.result_code=NEW.outcome
      AND i.state::text=CASE WHEN NEW.outcome='CANCELLED' THEN 'CANCELLED' ELSE 'FAILED' END
      AND i.xmin=pg_current_xact_id()::xid
      AND o.root_execution_id=NEW.root_execution_id AND o.content_digest=NEW.content_digest
      AND EXISTS (SELECT 1 FROM async_exec.outbox r WHERE r.organization_id=NEW.organization_id
        AND r.root_execution_id=NEW.root_execution_id AND r.delivery_kind='REPLAY'
        AND (r.envelope->>'executionId')::uuid=NEW.replay_execution_id AND r.content_digest=NEW.content_digest)
      AND EXISTS (SELECT 1 FROM c4g_system.tenant_identity m WHERE m.tenant_id=NEW.tenant_id
        AND m.database_generation_id=NEW.database_generation_id AND m.product_code='C4G' AND m.database_role='TENANT')
  ) THEN RAISE EXCEPTION 'F12_FAILURE_RECEIPT_TERMINAL_INBOX_REQUIRED'; END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION f12_replay_failure.check_terminal_inbox() OWNER TO c4g_tenant_owner;
REVOKE ALL ON FUNCTION f12_replay_failure.check_terminal_inbox() FROM PUBLIC;
CREATE TRIGGER check_terminal_inbox BEFORE INSERT OR UPDATE OR DELETE ON f12_replay_failure.receipt
  FOR EACH ROW EXECUTE FUNCTION f12_replay_failure.check_terminal_inbox();
CREATE FUNCTION f12_replay_failure.observe(p_org uuid,p_tenant uuid,p_database uuid,p_replay uuid)
RETURNS SETOF f12_replay_failure.receipt LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT r.* FROM f12_replay_failure.receipt r
  WHERE r.organization_id=p_org AND r.tenant_id=p_tenant AND r.database_generation_id=p_database
    AND r.replay_execution_id=p_replay AND EXISTS (
      SELECT 1 FROM c4g_system.tenant_identity i WHERE i.tenant_id=p_tenant AND i.database_generation_id=p_database
        AND i.product_code='C4G' AND i.database_role='TENANT')
$$;
ALTER FUNCTION f12_replay_failure.observe(uuid,uuid,uuid,uuid) OWNER TO c4g_tenant_owner;
REVOKE ALL ON FUNCTION f12_replay_failure.observe(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION f12_replay_failure.observe(uuid,uuid,uuid,uuid) TO c4g_opportunity_tenant_runtime;
