-- Explicit F12 replay capacity package. Apply after Central 036.
LOCK TABLE async_exec.replay_request IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT FROM async_exec.replay_request WHERE state='RESERVED') THEN
    RAISE EXCEPTION 'F12_CAPACITY_EXISTING_REPLAY_REQUIRES_RECONCILIATION';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='c4g_f12_capacity_replay') THEN
    CREATE ROLE c4g_f12_capacity_replay NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='c4g_f12_worker_directory') THEN
    CREATE ROLE c4g_f12_worker_directory NOLOGIN NOINHERIT;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('c4g_f12_capacity_replay','c4g_f12_worker_directory')
    AND (rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN
    RAISE EXCEPTION 'F12_CAPACITY_ROLE_INVALID';
  END IF;
END $$;
CREATE SCHEMA f12_replay_capacity AUTHORIZATION c4g_central_owner;
REVOKE ALL ON SCHEMA f12_replay_capacity FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO c4g_central_owner;
GRANT USAGE ON SCHEMA public,async_exec TO c4g_f12_worker_directory;
GRANT SELECT ON public.organization,public.tenant,public.organization_provisioning,
  public.tenant_workload_binding,public.tenant_workload_connection_version,public.organization_connection_version,
  public.tenant_database_generation,public.tenant_schema_state,public.tenant_health_observation TO c4g_f12_worker_directory;
GRANT SELECT,INSERT ON async_exec.execution,async_exec.dead_letter TO c4g_f12_worker_directory;
GRANT SELECT ON async_exec.replay_request,async_exec.execution,public.tenant,
  public.tenant_workload_binding,public.organization_connection_version,public.tenant_database_generation TO c4g_central_owner;
-- Row-share locking needs UPDATE on at least one column of each locked table.
GRANT UPDATE (state) ON async_exec.replay_request TO c4g_central_owner;
GRANT UPDATE (tenant_id) ON public.tenant,public.tenant_workload_binding,public.organization_connection_version,
  public.tenant_database_generation TO c4g_central_owner;

CREATE TABLE f12_replay_capacity.policy (
  id integer PRIMARY KEY CHECK (id=1),
  capacity bigint NOT NULL CHECK (capacity>0),
  critical_reserve bigint NOT NULL CHECK (critical_reserve>=0 AND critical_reserve<capacity)
);
CREATE TABLE f12_replay_capacity.reservation (
  organization_id uuid NOT NULL,
  root_execution_id uuid NOT NULL,
  generation bigint NOT NULL CHECK (generation>0),
  execution_id uuid NOT NULL UNIQUE,
  replay_request_id uuid NOT NULL UNIQUE REFERENCES async_exec.replay_request,
  tenant_id uuid NOT NULL,
  database_generation_id uuid NOT NULL,
  job_type text NOT NULL,
  content_digest text NOT NULL,
  binding_digest text NOT NULL,
  grant_version bigint NOT NULL,
  terminal_nonce uuid UNIQUE REFERENCES f12_service_authority.commit_guard,
  superseded_by uuid UNIQUE,
  CHECK (terminal_nonce IS NULL OR superseded_by IS NULL),
  PRIMARY KEY (organization_id,root_execution_id,generation)
);
CREATE UNIQUE INDEX f12_replay_one_active_root ON f12_replay_capacity.reservation(organization_id,root_execution_id)
  WHERE terminal_nonce IS NULL AND superseded_by IS NULL;

CREATE FUNCTION f12_replay_capacity.lock_root(p_org uuid, p_type text, p_root uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'F12_CAPACITY_ISOLATION_REQUIRED';
  END IF;
  PERFORM 1 FROM f12_replay_capacity.policy WHERE id=1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'F12_CAPACITY_POLICY_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    to_json(ARRAY[p_org::text,p_type,p_root::text])::text,43001306));
END $$;

CREATE FUNCTION f12_replay_capacity.lock_replay(p_org uuid,p_request uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE request async_exec.replay_request%ROWTYPE;
BEGIN
  SELECT * INTO STRICT request FROM async_exec.replay_request WHERE organization_id=p_org AND replay_request_id=p_request;
  PERFORM f12_replay_capacity.lock_root(p_org,request.job_type,request.root_execution_id);
  IF NOT EXISTS (SELECT 1 FROM async_exec.replay_request WHERE organization_id=p_org AND replay_request_id=p_request
    AND job_type=request.job_type AND root_execution_id=request.root_execution_id FOR UPDATE) THEN
    RAISE EXCEPTION 'F12_CAPACITY_REPLAY_CHANGED';
  END IF;
END $$;

CREATE FUNCTION f12_replay_capacity.reserve_replay(p_org uuid,p_request uuid,p_execution uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE request async_exec.replay_request%ROWTYPE;
DECLARE previous f12_replay_capacity.reservation%ROWTYPE;
DECLARE target record;
DECLARE grant_epoch bigint;
DECLARE normal_ceiling bigint;
DECLARE transferring boolean;
BEGIN
  PERFORM f12_replay_capacity.lock_replay(p_org,p_request);
  SELECT * INTO STRICT request FROM async_exec.replay_request WHERE organization_id=p_org AND replay_request_id=p_request;
  IF request.state NOT IN ('RESERVED','CONSUMED') OR request.reserved_execution_id IS DISTINCT FROM p_execution
    OR request.job_type NOT IN ('opportunity.duplicate.scan','opportunity.catalog.reconcile') THEN
    RAISE EXCEPTION 'F12_CAPACITY_REPLAY_CHANGED';
  END IF;
  SELECT * INTO previous FROM f12_replay_capacity.reservation WHERE replay_request_id=p_request;
  IF FOUND THEN
    IF previous.organization_id<>p_org OR previous.execution_id<>p_execution THEN RAISE EXCEPTION 'F12_CAPACITY_REPLAY_CHANGED'; END IF;
    RETURN true;
  END IF;
  IF request.state<>'RESERVED' THEN RAISE EXCEPTION 'F12_CAPACITY_REPLAY_CHANGED'; END IF;
  SELECT * INTO previous FROM f12_replay_capacity.reservation
    WHERE organization_id=p_org AND root_execution_id=request.root_execution_id ORDER BY generation DESC LIMIT 1;
  transferring := FOUND AND previous.terminal_nonce IS NULL AND previous.superseded_by IS NULL;
  IF transferring AND NOT EXISTS (SELECT 1 FROM async_exec.replay_request
    WHERE replay_request_id=previous.replay_request_id AND state='CONSUMED') THEN RETURN false; END IF;
  IF transferring AND NOT EXISTS (
    WITH RECURSIVE ancestry AS (
      SELECT execution_id,previous_execution_id,delivery_kind,1 AS depth
      FROM async_exec.execution WHERE organization_id=p_org AND execution_id=request.original_execution_id
        AND root_execution_id=request.root_execution_id AND job_type=request.job_type AND content_digest=request.content_digest
      UNION ALL
      SELECT e.execution_id,e.previous_execution_id,e.delivery_kind,a.depth+1 FROM ancestry a
      JOIN async_exec.execution e ON e.execution_id=a.previous_execution_id
      WHERE a.delivery_kind='RETRY' AND a.depth<5 AND e.organization_id=p_org
        AND e.root_execution_id=request.root_execution_id AND e.job_type=request.job_type AND e.content_digest=request.content_digest
    ) SELECT 1 FROM ancestry WHERE execution_id=previous.execution_id AND delivery_kind='REPLAY'
  ) THEN RETURN false; END IF;
  SELECT capacity-critical_reserve INTO normal_ceiling FROM f12_replay_capacity.policy WHERE id=1;
  IF NOT transferring AND (SELECT count(*) FROM f12_replay_capacity.reservation
    WHERE terminal_nonce IS NULL AND superseded_by IS NULL)>=normal_ceiling THEN RETURN false; END IF;
  SELECT v.database_generation_id,b.binding_digest INTO target
  FROM public.tenant_workload_binding b
  JOIN public.organization_connection_version v ON v.tenant_id=b.tenant_id AND v.connection_version=b.current_connection_version
  JOIN public.tenant_database_generation g ON g.tenant_id=v.tenant_id AND g.database_generation_id=v.database_generation_id
  JOIN public.tenant t ON t.tenant_id=b.tenant_id
  WHERE b.tenant_id=request.tenant_id AND t.organization_id=p_org AND b.workload='WORKER'
    AND b.lifecycle_status='AVAILABLE' AND b.compatibility_status='COMPATIBLE' AND b.provisioning_status='READY'
    AND v.version_state='VALIDATED' AND g.retired_at IS NULL
  FOR SHARE OF b,v,g,t;
  IF NOT FOUND THEN RAISE EXCEPTION 'F12_CAPACITY_TENANT_UNAVAILABLE'; END IF;
  SELECT version INTO grant_epoch FROM f12_service_authority.service_grant
    WHERE organization_id=p_org AND job_type=request.job_type AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'F12_CAPACITY_GRANT_UNAVAILABLE'; END IF;
  IF transferring THEN
    IF (previous.tenant_id,previous.database_generation_id,previous.binding_digest,previous.grant_version)
      IS DISTINCT FROM (request.tenant_id,target.database_generation_id,target.binding_digest,grant_epoch)
    THEN RETURN false; END IF;
    UPDATE f12_replay_capacity.reservation SET superseded_by=p_execution WHERE execution_id=previous.execution_id;
  END IF;
  INSERT INTO f12_replay_capacity.reservation VALUES
    (p_org,request.root_execution_id,COALESCE(previous.generation,0)+1,p_execution,p_request,request.tenant_id,
     target.database_generation_id,request.job_type,request.content_digest,target.binding_digest,grant_epoch,NULL,NULL);
  RETURN true;
END $$;

CREATE FUNCTION f12_replay_capacity.release(p_org uuid,p_root uuid,p_execution uuid,p_nonce uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_row f12_replay_capacity.reservation%ROWTYPE;
BEGIN
  SELECT * INTO STRICT current_row FROM f12_replay_capacity.reservation
    WHERE organization_id=p_org AND root_execution_id=p_root AND execution_id=p_execution;
  PERFORM f12_replay_capacity.lock_root(p_org,current_row.job_type,p_root);
  PERFORM 1 FROM async_exec.replay_request WHERE replay_request_id=current_row.replay_request_id FOR SHARE;
  SELECT * INTO STRICT current_row FROM f12_replay_capacity.reservation
    WHERE organization_id=p_org AND root_execution_id=p_root AND execution_id=p_execution FOR UPDATE;
  IF current_row.terminal_nonce IS NOT NULL THEN RETURN current_row.terminal_nonce=p_nonce; END IF;
  IF current_row.superseded_by IS NOT NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM async_exec.replay_request WHERE replay_request_id=current_row.replay_request_id
    AND reserved_execution_id=p_execution AND state='CONSUMED') THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM async_exec.replay_request WHERE organization_id=p_org AND root_execution_id=p_root
    AND (state='RESERVED' OR (state='APPROVED' AND not_after>clock_timestamp()))) THEN RETURN false; END IF;
  PERFORM 1 FROM public.tenant_workload_binding b
    JOIN public.organization_connection_version v ON v.tenant_id=b.tenant_id AND v.connection_version=b.current_connection_version
    JOIN public.tenant_database_generation g ON g.tenant_id=v.tenant_id AND g.database_generation_id=v.database_generation_id
    WHERE b.tenant_id=current_row.tenant_id AND b.workload='WORKER' AND b.binding_digest=current_row.binding_digest
      AND b.lifecycle_status='AVAILABLE' AND b.compatibility_status='COMPATIBLE' AND b.provisioning_status='READY'
      AND v.version_state='VALIDATED' AND v.database_generation_id=current_row.database_generation_id AND g.retired_at IS NULL
    FOR SHARE OF b,v,g;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM f12_service_authority.service_grant
    WHERE organization_id=p_org AND job_type=current_row.job_type AND version=current_row.grant_version AND active FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM f12_service_authority.commit_guard g WHERE g.transaction_id=p_nonce AND g.state='COMMITTED'
    AND (g.organization_id,g.tenant_id,g.database_generation_id,g.execution_id,g.job_type,g.content_digest,g.grant_version)
      =(p_org,current_row.tenant_id,current_row.database_generation_id,p_execution,current_row.job_type,current_row.content_digest,current_row.grant_version))
  THEN RETURN false; END IF;
  UPDATE f12_replay_capacity.reservation SET terminal_nonce=p_nonce WHERE execution_id=p_execution;
  RETURN true;
END $$;

CREATE FUNCTION f12_replay_capacity.pending_proofs(p_org uuid,p_after uuid)
RETURNS TABLE(root_execution_id uuid,execution_id uuid,transaction_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT r.root_execution_id,r.execution_id,g.transaction_id FROM f12_replay_capacity.reservation r
  JOIN f12_service_authority.commit_guard g ON g.organization_id=r.organization_id AND g.tenant_id=r.tenant_id
    AND g.database_generation_id=r.database_generation_id AND g.execution_id=r.execution_id
    AND g.job_type=r.job_type AND g.content_digest=r.content_digest AND g.grant_version=r.grant_version
    AND g.state<>'ROLLED_BACK'
  JOIN async_exec.replay_request q ON q.replay_request_id=r.replay_request_id AND q.state='CONSUMED'
  WHERE r.organization_id=p_org AND r.terminal_nonce IS NULL AND r.superseded_by IS NULL
    AND (p_after IS NULL OR r.execution_id>p_after)
  ORDER BY r.execution_id LIMIT 10
$$;

CREATE FUNCTION f12_replay_capacity.require_reservation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM f12_replay_capacity.reservation r WHERE r.replay_request_id=NEW.replay_request_id
    AND r.organization_id=NEW.organization_id AND r.root_execution_id=NEW.root_execution_id
    AND r.execution_id=NEW.reserved_execution_id) THEN
    RAISE EXCEPTION 'F12_CAPACITY_RESERVATION_REQUIRED';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER f12_replay_requires_capacity AFTER INSERT OR UPDATE ON async_exec.replay_request
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.state='RESERVED')
  EXECUTE FUNCTION f12_replay_capacity.require_reservation();

ALTER TABLE f12_replay_capacity.policy OWNER TO c4g_central_owner;
ALTER TABLE f12_replay_capacity.reservation OWNER TO c4g_central_owner;
ALTER FUNCTION f12_replay_capacity.lock_root(uuid,text,uuid) OWNER TO c4g_central_owner;
ALTER FUNCTION f12_replay_capacity.lock_replay(uuid,uuid) OWNER TO c4g_central_owner;
ALTER FUNCTION f12_replay_capacity.reserve_replay(uuid,uuid,uuid) OWNER TO c4g_central_owner;
ALTER FUNCTION f12_replay_capacity.release(uuid,uuid,uuid,uuid) OWNER TO c4g_central_owner;
ALTER FUNCTION f12_replay_capacity.pending_proofs(uuid,uuid) OWNER TO c4g_central_owner;
ALTER FUNCTION f12_replay_capacity.require_reservation() OWNER TO c4g_central_owner;
REVOKE ALL ON ALL TABLES IN SCHEMA f12_replay_capacity FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA f12_replay_capacity FROM PUBLIC;
GRANT USAGE ON SCHEMA f12_replay_capacity TO c4g_f12_capacity_replay,c4g_f12_guard_recovery;
GRANT USAGE ON SCHEMA async_exec TO c4g_f12_capacity_replay;
GRANT SELECT,INSERT ON async_exec.replay_request TO c4g_f12_capacity_replay;
GRANT UPDATE (state,approver_actor_id,approver_membership_id,approver_revocation_version,approval_evidence_digest,
  approved_at,not_after,reserved_execution_id,reservation_digest,consumed_at) ON async_exec.replay_request TO c4g_f12_capacity_replay;
GRANT SELECT ON async_exec.execution TO c4g_f12_capacity_replay;
GRANT UPDATE (state) ON async_exec.execution TO c4g_f12_capacity_replay;
GRANT USAGE ON SCHEMA audit TO c4g_f12_capacity_replay;
GRANT EXECUTE ON FUNCTION audit.prepare_append_v1(uuid,text),
  audit.append_event_v1(uuid,text,text,integer,text,text,audit.ledger_location,uuid,uuid,audit.actor_type,text,text,text,bigint,
    timestamptz,timestamptz,uuid,uuid,text,text,text,text,jsonb) TO c4g_f12_capacity_replay;
GRANT EXECUTE ON FUNCTION f12_replay_capacity.lock_replay(uuid,uuid),
  f12_replay_capacity.reserve_replay(uuid,uuid,uuid) TO c4g_f12_capacity_replay;
GRANT EXECUTE ON FUNCTION f12_replay_capacity.release(uuid,uuid,uuid,uuid),
  f12_replay_capacity.pending_proofs(uuid,uuid) TO c4g_f12_guard_recovery;
