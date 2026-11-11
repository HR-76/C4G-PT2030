-- Irreversible correction of the explicitly admitted Central 027 baseline.
-- No runtime grants, memberships, provisioning or transfer outside the catalog.
DO $migration$
DECLARE item text; object_oid oid; old_owner oid; expected text[]; actual text[];
BEGIN
 IF (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='opportunity_catalog') IS DISTINCT FROM 'c4g_opportunity_central_owner'
 THEN RAISE EXCEPTION 'CATALOG_SCHEMA_OWNER_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('c4g_opportunity_central_owner','c4g_opportunity_central_runtime') AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolcanlogin))
 OR pg_has_role('c4g_opportunity_central_runtime','c4g_opportunity_central_owner','MEMBER')
 THEN RAISE EXCEPTION 'CATALOG_ROLE_DRIFT'; END IF;
 FOREACH item IN ARRAY ARRAY['funding_run','funding_run_item','funding_identity','funding_observation'] LOOP
  SELECT c.oid,c.relowner INTO STRICT object_oid,old_owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='opportunity_catalog' AND c.relname=item AND c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity;
  IF pg_get_userbyid(old_owner)<>'c4g_f12_admin' THEN RAISE EXCEPTION 'FUNDING_SOURCE_OWNER_DRIFT'; END IF;
  SELECT array_agg(COALESCE(pg_get_userbyid(a.grantee),'PUBLIC')||':'||a.privilege_type||':'||a.is_grantable::text ORDER BY a.privilege_type)
   INTO actual FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid=object_oid AND a.grantee<>old_owner;
  expected:=ARRAY['c4g_opportunity_central_runtime:INSERT:false','c4g_opportunity_central_runtime:SELECT:false'];
  IF item<>'funding_observation' THEN expected:=array_append(expected,'c4g_opportunity_central_runtime:UPDATE:false'); END IF;
  IF actual IS DISTINCT FROM expected OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=object_oid AND attacl IS NOT NULL)
   THEN RAISE EXCEPTION 'FUNDING_SOURCE_ACL_DRIFT'; END IF;
  EXECUTE format('ALTER TABLE opportunity_catalog.%I OWNER TO c4g_opportunity_central_owner',item);
  IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=object_oid)<>'c4g_opportunity_central_owner'
   THEN RAISE EXCEPTION 'FUNDING_FINAL_OWNER_INVALID'; END IF;
  SELECT array_agg(pg_get_userbyid(a.grantee)||':'||a.privilege_type||':'||a.is_grantable::text ORDER BY a.privilege_type)
   INTO actual FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid=object_oid AND a.grantee<>c.relowner;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'FUNDING_FINAL_ACL_INVALID'; END IF;
 END LOOP;
END $migration$;

-- Two exact identity observations added to the existing closed protocol.
-- Generated query constants below must match identityQueries.js byte-for-byte.
DO $migration$
DECLARE definition text; needle constant text := ' CASE query_code';
BEGIN
 SELECT pg_get_functiondef('authority_api.execute(text,text[],text)'::regprocedure) INTO STRICT definition;
 IF (length(definition)-length(replace(definition,needle,'')))<>length(needle) THEN RAISE EXCEPTION 'IDENTITY_PROTOCOL_PATCH_POINT_INVALID'; END IF;
 EXECUTE replace(definition,needle,needle||$cases$
 WHEN 'fb73964f77b6b310999cba527d017ab376f5ac904bd3bf66c4b7f08ce05e206c' THEN statement:='SELECT gu.id,gu.display_name,gu.primary_email,gu.session_revocation_version FROM public.auth_identity_ref air JOIN public.global_user gu ON gu.id=air.global_user_id WHERE air.issuer=$1 AND air.subject=$2 AND gu.status=''ACTIVE'' LIMIT 2';
 WHEN '9a5b3c1ba93b4c66992005e06286149ec7ddfffc82da050bf0520ab08f84eccf' THEN statement:='SELECT DISTINCT paa.role_code FROM public.auth_identity_ref air JOIN public.global_user gu ON gu.id=air.global_user_id JOIN public.platform_admin_assignment paa ON paa.global_user_id=gu.id WHERE air.issuer=$1 AND air.subject=$2 AND gu.id=$3 AND gu.status=''ACTIVE'' AND paa.status=''ACTIVE'' ORDER BY paa.role_code';
$cases$);
END $migration$;
