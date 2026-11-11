-- Restricted responsible observations; exact admitted 029 predecessor required by runner.
-- No new table privileges, role memberships or executable entrypoints.
DO $migration$
DECLARE definition text; needle constant text := ' CASE query_code';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='authority_api.execute(text,text[],text)'::regprocedure AND prosecdef AND pg_get_userbyid(proowner)='c4g_authority_owner' AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']) THEN RAISE EXCEPTION 'RESPONSIBLE_PROTOCOL_SECURITY_DRIFT'; END IF;
 SELECT pg_get_functiondef('authority_api.execute(text,text[],text)'::regprocedure) INTO STRICT definition;
 IF (length(definition)-length(replace(definition,needle,'')))<>length(needle) THEN RAISE EXCEPTION 'RESPONSIBLE_PROTOCOL_PATCH_POINT_INVALID'; END IF;
 IF position('a27643124540f83b5a557be26adefff0bf5c638e7db9e5d00ef3552672a6b22f' in definition)>0 THEN RAISE EXCEPTION 'RESPONSIBLE_PROTOCOL_ALREADY_PRESENT'; END IF;
 EXECUTE replace(definition,needle,needle||$cases$
 WHEN 'a27643124540f83b5a557be26adefff0bf5c638e7db9e5d00ef3552672a6b22f' THEN statement:='SELECT m.id AS membership_id,u.display_name FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id JOIN public.organization o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.status=''ACTIVE'' AND u.status=''ACTIVE'' AND o.status=''ACTIVE'' AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()) AND ($2::uuid IS NULL OR m.id>$2) ORDER BY m.id LIMIT 26';
 WHEN 'b5e47be19a58d501dd37fd01d1cb62937218074145be99af10d4eb2325003f66' THEN statement:='SELECT m.id AS membership_id FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id JOIN public.organization o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.status=''ACTIVE'' AND u.status=''ACTIVE'' AND o.status=''ACTIVE'' AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()) AND m.id=$2 LIMIT 1';
 WHEN '3205375fc6907dbbf67c3a2a134fec79bae8e9bd53ab4ba8c2016dd2ecb6aae0' THEN statement:='SELECT m.id AS membership_id,u.display_name FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id WHERE m.organization_id=$1 AND m.id=ANY($2::uuid[]) AND cardinality($2::uuid[])<=100 ORDER BY m.id LIMIT 100';
$cases$);
END $migration$;
