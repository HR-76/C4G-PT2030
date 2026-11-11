-- One operational entity membership per global identity. Historical REMOVED rows remain.
DO $migration$
DECLARE definition text; needle constant text := ' CASE query_code';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='authority_api.execute(text,text[],text)'::regprocedure AND prosecdef AND pg_get_userbyid(proowner)='c4g_authority_owner' AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']) THEN RAISE EXCEPTION 'SINGLE_MEMBERSHIP_PROTOCOL_SECURITY_DRIFT'; END IF;
 SELECT pg_get_functiondef('authority_api.execute(text,text[],text)'::regprocedure) INTO STRICT definition;
 IF (length(definition)-length(replace(definition,needle,'')))<>length(needle) THEN RAISE EXCEPTION 'SINGLE_MEMBERSHIP_PROTOCOL_PATCH_POINT_INVALID'; END IF;
 IF position('2cde99a4b498471f04bbeed49a95579af8dc6b3b5380e3fc467b9a6b0ac99b3e' in definition)>0 THEN RAISE EXCEPTION 'SINGLE_MEMBERSHIP_PROTOCOL_ALREADY_PRESENT'; END IF;
 EXECUTE replace(definition,needle,needle||$cases$
 WHEN '2cde99a4b498471f04bbeed49a95579af8dc6b3b5380e3fc467b9a6b0ac99b3e' THEN statement:='SELECT id,organization_id,status FROM public.organization_membership WHERE global_user_id=$1 AND status IN (''PENDING_PROJECTION'',''ACTIVE'',''SUSPENDED'') ORDER BY created_at,id LIMIT 1';
$cases$);
END $migration$;

DO $migration$
BEGIN
 IF EXISTS(
   SELECT 1 FROM public.organization_membership
   WHERE status IN ('PENDING_PROJECTION','ACTIVE','SUSPENDED')
   GROUP BY global_user_id HAVING count(*)>1
 ) THEN RAISE EXCEPTION 'SINGLE_MEMBERSHIP_EXISTING_CONFLICT'; END IF;
END $migration$;

CREATE UNIQUE INDEX organization_membership_single_entity_uidx
 ON public.organization_membership(global_user_id)
 WHERE status IN ('PENDING_PROJECTION','ACTIVE','SUSPENDED');
