-- Activation preparation only. Not registered in an executable manifest.
-- The helper reveals only the fields needed to revalidate the central actor;
-- catalog runtime receives no direct access to sessions, users or assignments.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.c4g_database_identity WHERE product_code='C4G' AND database_role='CENTRAL')
 THEN RAISE EXCEPTION 'OPPORTUNITY_V2_CENTRAL_REQUIRED'; END IF;
END $$;

CREATE FUNCTION authority_api.opportunity_v2_administrator(p_sid text,p_user_id uuid)
RETURNS TABLE(authority jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_auth jsonb; v_cookie jsonb; v_revocation bigint; v_expires timestamptz; v_now timestamptz;
BEGIN
 IF p_sid IS NULL OR length(p_sid) NOT BETWEEN 8 AND 512 OR p_sid !~ '^[A-Za-z0-9._~-]+$' OR p_user_id IS NULL THEN RETURN; END IF;
 SELECT ss.sess::jsonb->'auth',ss.sess::jsonb->'cookie',u.session_revocation_version,LEAST(s.expires_at,ss.expire)
 INTO v_auth,v_cookie,v_revocation,v_expires
 FROM public.application_session s
 JOIN public.application_session_store ss ON ss.sid=s.sid
 JOIN public.global_user u ON u.id=s.global_user_id
 JOIN public.platform_admin_assignment a ON a.global_user_id=u.id
 WHERE s.sid=p_sid AND u.id=p_user_id AND s.status='ACTIVE' AND u.status='ACTIVE'
   AND s.revocation_version=u.session_revocation_version AND a.role_code='C4G_ADMIN' AND a.status='ACTIVE'
 ORDER BY a.id LIMIT 1 FOR SHARE OF s,ss,u,a;
 IF NOT FOUND THEN RETURN; END IF;
 -- Evaluate expiry after acquiring locks, including after a concurrent revoke.
 v_now:=clock_timestamp();
 IF v_expires<=v_now THEN RETURN; END IF;
 RETURN QUERY SELECT jsonb_build_object(
  'userId',p_user_id,'storedUserId',v_auth#>'{user,id}',
  'revocationVersion',v_revocation,'storedRevocationVersion',v_auth->'revocationVersion',
  'policyVersion',v_auth->'policyVersion','absoluteExpiresAt',v_auth->'absoluteExpiresAt',
  'cookieExpires',v_cookie->'expires','expiresAt',extract(epoch FROM v_expires)*1000,
  'nowSeconds',extract(epoch FROM v_now),
  'evidence',jsonb_build_object('authTime',v_auth#>'{evidence,authTime}','acr',v_auth#>'{evidence,acr}',
    'amr',v_auth#>'{evidence,amr}','policyVersion',v_auth#>'{evidence,policyVersion}'));
END $$;
ALTER FUNCTION authority_api.opportunity_v2_administrator(text,uuid) OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION authority_api.opportunity_v2_administrator(text,uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA authority_api TO c4g_opportunity_central_runtime;
GRANT EXECUTE ON FUNCTION authority_api.opportunity_v2_administrator(text,uuid) TO c4g_opportunity_central_runtime;

-- Append uses the existing platform ledger and retains its atomic hash chain.
GRANT EXECUTE ON FUNCTION audit.prepare_platform_append_v1(uuid,text) TO c4g_opportunity_central_runtime;
GRANT EXECUTE ON FUNCTION audit.append_platform_event_v1(uuid,text,text,integer,text,text,audit.ledger_location,uuid,uuid,audit.actor_type,text,text,text,bigint,timestamptz,timestamptz,uuid,uuid,text,text,text,text,jsonb) TO c4g_opportunity_central_runtime;

-- The JS event catalog already defines these import decisions, but Central 035
-- does not admit them in its ledger constraints. Preserve each entire existing
-- predicate and add only the three decisions used by activation preparation.
DO $activation_audit$
DECLARE v_table text; v_constraint text; v_predicate text;
BEGIN
 FOREACH v_table IN ARRAY ARRAY['event_identity','event'] LOOP
  v_constraint:=v_table||'_event_code_check';
  SELECT pg_get_expr(c.conbin,c.conrelid) INTO STRICT v_predicate
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid=format('audit.%I',v_table)::regclass AND c.conname=v_constraint
    AND c.contype='c' AND c.convalidated;
  EXECUTE format('ALTER TABLE audit.%I DROP CONSTRAINT %I',v_table,v_constraint);
  EXECUTE format('ALTER TABLE audit.%I ADD CONSTRAINT %I CHECK ((%s) OR event_code IN (%L,%L,%L))',
    v_table,v_constraint,v_predicate,
    'OPPORTUNITY_IMPORT_UPLOADED','OPPORTUNITY_IMPORT_CONFIRMED','OPPORTUNITY_IMPORT_CANCELLED');
 END LOOP;
END $activation_audit$;
