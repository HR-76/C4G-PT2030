-- CENTRAL ONLY. Durable authority/tenant commit coordination, not tenant 008.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.c4g_database_identity WHERE product_code='C4G' AND database_role='CENTRAL')
  THEN RAISE EXCEPTION 'CENTRAL_IDENTITY_REQUIRED'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='c4g_authority_owner') THEN
    CREATE ROLE c4g_authority_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='c4g_authority_coordinator') THEN
    CREATE ROLE c4g_authority_coordinator NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='c4g_authority_runtime') THEN
    CREATE ROLE c4g_authority_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('c4g_authority_owner','c4g_authority_coordinator','c4g_authority_runtime')
    AND (rolcanlogin<>(rolname='c4g_authority_runtime') OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
  OR EXISTS(SELECT 1 FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member
    WHERE (m.rolname LIKE 'c4g_authority_%' AND NOT(r.rolname='c4g_authority_coordinator' AND m.rolname='c4g_authority_runtime' AND a.inherit_option AND NOT a.set_option AND NOT a.admin_option))
    OR (r.rolname LIKE 'c4g_authority_%' AND NOT((r.rolname='c4g_authority_owner' AND m.rolname='c4g_central_owner')
       OR (r.rolname='c4g_authority_coordinator' AND m.rolname='c4g_authority_runtime' AND a.inherit_option AND NOT a.set_option AND NOT a.admin_option))))
  THEN RAISE EXCEPTION 'AUTHORITY_ROLE_INVALID'; END IF;
END $$;
GRANT c4g_authority_owner TO c4g_central_owner;
GRANT CREATE ON SCHEMA public TO c4g_authority_owner;
GRANT c4g_authority_coordinator TO c4g_authority_runtime WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;
CREATE SCHEMA authority_api AUTHORIZATION c4g_authority_owner;
REVOKE ALL ON SCHEMA authority_api FROM PUBLIC,c4g_central_runtime;
GRANT USAGE ON SCHEMA authority_api TO c4g_authority_coordinator;

CREATE SEQUENCE public.authority_epoch_seq;
CREATE TABLE public.authority_scope_epoch (
  scope_key text PRIMARY KEY CHECK(scope_key='POLICY' OR scope_key ~ '^(ORG|SUBJECT|MEMBER):[0-9a-f-]{36}$' OR scope_key ~ '^SESSION:[a-f0-9]{64}$'),
  epoch bigint NOT NULL CHECK(epoch>0)
);
CREATE TABLE public.authority_write_request (
  request_id uuid PRIMARY KEY,
  scope_keys text[] NOT NULL CHECK(cardinality(scope_keys)>0),
  epoch bigint NOT NULL UNIQUE CHECK(epoch>0),
  state text NOT NULL CHECK(state IN('WAITING','APPLIED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deadline timestamptz NOT NULL,
  finished_at timestamptz,
  CHECK((state='WAITING')=(finished_at IS NULL))
);
CREATE INDEX authority_write_request_pending ON public.authority_write_request USING gin(scope_keys) WHERE state='WAITING';
CREATE TABLE public.authority_write_permit (
  transaction_id bigint PRIMARY KEY,
  backend_pid integer NOT NULL,
  scope_keys text[] NOT NULL,
  epoch bigint NOT NULL,
  request_id uuid NOT NULL REFERENCES public.authority_write_request(request_id),
  phase text NOT NULL CHECK(phase IN('REGISTER','APPLY')),
  CHECK (cardinality(scope_keys)>0)
);
CREATE TABLE public.authority_commit_guard (
  guard_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  session_digest text NOT NULL CHECK (session_digest ~ '^[a-f0-9]{64}$'),
  scope_keys text[] NOT NULL,
  protected_operations jsonb NOT NULL CHECK (jsonb_typeof(protected_operations)='array'),
  authority_versions jsonb NOT NULL CHECK (jsonb_typeof(authority_versions)='object'),
  normalized_assurance jsonb NOT NULL CHECK (jsonb_typeof(normalized_assurance)='object'),
  authority_epoch bigint NOT NULL UNIQUE,
  transaction_id uuid NOT NULL UNIQUE,
  correlation_id uuid NOT NULL,
  finalization_digest text NOT NULL CHECK(finalization_digest ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid,
  intention_digest text CHECK (intention_digest ~ '^[a-f0-9]{64}$'),
  source_binding jsonb NOT NULL CHECK (jsonb_typeof(source_binding)='object'),
  state text NOT NULL CHECK (state IN ('PREPARED','TENANT_COMMIT_UNKNOWN','TENANT_COMMITTED','ABORTED','RECOVERED')),
  reconciliation_result text CHECK (reconciliation_result IN ('COMMITTED','ROLLED_BACK','READ_TERMINAL')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deadline timestamptz NOT NULL,
  resolved_at timestamptz,
  CHECK (deadline>created_at),
  CHECK ((state IN ('PREPARED','TENANT_COMMIT_UNKNOWN'))=(resolved_at IS NULL)),
  CHECK ((state IN ('PREPARED','TENANT_COMMIT_UNKNOWN'))=(reconciliation_result IS NULL))
  ,CHECK (state<>'ABORTED' OR reconciliation_result='ROLLED_BACK')
  ,CHECK (state<>'TENANT_COMMITTED' OR reconciliation_result IN ('COMMITTED','READ_TERMINAL'))
);
CREATE INDEX authority_guard_pending_scope ON public.authority_commit_guard USING gin(scope_keys)
  WHERE state IN ('PREPARED','TENANT_COMMIT_UNKNOWN');
CREATE INDEX authority_guard_pending_deadline ON public.authority_commit_guard(deadline,guard_id)
  WHERE state IN ('PREPARED','TENANT_COMMIT_UNKNOWN');
CREATE FUNCTION public.authority_protocol_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'AUTHORITY_GUARD_DELETE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF current_setting('authority.finalization_permit',true) IS NULL
    OR encode(sha256(convert_to(current_setting('authority.finalization_permit',true),'UTF8')),'hex')<>OLD.finalization_digest
  THEN RAISE EXCEPTION 'AUTHORITY_FINALIZATION_PERMIT_REQUIRED' USING ERRCODE='42501'; END IF;
  IF (to_jsonb(NEW)-ARRAY['state','reconciliation_result','updated_at','resolved_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','reconciliation_result','updated_at','resolved_at'])
  THEN RAISE EXCEPTION 'AUTHORITY_GUARD_BINDING_IMMUTABLE'; END IF;
  IF OLD.state NOT IN ('PREPARED','TENANT_COMMIT_UNKNOWN') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)
    OR OLD.state='TENANT_COMMIT_UNKNOWN' AND NEW.state='PREPARED'
  THEN RAISE EXCEPTION 'AUTHORITY_PROTOCOL_REGRESSION'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER authority_protocol_guard BEFORE UPDATE OR DELETE ON public.authority_commit_guard
  FOR EACH ROW EXECUTE FUNCTION public.authority_protocol_guard();

-- The coordinator owns the F5 source. No HTTP/admin API is introduced here.
CREATE TABLE public.authority_f5_state (
  organization_id uuid NOT NULL REFERENCES public.organization(id),
  membership_id uuid NOT NULL REFERENCES public.organization_membership(id),
  authorization_version bigint NOT NULL CHECK (authorization_version>0),
  policy_version text NOT NULL CHECK (policy_version ~ '^[a-zA-Z0-9_.-]{1,128}$'),
  assurance_requirements jsonb NOT NULL CHECK (jsonb_typeof(assurance_requirements)='object'),
  grants jsonb NOT NULL CHECK (jsonb_typeof(grants)='array'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id,membership_id)
);

CREATE FUNCTION public.authority_metadata_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(43001306,1);
  RETURN NULL;
END $$;
CREATE TRIGGER authority_guard_first_lock BEFORE INSERT OR UPDATE OR DELETE ON public.authority_commit_guard
  FOR EACH STATEMENT EXECUTE FUNCTION public.authority_metadata_lock();
CREATE FUNCTION public.authority_require_write() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE keys text[]; old_row jsonb; new_row jsonb; critical boolean := true;
BEGIN
  IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
  IF TG_TABLE_NAME='application_session' THEN
    keys:=ARRAY['SESSION:'||encode(sha256(convert_to(COALESCE(new_row->>'sid',old_row->>'sid'),'UTF8')),'hex')];
    keys:=keys||ARRAY['SUBJECT:'||COALESCE(new_row->>'global_user_id',old_row->>'global_user_id')];
    IF TG_OP='UPDATE' THEN
      critical:=(new_row-ARRAY['last_seen_at']) IS DISTINCT FROM (old_row-ARRAY['last_seen_at']);
    END IF;
    IF TG_OP='INSERT' THEN critical:=false; END IF;
  ELSIF TG_TABLE_NAME='application_session_store' THEN
    keys:=ARRAY['SESSION:'||encode(sha256(convert_to(COALESCE(new_row->>'sid',old_row->>'sid'),'UTF8')),'hex')];
    keys:=keys||ARRAY(SELECT 'SUBJECT:'||global_user_id::text FROM public.application_session WHERE sid=COALESCE(new_row->>'sid',old_row->>'sid'));
    critical:=TG_OP='DELETE' OR (TG_OP='UPDATE' AND
      ((new_row#>'{sess,auth}') IS DISTINCT FROM (old_row#>'{sess,auth}') OR (new_row->>'expire') IS DISTINCT FROM (old_row->>'expire')));
  ELSIF TG_TABLE_NAME='global_user' THEN
    keys:=ARRAY['SUBJECT:'||COALESCE(new_row->>'id',old_row->>'id')];
    critical:=TG_OP='DELETE' OR (TG_OP='UPDATE' AND
      ROW(new_row->>'status',new_row->>'session_revocation_version') IS DISTINCT FROM
      ROW(old_row->>'status',old_row->>'session_revocation_version'));
  ELSIF TG_TABLE_NAME='organization' THEN
    keys:=ARRAY['ORG:'||COALESCE(new_row->>'id',old_row->>'id')];
    critical:=TG_OP='DELETE' OR (TG_OP='UPDATE' AND
      ROW(new_row->>'status',new_row->>'mfa_policy_code') IS DISTINCT FROM
      ROW(old_row->>'status',old_row->>'mfa_policy_code'));
  ELSIF TG_TABLE_NAME='authority_scope_epoch' THEN
    keys:=ARRAY[COALESCE(new_row->>'scope_key',old_row->>'scope_key')];
    IF TG_OP='UPDATE' AND (NEW.scope_key<>OLD.scope_key OR NEW.epoch<=OLD.epoch)
    THEN RAISE EXCEPTION 'AUTHORITY_EPOCH_REGRESSION'; END IF;
  ELSE
    keys:=ARRAY['MEMBER:'||COALESCE(new_row->>'membership_id',new_row->>'id',old_row->>'membership_id',old_row->>'id')];
    critical:=TG_TABLE_NAME='authority_f5_state' OR TG_OP<>'INSERT';
    IF TG_TABLE_NAME='authority_f5_state' AND TG_OP<>'DELETE' THEN
      IF NOT EXISTS(SELECT 1 FROM public.organization_membership WHERE id=(new_row->>'membership_id')::uuid
        AND organization_id=(new_row->>'organization_id')::uuid) THEN RAISE EXCEPTION 'F5_MEMBERSHIP_MISMATCH'; END IF;
      IF TG_OP='UPDATE' AND (NEW.authorization_version<=OLD.authorization_version
        OR NEW.organization_id<>OLD.organization_id OR NEW.membership_id<>OLD.membership_id)
      THEN RAISE EXCEPTION 'F5_AUTHORITY_VERSION_REGRESSION'; END IF;
    END IF;
  END IF;
  IF critical THEN
    IF NOT EXISTS (SELECT 1 FROM public.authority_write_permit p JOIN public.authority_write_request r ON r.request_id=p.request_id
      WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.scope_keys && keys AND r.state='WAITING'
      AND p.phase=CASE WHEN TG_TABLE_NAME='authority_scope_epoch' THEN 'REGISTER' ELSE 'APPLY' END)
    THEN RAISE EXCEPTION 'AUTHORITY_COORDINATOR_REQUIRED'; END IF;
    IF TG_TABLE_NAME<>'authority_scope_epoch' AND EXISTS (SELECT 1 FROM public.authority_commit_guard WHERE scope_keys && keys
      AND state IN ('PREPARED','TENANT_COMMIT_UNKNOWN'))
    THEN RAISE EXCEPTION 'AUTHORITY_GUARD_PENDING'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE FUNCTION public.authority_effect_commit_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE old_row jsonb; new_row jsonb; critical boolean;
BEGIN
  IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
  critical:=TG_OP<>'INSERT';
  IF TG_TABLE_NAME='application_session' AND TG_OP='UPDATE' THEN
    critical:=(new_row-ARRAY['last_seen_at']) IS DISTINCT FROM (old_row-ARRAY['last_seen_at']);
  ELSIF TG_TABLE_NAME='application_session_store' AND TG_OP='UPDATE' THEN
    critical:=(new_row#>'{sess,auth}') IS DISTINCT FROM (old_row#>'{sess,auth}') OR (new_row->>'expire') IS DISTINCT FROM (old_row->>'expire');
  ELSIF TG_TABLE_NAME='global_user' AND TG_OP='UPDATE' THEN
    critical:=ROW(new_row->>'status',new_row->>'session_revocation_version') IS DISTINCT FROM ROW(old_row->>'status',old_row->>'session_revocation_version');
  ELSIF TG_TABLE_NAME='organization' AND TG_OP='UPDATE' THEN
    critical:=ROW(new_row->>'status',new_row->>'mfa_policy_code') IS DISTINCT FROM ROW(old_row->>'status',old_row->>'mfa_policy_code');
  ELSIF TG_TABLE_NAME='authority_f5_state' THEN critical:=true;
  END IF;
  IF critical AND NOT EXISTS(SELECT 1 FROM public.authority_write_permit p JOIN public.authority_write_request r ON r.request_id=p.request_id
    WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.phase='APPLY' AND r.state='APPLIED')
  THEN RAISE EXCEPTION 'AUTHORITY_WRITE_NOT_FINALIZED'; END IF;
  RETURN NULL;
END $$;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['application_session','application_session_store','global_user','organization','organization_membership','authority_f5_state'] LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER authority_effect_commit_guard AFTER INSERT OR UPDATE OR DELETE ON public.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.authority_effect_commit_guard()',tab);
  END LOOP;
END $$;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['application_session','application_session_store','global_user','organization','organization_membership','authority_f5_state','authority_scope_epoch'] LOOP
    IF tab='application_session' THEN
      EXECUTE 'CREATE TRIGGER authority_first_lock BEFORE INSERT OR DELETE OR UPDATE OF global_user_id,status,revocation_version,expires_at,selected_organization_id,selected_membership_id,selected_membership_version,revoked_at,revocation_reason ON public.application_session FOR EACH STATEMENT EXECUTE FUNCTION public.authority_metadata_lock()';
    ELSE
      EXECUTE format('CREATE TRIGGER authority_first_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.authority_metadata_lock()',tab);
    END IF;
    EXECUTE format('CREATE TRIGGER authority_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.authority_require_write()',tab);
  END LOOP;
END $$;
REVOKE ALL ON public.authority_commit_guard,public.authority_write_permit,public.authority_f5_state,public.authority_scope_epoch,public.authority_write_request FROM PUBLIC,c4g_central_runtime;
REVOKE ALL ON SEQUENCE public.authority_epoch_seq FROM PUBLIC,c4g_central_runtime;
REVOKE ALL ON FUNCTION public.authority_metadata_lock(),public.authority_require_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.authority_protocol_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.authority_effect_commit_guard() FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO c4g_authority_owner;
GRANT SELECT ON public.c4g_database_identity,public.global_user,public.organization,public.organization_membership,
  public.application_session,public.application_session_store,public.oidc_transaction TO c4g_authority_owner;
GRANT UPDATE(status,session_revocation_version,updated_at) ON public.global_user TO c4g_authority_owner;
GRANT UPDATE(status,mfa_policy_code,updated_at) ON public.organization TO c4g_authority_owner;
GRANT UPDATE ON public.organization_membership TO c4g_authority_owner;
GRANT INSERT,UPDATE,DELETE ON public.application_session,public.application_session_store,public.oidc_transaction TO c4g_authority_owner;
-- Private closed query catalog. No caller-supplied SQL is executed.
CREATE FUNCTION authority_api.execute(query_code text, parameters text[], final_permit text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $authority$
DECLARE statement text; parameter_count integer; i integer; result_rows jsonb; affected bigint; guard_digest text; previous_permit text;
BEGIN
 IF session_user<>'c4g_authority_runtime' THEN RAISE EXCEPTION 'AUTHORITY_LOGIN_REQUIRED' USING ERRCODE='42501'; END IF;
 CASE query_code
    WHEN 'af4a3694165aa007e70a7d55774ceb2ad34445e7ab570a004f2f98231a71f2b9' THEN statement:='SELECT om.id AS membership_id, om.organization_id, om.membership_version, om.base_role_code, org.display_name, org.slug FROM public.organization_membership om INNER JOIN public.global_user gu ON gu.id = om.global_user_id INNER JOIN public.organization org ON org.id = om.organization_id WHERE om.global_user_id = $1 AND gu.status = ''ACTIVE'' AND org.status = ''ACTIVE'' AND om.status = ''ACTIVE'' AND om.valid_from <= $2 AND (om.valid_until IS NULL OR om.valid_until > $2) ORDER BY org.display_name ASC, org.id ASC';
    WHEN '44688132ef682495a6c44b8bf37f7c4296ced91b469fe399ea02a1f8c0b97979' THEN statement:='SELECT om.id AS membership_id, om.organization_id, om.membership_version, om.base_role_code, org.display_name, org.slug FROM public.organization_membership om INNER JOIN public.global_user gu ON gu.id = om.global_user_id INNER JOIN public.organization org ON org.id = om.organization_id WHERE om.global_user_id = $1 AND om.organization_id = $3 AND gu.status = ''ACTIVE'' AND org.status = ''ACTIVE'' AND om.status = ''ACTIVE'' AND om.valid_from <= $2 AND (om.valid_until IS NULL OR om.valid_until > $2) FOR SHARE OF gu, org, om';
    WHEN 'e25a95eb83dfe403b8fb0d2f289ede1ff3b1f1d2c87bc95479ec687ab3cd8f4a' THEN statement:='SELECT om.id AS membership_id, om.organization_id, om.membership_version, om.base_role_code, org.display_name, org.slug FROM public.organization_membership om INNER JOIN public.global_user gu ON gu.id = om.global_user_id INNER JOIN public.organization org ON org.id = om.organization_id WHERE om.id = $1 AND om.organization_id = $3 AND om.membership_version = $4 AND gu.status = ''ACTIVE'' AND org.status = ''ACTIVE'' AND om.status = ''ACTIVE'' AND om.valid_from <= $2 AND (om.valid_until IS NULL OR om.valid_until > $2) FOR SHARE OF gu, org, om';
 WHEN 'bcd937c3e242e10dc1820acd6da3f697899882c364d4708295fbfc98e4c1901a' THEN statement:='SELECT EXISTS(SELECT 1 FROM public.c4g_database_identity WHERE product_code=''C4G'' AND database_role=''CENTRAL'') AS valid';
 WHEN 'ce6e69a7436800b21410b014c26e8d17fbe7954e9121ab415f98ffb9bed16f36' THEN statement:='SELECT * FROM public.authority_commit_guard WHERE guard_id=$1 FOR UPDATE';
 WHEN '0aa8c172756157cfaed54f121f10bc1efd94e5223dc2ef9a78d8c830d67a3e25' THEN statement:='UPDATE public.authority_commit_guard SET state=$2,reconciliation_result=$3, updated_at=clock_timestamp(),resolved_at=clock_timestamp() WHERE guard_id=$1 RETURNING *';
 WHEN 'ae22038b5afeba0b1eb999e491b25e5672375a21aaa0e6e1ac92c844ddecd377' THEN statement:='SELECT * FROM public.authority_commit_guard WHERE guard_id=$1';
 WHEN '45ea8f5b255424d183251657ee6535e56413bae4ce5b2681d223eb697a6598f1' THEN statement:='INSERT INTO public.authority_write_request(request_id,scope_keys,epoch,state,deadline) VALUES($1,$2,nextval(''public.authority_epoch_seq''),''WAITING'',$3)';
 WHEN '4962a2804272dd090ee8bfb33319825d5d5d1ae5c534d257c4d60d9a0faed5aa' THEN statement:='INSERT INTO public.authority_write_permit(transaction_id,backend_pid,scope_keys,epoch,request_id,phase) SELECT txid_current(),pg_backend_pid(),scope_keys,epoch,request_id,''REGISTER'' FROM public.authority_write_request WHERE request_id=$1';
 WHEN '994e2f30a589c81e56eee929259e255e7d33e4596db6dbe0384bdf28e0549b29' THEN statement:='INSERT INTO public.authority_scope_epoch(scope_key,epoch) SELECT key,r.epoch FROM public.authority_write_request r CROSS JOIN unnest(r.scope_keys) AS key WHERE request_id=$1 ON CONFLICT(scope_key) DO UPDATE SET epoch=EXCLUDED.epoch';
 WHEN '91ef0a2047bb1685773541e48381f09aca364e7208f8c79a0afc357bcf7c01ce' THEN statement:='DELETE FROM public.authority_write_permit WHERE transaction_id=txid_current()';
 WHEN '5f43290aa99c50e289e8e04e7a7d694ac287635d1b698ddc913cb9689b07d2c0' THEN statement:='SELECT state,deadline FROM public.authority_write_request WHERE request_id=$1 FOR UPDATE';
 WHEN '047eefac3bdec330a2c9d62b243c75b404ab89e68709877f8cc070ed69e4c92a' THEN statement:='UPDATE public.authority_write_request SET state=''CANCELLED'',finished_at=clock_timestamp() WHERE state=''WAITING'' AND deadline<=clock_timestamp()';
 WHEN 'edcaaa118f0880372d8576c116ce785662a70aa1d2b38dbd78b480c656d96186' THEN statement:='SELECT request_id FROM public.authority_write_request WHERE state=''WAITING'' AND scope_keys && $1::text[] AND epoch<(SELECT epoch FROM public.authority_write_request WHERE request_id=$2)';
 WHEN '51dfdb49de3cbfc23256d535693068d97916248af8ff2122028ed70b769d2d6f' THEN statement:='SELECT guard_id,deadline FROM public.authority_commit_guard WHERE state IN (''PREPARED'',''TENANT_COMMIT_UNKNOWN'') AND scope_keys && $1::text[] ORDER BY authority_epoch';
 WHEN '12613bd5cb6f6c4ffb4160212a21b73c9ca2867c156a760ca2b41f8f3999f627' THEN statement:='INSERT INTO public.authority_write_permit(transaction_id,backend_pid,scope_keys,epoch,request_id,phase) SELECT txid_current(),pg_backend_pid(),scope_keys,epoch,request_id,''APPLY'' FROM public.authority_write_request WHERE request_id=$1';
 WHEN '8e0ce38b72d8be7cf7316113888ae81ad20c6e36155ee6d1846fb4cb157682e4' THEN statement:='UPDATE public.authority_write_request SET state=''APPLIED'',finished_at=clock_timestamp() WHERE request_id=$1';
 WHEN 'd36952f91a28729c4256925cc86df432a25a497338a5914c3d9c675ff1494860' THEN statement:='UPDATE public.authority_write_request SET state=''CANCELLED'',finished_at=clock_timestamp() WHERE request_id=$1 AND state=''WAITING''';
 WHEN '523dd2bc066f061b9c611d4f1458fc8b666f71f8bbdcd5fecfa4b8984e732356' THEN statement:='SELECT request_id FROM public.authority_write_request WHERE state=''WAITING'' AND scope_keys && $1::text[]';
 WHEN '9a1e115779b97f604319c133faba4e721470cc702efeb0d0196298a871013203' THEN statement:='SELECT scope_key,epoch::text FROM public.authority_scope_epoch WHERE scope_key=ANY($1::text[]) ORDER BY scope_key';
 WHEN '44b5cd0573f9200887cb11f60579daedb217bf61a04df3a79d4756a8e2ed4234' THEN statement:='INSERT INTO public.authority_commit_guard(guard_id,organization_id,tenant_id,subject_id, membership_id,session_digest,scope_keys,protected_operations,authority_versions,normalized_assurance,authority_epoch, transaction_id,correlation_id,idempotency_key,intention_digest,source_binding,state,deadline,finalization_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,nextval(''public.authority_epoch_seq''),$11,$12,$13,$14,$15,''PREPARED'',$16,$17) RETURNING *';
 WHEN 'acc5bafe2cbdfdcd0ad27a7c2ef91fcfa8cd94ef04cba034065c358c83e097d5' THEN statement:='UPDATE public.authority_commit_guard SET state=''TENANT_COMMIT_UNKNOWN'',updated_at=clock_timestamp() WHERE guard_id=$1 AND state=''PREPARED''';
 WHEN '5f26cac75df33c4ebc241e29c2701825a20e1c4e3d2832986fe4cad7a7143bda' THEN statement:='SELECT guard_id FROM public.authority_commit_guard WHERE state IN (''PREPARED'',''TENANT_COMMIT_UNKNOWN'') AND deadline<=clock_timestamp() ORDER BY authority_epoch LIMIT $1';
 WHEN '607db9c91b091febe0dbb80c77ab252ce2980f7d38f3d08b13151770f2f553bb' THEN statement:='INSERT INTO public.oidc_transaction (sid, state, expires_at) VALUES ($1, $2, $3)';
 WHEN '8d857e81393bba44b1d4beff01e775df655bc720896067ca853ac6026a69c83f' THEN statement:='UPDATE public.oidc_transaction SET consumed_at = $3 WHERE sid = $1 AND state = $2 AND consumed_at IS NULL AND expires_at > $3 RETURNING sid';
 WHEN '4a870bd240d8c672470956eee02b5750dc11ee7cb584ac7762acb83cbf9b8609' THEN statement:='INSERT INTO public.application_session (sid, global_user_id, status, revocation_version, created_at, last_seen_at, expires_at) VALUES ($1, $2, ''ACTIVE'', $3, NOW(), NOW(), $4) ON CONFLICT (sid) DO UPDATE SET global_user_id = EXCLUDED.global_user_id, status = ''ACTIVE'', revocation_version = EXCLUDED.revocation_version, last_seen_at = NOW(), expires_at = EXCLUDED.expires_at';
 WHEN '2be09325e4f030781a2b12e95fd90c7a1aa425fd2abad3030d4cd6a20d236350' THEN statement:='SELECT om.id FROM public.organization_membership om INNER JOIN public.global_user gu ON gu.id = om.global_user_id INNER JOIN public.organization org ON org.id = om.organization_id WHERE om.id = $1 AND om.global_user_id = $2 AND om.organization_id = $3 AND om.membership_version = $4 AND gu.status = ''ACTIVE'' AND org.status = ''ACTIVE'' AND om.status = ''ACTIVE'' AND om.valid_from <= NOW() AND (om.valid_until IS NULL OR om.valid_until > NOW()) FOR SHARE OF om, gu, org';
 WHEN '3b47f60af2a659072313a33f7e2426e655d16793628709bc3cabf33b7ec1dca5' THEN statement:='INSERT INTO public.application_session ( sid, global_user_id, status, revocation_version, created_at, last_seen_at, expires_at, selected_organization_id, selected_membership_id, selected_membership_version ) VALUES ($1, $2, ''ACTIVE'', $3, NOW(), NOW(), $4, $5, $6, $7) ON CONFLICT (sid) DO UPDATE SET global_user_id = EXCLUDED.global_user_id, status = ''ACTIVE'', revocation_version = EXCLUDED.revocation_version, last_seen_at = NOW(), expires_at = EXCLUDED.expires_at, selected_organization_id = EXCLUDED.selected_organization_id, selected_membership_id = EXCLUDED.selected_membership_id, selected_membership_version = EXCLUDED.selected_membership_version, revoked_at = NULL, revocation_reason = NULL';
 WHEN '5a9f80e910770fcc0b77a7cac18f404d2c73aba857cd2a6f745ad1d0e695a110' THEN statement:='UPDATE public.application_session SET status = ''REVOKED'', revoked_at = NOW(), revocation_reason = ''SESSION_ROTATED'' WHERE sid = $1 AND status = ''ACTIVE''';
 WHEN '46213380e14843ceab21381826d6648aa5e0a652dd21a64f214e64c9580456ae' THEN statement:='UPDATE public.application_session AS aps SET last_seen_at = $4 FROM public.global_user AS gu WHERE aps.sid = $1 AND aps.global_user_id = $2 AND gu.id = aps.global_user_id AND aps.status = ''ACTIVE'' AND gu.status = ''ACTIVE'' AND aps.revocation_version = $3 AND gu.session_revocation_version = $3 AND aps.expires_at > $4 RETURNING aps.sid';
 WHEN '0613a2ca06c8fdf08c0266abc7a05d51a5ccf3ce173b35e0f7755ff262a9c5e3' THEN statement:='SELECT aps.selected_organization_id, aps.selected_membership_id, aps.selected_membership_version, om.membership_version, om.base_role_code, om.status AS membership_status, om.valid_from, om.valid_until, org.status AS organization_status, org.display_name, org.slug, gu.status AS user_status, LEAST(aps.expires_at,ss.expire) AS session_expires_at FROM public.application_session aps INNER JOIN public.global_user gu ON gu.id = aps.global_user_id LEFT JOIN public.application_session_store ss ON ss.sid=aps.sid LEFT JOIN public.organization_membership om ON om.id = aps.selected_membership_id AND om.global_user_id = aps.global_user_id AND om.organization_id = aps.selected_organization_id LEFT JOIN public.organization org ON org.id = aps.selected_organization_id WHERE aps.sid = $1 AND aps.global_user_id = $2 AND aps.status = ''ACTIVE''';
 WHEN '915cdc1dee8dcd04fc036139ec6485e6ad66793b654c5c003dd7d2dc1ca0d28f' THEN statement:='UPDATE public.application_session SET status = ''REVOKED'', revoked_at = NOW(), revocation_reason = $2 WHERE sid = $1 AND status = ''ACTIVE''';
 WHEN '5d37ae5d7f8d203f5f83bce44d8a5009da9ce9f75f6cd8ef3083fb904ec1ccb9' THEN statement:='UPDATE public.application_session SET status = ''EXPIRED'' WHERE sid = $1 AND status = ''ACTIVE''';
 WHEN 'bfc3fb737b98794d4bfd755f626c888b5cace3a9a9483c77c0b3751f0b7d54da' THEN statement:='UPDATE public.global_user SET session_revocation_version = session_revocation_version + 1, updated_at = NOW() WHERE id = $1 RETURNING session_revocation_version';
 WHEN '8fcc93ce0fa89a70dbb13ecc8cc868ced249841aa496079641800bfa0211d51c' THEN statement:='UPDATE public.application_session SET status = ''REVOKED'', revoked_at = NOW(), revocation_reason = $2, revocation_version = $3 WHERE global_user_id = $1 AND status = ''ACTIVE'' RETURNING sid';
 WHEN 'b0d58a09cdf9f5d1b2396c0cd3c809d1a1e6c66ac0958a1452e9d8e50cdb8720' THEN statement:='DELETE FROM public.application_session_store WHERE sid = ANY($1::varchar[])';
 WHEN 'e33fd4838237102d76c9e0b5b82921e6016d9eaafc6ffe1937c0e835d72b1f2e' THEN statement:='DELETE FROM public.oidc_transaction WHERE expires_at <= $1';
 WHEN '7582d7e7043bca10e9fa3ed52e76aa2cb1a7a556dcf29c37f88f5f94cabd785e' THEN statement:='UPDATE public.application_session SET status = ''EXPIRED'' WHERE status = ''ACTIVE'' AND expires_at <= $1 RETURNING sid';
 WHEN '1daf4994db9846a00335dcf1ae1f421fdd83f18cdfe35354f39c3c0766bdd4bb' THEN statement:='SELECT sid FROM public.application_session WHERE global_user_id=$1';
 WHEN '2564586f791c3961620f95f7d640c516ba413700ee6c2d0fa9bad54b7ef09aca' THEN statement:='SELECT sid FROM public.application_session WHERE expires_at<=$1';
 WHEN '453b12b4f645c80068336e0514291b33db4ed5421e57003a4f1216ff5cd95bf9' THEN statement:='UPDATE public.organization_membership SET status = $2, membership_version = membership_version + 1, status_reason = $3, suspended_at = CASE WHEN $2 = ''SUSPENDED'' THEN NOW() ELSE suspended_at END, removed_at = CASE WHEN $2 = ''REMOVED'' THEN NOW() ELSE removed_at END, updated_at = NOW() WHERE id = $1 AND status <> ''REMOVED'' RETURNING id, global_user_id, organization_id, membership_version';
 WHEN '749a4adebedc7411db44580ea7a0370d4d2d1ad7b617e6588f80abc015c9987e' THEN statement:='SELECT f.organization_id,f.membership_id,f.authorization_version,f.policy_version,f.grants,f.assurance_requirements, m.membership_version,m.base_role_code FROM public.authority_f5_state f JOIN public.organization_membership m ON m.id=f.membership_id AND m.organization_id=f.organization_id WHERE f.organization_id=$1 AND f.membership_id=$2';
 WHEN '00fa59892ea5041d202eef591e4b4504317750bbbae76d13b97c0fe160514b5c' THEN statement:='SELECT m.id,m.organization_id,m.global_user_id,m.membership_version,m.status,m.valid_until FROM public.organization_membership m JOIN public.organization o ON o.id=m.organization_id JOIN public.global_user u ON u.id=m.global_user_id WHERE m.id=$1 AND m.organization_id=$2 AND o.status=''ACTIVE'' AND u.status=''ACTIVE'' AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())';
 WHEN '988bde7edb994d6e6cc5f34e5954acbb32de95b60f010ee3b9ff37a6d14624ca' THEN statement:='SELECT id FROM public.organization_membership WHERE id=$1 AND organization_id=$2';
 WHEN 'aa740d698a0ed782d26f5589d58d5ad5c9b4545c6999c9d34a855c23aaf16769' THEN statement:='INSERT INTO public.authority_f5_state(organization_id,membership_id,authorization_version,policy_version,grants,assurance_requirements) SELECT $1,$2,1,$4,$5,$6 WHERE $3::bigint=0 ON CONFLICT(organization_id,membership_id) DO UPDATE SET authorization_version=authority_f5_state.authorization_version+1, policy_version=$4,grants=$5,assurance_requirements=$6,updated_at=clock_timestamp() WHERE authority_f5_state.authorization_version=$3 RETURNING authorization_version';
 WHEN 'efa84d7e4a207510381f24119d796843af2f32861a152ac2935c8ff20f0a2ea6' THEN statement:='UPDATE public.authority_f5_state SET authorization_version=authorization_version+1, policy_version=$4,grants=$5,assurance_requirements=$6,updated_at=clock_timestamp() WHERE organization_id=$1 AND membership_id=$2 AND authorization_version=$3 RETURNING authorization_version';
 WHEN '11bd90418a1000de688748966e9008e4f70ad3cbd2563da0544a0135fda5fee2' THEN statement:='SET CONSTRAINTS ALL IMMEDIATE';
 WHEN '41706f3ccefc32bd6d1558243ff74f72c605c9fce4e1e01d2605c3695398316f' THEN statement:='SELECT sess FROM public.application_session_store WHERE sid=$1';
 WHEN '35ae828db8ae89475f2d346967147d2d57982256d0a09a26b3cc019f49982697' THEN statement:='SELECT sess FROM "public"."application_session_store" WHERE sid = $1 AND expire >= to_timestamp($2)';
 WHEN 'bc85cfaa21977437739c5f200477331f51884e41d1ebb4eedc9a4d413e1e8a9f' THEN statement:='INSERT INTO "public"."application_session_store" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid';
 WHEN '58c5362fb60f5b6ccc12fc9b483e642ad1d227d0b130d551ea089ef609d231ea' THEN statement:='DELETE FROM "public"."application_session_store" WHERE sid = $1';
 WHEN '473d59a19b9424a0a06ff1a6b821b9750bbee42999d636de17daff24230de2b8' THEN statement:='UPDATE "public"."application_session_store" SET expire = to_timestamp($1) WHERE sid = $2 RETURNING sid';
 ELSE RAISE EXCEPTION 'AUTHORITY_QUERY_DENIED' USING ERRCODE='42501';
 END CASE;
 SELECT COALESCE(max((match[1])::integer),0) INTO parameter_count
 FROM regexp_matches(statement,'\$([0-9]+)','g') AS match;
 IF cardinality(parameters)<>parameter_count OR EXISTS(SELECT 1 FROM unnest(parameters) p WHERE length(p)>1048576)
 THEN RAISE EXCEPTION 'AUTHORITY_PARAMETERS_INVALID' USING ERRCODE='42501'; END IF;
 IF statement LIKE 'UPDATE public.authority_commit_guard %' THEN
   SELECT finalization_digest INTO guard_digest FROM public.authority_commit_guard WHERE guard_id=parameters[1]::uuid;
   IF final_permit IS NULL OR guard_digest IS NULL OR encode(sha256(convert_to(final_permit,'UTF8')),'hex')<>guard_digest
   THEN RAISE EXCEPTION 'AUTHORITY_FINALIZATION_PERMIT_REQUIRED' USING ERRCODE='42501'; END IF;
   previous_permit:=current_setting('authority.finalization_permit',true);
   PERFORM set_config('authority.finalization_permit',final_permit,true);
 END IF;
 SELECT string_agg(match[1]||CASE WHEN match[3] IS NOT NULL THEN quote_nullable(parameters[match[3]::integer]) ELSE '' END,'')
 INTO statement FROM regexp_matches(statement,'([^$]*)(\$([0-9]+)|$)','g') AS match;
 IF statement LIKE 'SELECT %' THEN
   EXECUTE 'SELECT COALESCE(jsonb_agg(to_jsonb(q)),''[]''::jsonb) FROM ('||statement||') AS q' INTO result_rows;
   affected:=jsonb_array_length(result_rows);
 ELSIF statement LIKE '% RETURNING %' THEN
   EXECUTE 'WITH changed AS ('||statement||') SELECT COALESCE(jsonb_agg(to_jsonb(q)),''[]''::jsonb) FROM changed q' INTO result_rows;
   affected:=jsonb_array_length(result_rows);
 ELSE
   EXECUTE statement; GET DIAGNOSTICS affected=ROW_COUNT; result_rows:='[]'::jsonb;
 END IF;
 IF final_permit IS NOT NULL THEN PERFORM set_config('authority.finalization_permit',COALESCE(previous_permit,''),true); END IF;
 RETURN jsonb_build_object('rows',result_rows,'rowCount',affected);
END
$authority$;
ALTER FUNCTION authority_api.execute(text,text[],text) OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION authority_api.execute(text,text[],text) FROM PUBLIC,c4g_central_runtime,c4g_authority_runtime;
GRANT EXECUTE ON FUNCTION authority_api.execute(text,text[],text) TO c4g_authority_coordinator;

DO $$ DECLARE tab text; func text; BEGIN
 FOREACH tab IN ARRAY ARRAY['authority_commit_guard','authority_write_permit','authority_f5_state','authority_scope_epoch','authority_write_request'] LOOP
   EXECUTE format('ALTER TABLE public.%I OWNER TO c4g_authority_owner',tab);
   EXECUTE format('REVOKE ALL ON public.%I FROM c4g_authority_coordinator,c4g_authority_runtime',tab);
 END LOOP;
 ALTER SEQUENCE public.authority_epoch_seq OWNER TO c4g_authority_owner;
 REVOKE ALL ON SEQUENCE public.authority_epoch_seq FROM c4g_authority_coordinator,c4g_authority_runtime;
 FOREACH func IN ARRAY ARRAY['authority_protocol_guard','authority_metadata_lock','authority_require_write','authority_effect_commit_guard'] LOOP
   EXECUTE format('ALTER FUNCTION public.%I() OWNER TO c4g_authority_owner',func);
   EXECUTE format('ALTER FUNCTION public.%I() SECURITY DEFINER',func);
   EXECUTE format('ALTER FUNCTION public.%I() SET search_path=pg_catalog,public,pg_temp',func);
   EXECUTE format('REVOKE ALL ON FUNCTION public.%I() FROM PUBLIC,c4g_central_runtime,c4g_authority_coordinator,c4g_authority_runtime',func);
 END LOOP;
END $$;
GRANT SELECT ON public.c4g_schema_migration,public.c4g_database_identity TO c4g_authority_runtime;
REVOKE CREATE ON SCHEMA public FROM c4g_authority_owner;
