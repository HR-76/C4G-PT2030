-- 053_opportunity_complement: additive, explicit installation only, after 052.
-- Descriptive data kept beside a catalog opportunity and never inside its
-- canonical revision: what a public source publishes (COLLECTED) and what a C4G
-- administrator wrote (EDITORIAL). Nothing is seeded. No object of
-- opportunity_catalog is created, altered or granted here.

CREATE FUNCTION public.opportunity_complement_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'OPPORTUNITY_COMPLEMENT_HISTORY_IMMUTABLE' USING ERRCODE='55000';
END $$;
ALTER FUNCTION public.opportunity_complement_immutable() OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION public.opportunity_complement_immutable() FROM PUBLIC,c4g_central_runtime,c4g_authority_runtime;

-- Append-only history. The current content of a layer is its highest version.
-- opportunity_id is the catalog identifier; it carries no foreign key so that
-- the catalog schema, its owners and its reader grants stay exactly as they are.
-- The service confirms the opportunity exists before every write.
CREATE TABLE public.opportunity_complement_version (
 id uuid PRIMARY KEY,
 opportunity_id uuid NOT NULL,
 layer text NOT NULL CHECK(layer IN ('COLLECTED','EDITORIAL')),
 version integer NOT NULL CHECK(version>0),
 fields jsonb NOT NULL CHECK(jsonb_typeof(fields)='object' AND octet_length(fields::text)<=65536),
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
 source_namespace text,
 source_url text,
 source_modified_at timestamptz,
 observed_at timestamptz,
 description_truncated boolean,
 created_by uuid NOT NULL REFERENCES public.global_user(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(opportunity_id,layer,version),
 UNIQUE(created_by,request_id,opportunity_id,layer),
 CONSTRAINT opportunity_complement_version_source CHECK(
  (layer='COLLECTED' AND source_namespace IS NOT NULL AND source_namespace ~ '^[A-Z][A-Z0-9_]{0,63}$'
   AND source_url IS NOT NULL AND source_url ~ '^https://' AND length(source_url)<=2000
   AND observed_at IS NOT NULL AND description_truncated IS NOT NULL)
  OR (layer='EDITORIAL' AND source_namespace IS NULL AND source_url IS NULL AND source_modified_at IS NULL
   AND observed_at IS NULL AND description_truncated IS NULL))
);
ALTER TABLE public.opportunity_complement_version OWNER TO c4g_authority_owner;
CREATE TRIGGER opportunity_complement_version_immutable BEFORE UPDATE OR DELETE ON public.opportunity_complement_version
 FOR EACH ROW EXECUTE FUNCTION public.opportunity_complement_immutable();
CREATE TRIGGER opportunity_complement_version_no_truncate BEFORE TRUNCATE ON public.opportunity_complement_version
 FOR EACH STATEMENT EXECUTE FUNCTION public.opportunity_complement_immutable();
REVOKE ALL ON public.opportunity_complement_version FROM PUBLIC,c4g_central_runtime,c4g_authority_runtime;
GRANT SELECT ON public.opportunity_complement_version TO c4g_central_runtime;

-- Narrow write boundary: only an active C4G administrator session writes, and
-- the caller chooses neither the author nor the version.
CREATE FUNCTION public.opportunity_complement_write(p_session text,p_actor uuid,p_id uuid,p_opportunity uuid,p_layer text,
 p_fields jsonb,p_sha text,p_source_namespace text,p_source_url text,p_source_modified timestamptz,p_observed timestamptz,
 p_truncated boolean,p_request uuid,p_expected integer)
RETURNS public.opportunity_complement_version LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE current_version integer; prior public.opportunity_complement_version; result public.opportunity_complement_version;
BEGIN
 -- Row locks keep a concurrent revocation from completing under this write.
 PERFORM 1 FROM public.application_session s JOIN public.global_user u ON u.id=s.global_user_id
  JOIN public.platform_admin_assignment a ON a.global_user_id=u.id WHERE s.sid=p_session AND u.id=p_actor
  AND s.status='ACTIVE' AND s.expires_at>clock_timestamp() AND u.status='ACTIVE'
  AND s.revocation_version=u.session_revocation_version AND a.status='ACTIVE' AND a.role_code='C4G_ADMIN'
  FOR SHARE OF s,u,a;
 IF NOT FOUND THEN RAISE EXCEPTION 'C4G_ADMIN_REQUIRED'; END IF;
 IF p_id IS NULL OR p_opportunity IS NULL OR p_layer IS NULL OR p_layer NOT IN ('COLLECTED','EDITORIAL')
  OR p_fields IS NULL OR p_sha IS NULL OR p_request IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('OPPORTUNITY_COMPLEMENT:'||p_opportunity::text||':'||p_layer,53));
 SELECT * INTO prior FROM public.opportunity_complement_version
  WHERE created_by=p_actor AND request_id=p_request AND opportunity_id=p_opportunity AND layer=p_layer;
 IF FOUND THEN
  IF prior.content_sha256<>p_sha OR p_expected IS NULL OR prior.version<>p_expected+1 THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN prior;
 END IF;
 SELECT COALESCE(max(v.version),0) INTO current_version FROM public.opportunity_complement_version v
  WHERE v.opportunity_id=p_opportunity AND v.layer=p_layer;
 IF p_expected IS NULL OR p_expected<>current_version THEN RAISE EXCEPTION 'STALE_REVISION'; END IF;
 INSERT INTO public.opportunity_complement_version(id,opportunity_id,layer,version,fields,content_sha256,
  source_namespace,source_url,source_modified_at,observed_at,description_truncated,created_by,request_id)
 VALUES(p_id,p_opportunity,p_layer,current_version+1,p_fields,p_sha,
  CASE WHEN p_layer='COLLECTED' THEN p_source_namespace END,CASE WHEN p_layer='COLLECTED' THEN p_source_url END,
  CASE WHEN p_layer='COLLECTED' THEN p_source_modified END,CASE WHEN p_layer='COLLECTED' THEN p_observed END,
  CASE WHEN p_layer='COLLECTED' THEN p_truncated END,p_actor,p_request) RETURNING * INTO result;
 RETURN result;
END $$;
ALTER FUNCTION public.opportunity_complement_write(text,uuid,uuid,uuid,text,jsonb,text,text,text,timestamptz,timestamptz,boolean,uuid,integer) OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION public.opportunity_complement_write(text,uuid,uuid,uuid,text,jsonb,text,text,text,timestamptz,timestamptz,boolean,uuid,integer) FROM PUBLIC,c4g_authority_runtime;
GRANT EXECUTE ON FUNCTION public.opportunity_complement_write(text,uuid,uuid,uuid,text,jsonb,text,text,text,timestamptz,timestamptz,boolean,uuid,integer) TO c4g_central_runtime;
