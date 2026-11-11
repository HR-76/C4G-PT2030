-- EXPERIMENTAL STORAGE CANDIDATE. Not registered or executable by the migration runner.
-- This schema alone does not authenticate terminal evidence or enforce capacity.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.c4g_database_identity WHERE product_code='C4G' AND database_role='CENTRAL')
 THEN RAISE EXCEPTION 'CENTRAL_IDENTITY_REQUIRED'; END IF;
END $$;

CREATE SCHEMA capacity_authority AUTHORIZATION c4g_central_owner;
REVOKE ALL ON SCHEMA capacity_authority FROM PUBLIC;

CREATE TABLE capacity_authority.policy (
 policy_id integer PRIMARY KEY CHECK(policy_id=1),
 capacity bigint NOT NULL CHECK(capacity>0),
 reserved bigint NOT NULL CHECK(reserved>=0 AND reserved<capacity),
 policy_revision bigint NOT NULL CHECK(policy_revision>0)
);

CREATE TABLE capacity_authority.reservation (
 organization_id uuid NOT NULL,
 tenant_id uuid NOT NULL,
 database_generation_id uuid NOT NULL,
 root_execution_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>0),
 execution_id uuid NOT NULL,
 job_type text NOT NULL CHECK(job_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
 content_digest text NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'),
 binding_digest text NOT NULL CHECK(binding_digest ~ '^[a-f0-9]{64}$'),
 authority_epoch bigint NOT NULL CHECK(authority_epoch>0),
 priority text NOT NULL CHECK(priority IN ('NORMAL','CRITICAL')),
 state text NOT NULL CHECK(state IN ('RESERVED','SUPERSEDED','RELEASED')),
 terminal_proof_id uuid,
 PRIMARY KEY(organization_id,tenant_id,root_execution_id,generation),
 UNIQUE(organization_id,tenant_id,database_generation_id,root_execution_id,generation,execution_id,job_type,content_digest,binding_digest,authority_epoch),
 CHECK((state IN ('RESERVED','SUPERSEDED') AND terminal_proof_id IS NULL) OR (state='RELEASED' AND terminal_proof_id IS NOT NULL))
);
CREATE UNIQUE INDEX capacity_one_active_root ON capacity_authority.reservation(organization_id,tenant_id,root_execution_id) WHERE state='RESERVED';

CREATE TABLE capacity_authority.terminal_evidence (
 proof_id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 tenant_id uuid NOT NULL,
 database_generation_id uuid NOT NULL,
 root_execution_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>0),
 execution_id uuid NOT NULL,
 job_type text NOT NULL CHECK(job_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
 content_digest text NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'),
 binding_digest text NOT NULL CHECK(binding_digest ~ '^[a-f0-9]{64}$'),
 authority_epoch bigint NOT NULL CHECK(authority_epoch>0),
 outcome text NOT NULL CHECK(outcome IN ('SUCCESS','PERMANENT','CANCELLED','EXPIRED','AUTHORIZATION_REVOKED','INCOMPATIBLE','POISON_MESSAGE')),
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(proof_id,organization_id,tenant_id,database_generation_id,root_execution_id,generation,execution_id,job_type,content_digest,binding_digest,authority_epoch),
 FOREIGN KEY(organization_id,tenant_id,database_generation_id,root_execution_id,generation,execution_id,job_type,content_digest,binding_digest,authority_epoch)
   REFERENCES capacity_authority.reservation(organization_id,tenant_id,database_generation_id,root_execution_id,generation,execution_id,job_type,content_digest,binding_digest,authority_epoch)
);
ALTER TABLE capacity_authority.reservation ADD CONSTRAINT capacity_terminal_binding
 FOREIGN KEY(terminal_proof_id,organization_id,tenant_id,database_generation_id,root_execution_id,generation,execution_id,job_type,content_digest,binding_digest,authority_epoch)
 REFERENCES capacity_authority.terminal_evidence(proof_id,organization_id,tenant_id,database_generation_id,root_execution_id,generation,execution_id,job_type,content_digest,binding_digest,authority_epoch);

CREATE FUNCTION capacity_authority.guard_terminal_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'CAPACITY_TERMINAL_EVIDENCE_IMMUTABLE';
END $$;
CREATE TRIGGER capacity_terminal_evidence_immutable
 BEFORE UPDATE OR DELETE ON capacity_authority.terminal_evidence
 FOR EACH ROW EXECUTE FUNCTION capacity_authority.guard_terminal_evidence();

CREATE FUNCTION capacity_authority.guard_reservation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CAPACITY_RESERVATION_IMMUTABLE'; END IF;
 IF OLD.state IN ('RELEASED','SUPERSEDED') OR
    (NEW.organization_id,NEW.tenant_id,NEW.database_generation_id,NEW.root_execution_id,NEW.generation,NEW.execution_id,NEW.job_type,NEW.content_digest,NEW.binding_digest,NEW.authority_epoch,NEW.priority)
    IS DISTINCT FROM
    (OLD.organization_id,OLD.tenant_id,OLD.database_generation_id,OLD.root_execution_id,OLD.generation,OLD.execution_id,OLD.job_type,OLD.content_digest,OLD.binding_digest,OLD.authority_epoch,OLD.priority)
 THEN RAISE EXCEPTION 'CAPACITY_RESERVATION_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER capacity_reservation_immutable
 BEFORE UPDATE OR DELETE ON capacity_authority.reservation
 FOR EACH ROW EXECUTE FUNCTION capacity_authority.guard_reservation();

