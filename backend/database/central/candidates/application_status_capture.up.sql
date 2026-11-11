-- Isolated candidate: requires controlled security-manifest admission before rollout.
DO $migration$
DECLARE definition text; needle constant text := ' CASE query_code';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='authority_api.execute(text,text[],text)'::regprocedure AND prosecdef AND pg_get_userbyid(proowner)='c4g_authority_owner' AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']) THEN RAISE EXCEPTION 'STATUS_PROTOCOL_SECURITY_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='c4g_authority_owner' AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolinherit)) THEN RAISE EXCEPTION 'STATUS_OWNER_DRIFT'; END IF;
 SELECT pg_get_functiondef('authority_api.execute(text,text[],text)'::regprocedure) INTO STRICT definition;
 IF (length(definition)-length(replace(definition,needle,'')))<>length(needle) THEN RAISE EXCEPTION 'STATUS_PROTOCOL_PATCH_POINT_INVALID'; END IF;
 IF position('f44c7f3b16661acc96105344784036c1cc19c38eb513dacc658b405b8f329b51' in definition)>0 THEN RAISE EXCEPTION 'STATUS_PROTOCOL_ALREADY_PRESENT'; END IF;
 EXECUTE replace(definition,needle,needle||$cases$
 WHEN 'f44c7f3b16661acc96105344784036c1cc19c38eb513dacc658b405b8f329b51' THEN statement:='SELECT o.id AS organization_id,o.display_name AS organization_name, u.id AS actor_id,u.primary_email AS actor_email, COALESCE((SELECT jsonb_agg(m.id ORDER BY m.id) FROM public.organization_membership m JOIN public.global_user recipient ON recipient.id=m.global_user_id WHERE m.organization_id=o.id AND m.id=ANY($3::uuid[]) AND m.status=''ACTIVE'' AND recipient.status=''ACTIVE'' AND m.valid_from<=statement_timestamp() AND (m.valid_until IS NULL OR m.valid_until>statement_timestamp()) AND m.global_user_id<>u.id AND lower(btrim(recipient.primary_email))<>lower(btrim(u.primary_email))), ''[]''::jsonb) AS candidates FROM public.organization o CROSS JOIN public.global_user u WHERE cardinality($3::uuid[])<=1000 AND o.id=$1 AND u.id=$2 AND o.status=''ACTIVE'' AND u.status=''ACTIVE''';
$cases$);
END $migration$;
