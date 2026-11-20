-- Entity type edits: exact query, no direct runtime write privilege.
GRANT UPDATE(type_code) ON public.organization TO c4g_authority_owner;
DO $migration$
DECLARE definition text; needle constant text := ' CASE query_code';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='authority_api.execute(text,text[],text)'::regprocedure AND prosecdef AND pg_get_userbyid(proowner)='c4g_authority_owner' AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']) THEN RAISE EXCEPTION 'ENTITY_TYPE_PROTOCOL_SECURITY_DRIFT'; END IF;
 SELECT pg_get_functiondef('authority_api.execute(text,text[],text)'::regprocedure) INTO STRICT definition;
 IF (length(definition)-length(replace(definition,needle,'')))<>length(needle) THEN RAISE EXCEPTION 'ENTITY_TYPE_PROTOCOL_PATCH_POINT_INVALID'; END IF;
 IF position('33d09c06318dc6f25afd97b0bb4f74187370e17949bf54cbd8ec1cbdf6bb3200' in definition)>0 THEN RAISE EXCEPTION 'ENTITY_TYPE_PROTOCOL_ALREADY_PRESENT'; END IF;
 EXECUTE replace(definition,needle,needle||$cases$
 WHEN '33d09c06318dc6f25afd97b0bb4f74187370e17949bf54cbd8ec1cbdf6bb3200' THEN statement:='UPDATE public.organization SET type_code=$2,updated_at=clock_timestamp() WHERE id=$1 AND type_code=$3 AND status=''ACTIVE'' AND $2 IN (''UNIVERSITY'',''COMPANY'',''MUNICIPALITY'',''ASSOCIATION'',''PUBLIC_BODY'',''RESEARCH'',''CONSULTANCY'',''OTHER'') RETURNING id';
$cases$);
END $migration$;