-- Candidate only: no functional role is granted EXECUTE until authorization,
-- tenant binding and integration with replay are implemented and verified.
CREATE FUNCTION capacity_authority.transfer_reservation(
 p_organization uuid,p_tenant uuid,p_root uuid,p_generation bigint,p_previous_execution uuid,p_next_execution uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous capacity_authority.reservation%ROWTYPE;
DECLARE following capacity_authority.reservation%ROWTYPE;
BEGIN
 IF p_organization IS NULL OR p_tenant IS NULL OR p_root IS NULL OR p_generation IS NULL
    OR p_generation<1 OR p_generation>=9223372036854775807 OR p_previous_execution IS NULL
    OR p_next_execution IS NULL OR p_previous_execution=p_next_execution
 THEN RAISE EXCEPTION 'CAPACITY_TRANSFER_INVALID'; END IF;
 SELECT * INTO previous FROM capacity_authority.reservation
  WHERE organization_id=p_organization AND tenant_id=p_tenant AND root_execution_id=p_root AND generation=p_generation FOR UPDATE;
 IF NOT FOUND OR previous.execution_id<>p_previous_execution THEN RAISE EXCEPTION 'CAPACITY_TRANSFER_CONFLICT'; END IF;
 IF previous.state='SUPERSEDED' THEN
  SELECT * INTO following FROM capacity_authority.reservation
   WHERE organization_id=p_organization AND tenant_id=p_tenant AND root_execution_id=p_root AND generation=p_generation+1;
  IF NOT FOUND OR following.execution_id<>p_next_execution OR
     (following.database_generation_id,following.job_type,following.content_digest,following.binding_digest,following.authority_epoch,following.priority)
     IS DISTINCT FROM
     (previous.database_generation_id,previous.job_type,previous.content_digest,previous.binding_digest,previous.authority_epoch,previous.priority)
  THEN RAISE EXCEPTION 'CAPACITY_TRANSFER_CONFLICT'; END IF;
  RETURN false;
 END IF;
 IF previous.state<>'RESERVED' THEN RAISE EXCEPTION 'CAPACITY_TRANSFER_NOT_RESERVED'; END IF;
 UPDATE capacity_authority.reservation SET state='SUPERSEDED'
  WHERE organization_id=p_organization AND tenant_id=p_tenant AND root_execution_id=p_root AND generation=p_generation;
 INSERT INTO capacity_authority.reservation(organization_id,tenant_id,database_generation_id,root_execution_id,generation,execution_id,job_type,content_digest,binding_digest,authority_epoch,priority,state)
  VALUES(previous.organization_id,previous.tenant_id,previous.database_generation_id,previous.root_execution_id,p_generation+1,p_next_execution,previous.job_type,previous.content_digest,previous.binding_digest,previous.authority_epoch,previous.priority,'RESERVED');
 RETURN true;
END $$;

-- Experimental serialization only: evidence is not authenticated by this function.
-- It must not be granted to a functional role or used for runtime release.
CREATE FUNCTION capacity_authority.release_reservation(
 p_organization uuid,p_tenant uuid,p_root uuid,p_generation bigint,p_execution uuid,p_proof uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_row capacity_authority.reservation%ROWTYPE;
BEGIN
 IF p_organization IS NULL OR p_tenant IS NULL OR p_root IS NULL OR p_generation IS NULL
    OR p_generation<1 OR p_execution IS NULL OR p_proof IS NULL THEN
   RAISE EXCEPTION 'CAPACITY_RELEASE_INVALID';
 END IF;
 SELECT * INTO current_row FROM capacity_authority.reservation
  WHERE organization_id=p_organization AND tenant_id=p_tenant AND root_execution_id=p_root AND generation=p_generation FOR UPDATE;
 IF NOT FOUND OR current_row.execution_id<>p_execution THEN RAISE EXCEPTION 'CAPACITY_RELEASE_CONFLICT'; END IF;
 IF current_row.state='RELEASED' AND current_row.terminal_proof_id=p_proof THEN RETURN false; END IF;
 IF current_row.state<>'RESERVED' THEN RAISE EXCEPTION 'CAPACITY_RELEASE_NOT_RESERVED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM capacity_authority.terminal_evidence e WHERE e.proof_id=p_proof
   AND (e.organization_id,e.tenant_id,e.database_generation_id,e.root_execution_id,e.generation,e.execution_id,e.job_type,e.content_digest,e.binding_digest,e.authority_epoch)
    =(current_row.organization_id,current_row.tenant_id,current_row.database_generation_id,current_row.root_execution_id,current_row.generation,current_row.execution_id,current_row.job_type,current_row.content_digest,current_row.binding_digest,current_row.authority_epoch))
 THEN RAISE EXCEPTION 'CAPACITY_RELEASE_PROOF_MISSING'; END IF;
 UPDATE capacity_authority.reservation SET state='RELEASED',terminal_proof_id=p_proof
  WHERE organization_id=p_organization AND tenant_id=p_tenant AND root_execution_id=p_root AND generation=p_generation;
 RETURN true;
END $$;

ALTER TABLE capacity_authority.policy OWNER TO c4g_central_owner;
ALTER TABLE capacity_authority.reservation OWNER TO c4g_central_owner;
ALTER TABLE capacity_authority.terminal_evidence OWNER TO c4g_central_owner;
ALTER FUNCTION capacity_authority.guard_terminal_evidence() OWNER TO c4g_central_owner;
ALTER FUNCTION capacity_authority.guard_reservation() OWNER TO c4g_central_owner;
ALTER FUNCTION capacity_authority.transfer_reservation(uuid,uuid,uuid,bigint,uuid,uuid) OWNER TO c4g_central_owner;
ALTER FUNCTION capacity_authority.release_reservation(uuid,uuid,uuid,bigint,uuid,uuid) OWNER TO c4g_central_owner;
REVOKE ALL ON ALL TABLES IN SCHEMA capacity_authority FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA capacity_authority FROM PUBLIC;
