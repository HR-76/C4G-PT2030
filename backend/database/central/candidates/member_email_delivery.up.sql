-- Isolated candidate: requires controlled security-manifest admission before rollout.
DO $migration$
DECLARE definition text; needle constant text := ' CASE query_code';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='authority_api.execute(text,text[],text)'::regprocedure AND prosecdef AND pg_get_userbyid(proowner)='c4g_authority_owner' AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']) THEN RAISE EXCEPTION 'MEMBER_EMAIL_PROTOCOL_SECURITY_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='c4g_authority_owner' AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolinherit)) THEN RAISE EXCEPTION 'MEMBER_EMAIL_OWNER_DRIFT'; END IF;
 SELECT pg_get_functiondef('authority_api.execute(text,text[],text)'::regprocedure) INTO STRICT definition;
 IF (length(definition)-length(replace(definition,needle,'')))<>length(needle) THEN RAISE EXCEPTION 'MEMBER_EMAIL_PROTOCOL_PATCH_POINT_INVALID'; END IF;
 IF position('413612ce1ae6f48815025fb9fc5e7855359ecfc145a9245596d8cab0c4370d23' in definition)>0 THEN RAISE EXCEPTION 'MEMBER_EMAIL_PROTOCOL_ALREADY_PRESENT'; END IF;
 EXECUTE replace(definition,needle,needle||$cases$
 WHEN '413612ce1ae6f48815025fb9fc5e7855359ecfc145a9245596d8cab0c4370d23' THEN statement:='UPDATE public.platform_member_operation SET receipt=jsonb_set(receipt,''{activationEmail}'',$2::jsonb),revision=revision+1 WHERE id=$1 AND phase=''READY'' AND EXISTS(SELECT 1 FROM public.platform_member_invitation WHERE id=$3::uuid AND operation_id=$1 AND status=''OPEN'') AND NOT COALESCE((receipt->''activationEmail''->>''invitationId''=$3::text AND receipt->''activationEmail''->>''status''=''ACCEPTED'' AND $2::jsonb->>''status''<>''ACCEPTED''),false)';
$cases$);
END $migration$;
