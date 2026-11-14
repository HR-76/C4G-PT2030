-- 051_email_templates: additive, explicit installation only. Nothing is seeded:
-- the built-in template lives in code and applies while no row exists.

CREATE FUNCTION public.email_record_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'EMAIL_HISTORY_IMMUTABLE' USING ERRCODE='55000';
END $$;
ALTER FUNCTION public.email_record_immutable() OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION public.email_record_immutable() FROM PUBLIC,c4g_central_runtime,c4g_authority_runtime;

-- Append-only history. The current template of a scope is its highest version;
-- a RESET row means "no own template" from then on. organization_id NULL is the
-- global template.
CREATE TABLE public.email_template_version (
 id uuid PRIMARY KEY,
 template_type text NOT NULL CHECK(template_type IN ('MEMBER_INVITATION')),
 organization_id uuid REFERENCES public.organization(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0),
 action text NOT NULL CHECK(action IN ('SAVE','RESET')),
 subject text,
 html text,
 content_sha256 text,
 created_by uuid NOT NULL REFERENCES public.global_user(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(created_by,request_id),
 CONSTRAINT email_template_version_content CHECK(
  (action='SAVE' AND subject IS NOT NULL AND html IS NOT NULL AND content_sha256 IS NOT NULL
   AND length(subject) BETWEEN 1 AND 200 AND subject=btrim(subject) AND subject !~ '[[:cntrl:]]'
   AND length(html) BETWEEN 1 AND 20000 AND content_sha256 ~ '^[a-f0-9]{64}$')
  OR (action='RESET' AND subject IS NULL AND html IS NULL AND content_sha256 IS NULL))
);
CREATE UNIQUE INDEX email_template_version_global ON public.email_template_version(template_type,version) WHERE organization_id IS NULL;
CREATE UNIQUE INDEX email_template_version_organization ON public.email_template_version(template_type,organization_id,version) WHERE organization_id IS NOT NULL;
ALTER TABLE public.email_template_version OWNER TO c4g_authority_owner;
CREATE TRIGGER email_template_version_immutable BEFORE UPDATE OR DELETE ON public.email_template_version
 FOR EACH ROW EXECUTE FUNCTION public.email_record_immutable();
CREATE TRIGGER email_template_version_no_truncate BEFORE TRUNCATE ON public.email_template_version
 FOR EACH STATEMENT EXECUTE FUNCTION public.email_record_immutable();
REVOKE ALL ON public.email_template_version FROM PUBLIC,c4g_central_runtime,c4g_authority_runtime;
GRANT SELECT ON public.email_template_version TO c4g_central_runtime;

-- Append-only logo history. organization_id NULL is the C4G logo. public_id is
-- the unguessable name under which the image is served without a session.
CREATE TABLE public.email_logo_version (
 id uuid PRIMARY KEY,
 organization_id uuid REFERENCES public.organization(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0),
 action text NOT NULL CHECK(action IN ('SET','REMOVE')),
 public_id text UNIQUE,
 mime_type text,
 width integer,
 height integer,
 size_bytes integer,
 sha256 text,
 content bytea,
 created_by uuid NOT NULL REFERENCES public.global_user(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(created_by,request_id),
 CONSTRAINT email_logo_version_content CHECK(
  (action='SET' AND public_id IS NOT NULL AND mime_type IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL
   AND size_bytes IS NOT NULL AND sha256 IS NOT NULL AND content IS NOT NULL
   AND public_id ~ '^[a-f0-9]{32}$' AND mime_type IN ('image/png','image/jpeg')
   AND width BETWEEN 1 AND 1200 AND height BETWEEN 1 AND 600 AND size_bytes BETWEEN 1 AND 524288
   AND octet_length(content)=size_bytes AND sha256=encode(sha256(content),'hex'))
  OR (action='REMOVE' AND public_id IS NULL AND mime_type IS NULL AND width IS NULL AND height IS NULL
   AND size_bytes IS NULL AND sha256 IS NULL AND content IS NULL))
);
CREATE UNIQUE INDEX email_logo_version_platform ON public.email_logo_version(version) WHERE organization_id IS NULL;
CREATE UNIQUE INDEX email_logo_version_organization ON public.email_logo_version(organization_id,version) WHERE organization_id IS NOT NULL;
ALTER TABLE public.email_logo_version OWNER TO c4g_authority_owner;
CREATE TRIGGER email_logo_version_immutable BEFORE UPDATE OR DELETE ON public.email_logo_version
 FOR EACH ROW EXECUTE FUNCTION public.email_record_immutable();
CREATE TRIGGER email_logo_version_no_truncate BEFORE TRUNCATE ON public.email_logo_version
 FOR EACH STATEMENT EXECUTE FUNCTION public.email_record_immutable();
REVOKE ALL ON public.email_logo_version FROM PUBLIC,c4g_central_runtime,c4g_authority_runtime;
GRANT SELECT ON public.email_logo_version TO c4g_central_runtime;

-- Who may edit templates and the C4G logo: an active C4G administrator session.
CREATE FUNCTION public.email_platform_admin(p_session text,p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.application_session s JOIN public.global_user u ON u.id=s.global_user_id
 JOIN public.platform_admin_assignment a ON a.global_user_id=u.id WHERE s.sid=p_session AND u.id=p_actor
 AND s.status='ACTIVE' AND s.expires_at>clock_timestamp() AND u.status='ACTIVE'
 AND s.revocation_version=u.session_revocation_version AND a.status='ACTIVE' AND a.role_code='C4G_ADMIN');
$$;
ALTER FUNCTION public.email_platform_admin(text,uuid) OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION public.email_platform_admin(text,uuid) FROM PUBLIC,c4g_authority_runtime;
GRANT EXECUTE ON FUNCTION public.email_platform_admin(text,uuid) TO c4g_central_runtime;

-- Who may change an entity's logo: that entity's own administrator, in a session
-- that selected the entity. A C4G administrator is deliberately not enough.
CREATE FUNCTION public.email_organization_admin(p_session text,p_actor uuid,p_organization uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.application_session s JOIN public.global_user u ON u.id=s.global_user_id
 JOIN public.organization o ON o.id=p_organization AND o.status='ACTIVE'
 JOIN public.organization_membership m ON m.id=s.selected_membership_id AND m.organization_id=o.id
  AND m.global_user_id=u.id AND m.membership_version=s.selected_membership_version
 WHERE s.sid=p_session AND u.id=p_actor AND s.selected_organization_id=o.id
 AND s.status='ACTIVE' AND s.expires_at>clock_timestamp() AND u.status='ACTIVE'
 AND s.revocation_version=u.session_revocation_version
 AND m.status='ACTIVE' AND m.base_role_code='ORG_ADMIN'
 AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()));
$$;
ALTER FUNCTION public.email_organization_admin(text,uuid,uuid) OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION public.email_organization_admin(text,uuid,uuid) FROM PUBLIC,c4g_authority_runtime;
GRANT EXECUTE ON FUNCTION public.email_organization_admin(text,uuid,uuid) TO c4g_central_runtime;

-- Narrow write boundary for templates: the caller cannot choose the author or
-- the version, and cannot write without an administrator session.
CREATE FUNCTION public.email_template_write(p_session text,p_actor uuid,p_type text,p_organization uuid,p_id uuid,
 p_action text,p_subject text,p_html text,p_sha text,p_request uuid,p_expected integer)
RETURNS public.email_template_version LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE current_version integer; current_action text; prior public.email_template_version; result public.email_template_version;
BEGIN
 -- Row locks keep a concurrent revocation from completing under this write.
 PERFORM 1 FROM public.application_session s JOIN public.global_user u ON u.id=s.global_user_id
  JOIN public.platform_admin_assignment a ON a.global_user_id=u.id WHERE s.sid=p_session AND u.id=p_actor
  AND s.status='ACTIVE' AND s.expires_at>clock_timestamp() AND u.status='ACTIVE'
  AND s.revocation_version=u.session_revocation_version AND a.status='ACTIVE' AND a.role_code='C4G_ADMIN'
  FOR SHARE OF s,u,a;
 IF NOT FOUND THEN RAISE EXCEPTION 'C4G_ADMIN_REQUIRED'; END IF;
 IF p_type IS NULL OR p_action IS NULL OR p_action NOT IN ('SAVE','RESET') OR p_request IS NULL OR p_id IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 IF p_organization IS NOT NULL THEN
  PERFORM 1 FROM public.organization o WHERE o.id=p_organization AND o.status='ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('EMAIL_TEMPLATE:'||p_type||':'||COALESCE(p_organization::text,'GLOBAL'),51));
 SELECT * INTO prior FROM public.email_template_version WHERE created_by=p_actor AND request_id=p_request;
 IF FOUND THEN
  IF prior.template_type<>p_type OR prior.organization_id IS DISTINCT FROM p_organization OR prior.action<>p_action
   OR prior.content_sha256 IS DISTINCT FROM p_sha OR p_expected IS NULL OR prior.version<>p_expected+1 THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN prior;
 END IF;
 SELECT v.version,v.action INTO current_version,current_action FROM public.email_template_version v
  WHERE v.template_type=p_type AND v.organization_id IS NOT DISTINCT FROM p_organization ORDER BY v.version DESC LIMIT 1;
 current_version:=COALESCE(current_version,0);
 IF p_expected IS NULL OR p_expected<>current_version THEN RAISE EXCEPTION 'STALE_REVISION'; END IF;
 IF p_action='RESET' AND (current_version=0 OR current_action='RESET') THEN RAISE EXCEPTION 'EMAIL_TEMPLATE_NOT_CUSTOMIZED'; END IF;
 INSERT INTO public.email_template_version(id,template_type,organization_id,version,action,subject,html,content_sha256,created_by,request_id)
 VALUES(p_id,p_type,p_organization,current_version+1,p_action,
  CASE WHEN p_action='SAVE' THEN p_subject END,CASE WHEN p_action='SAVE' THEN p_html END,CASE WHEN p_action='SAVE' THEN p_sha END,
  p_actor,p_request) RETURNING * INTO result;
 RETURN result;
END $$;
ALTER FUNCTION public.email_template_write(text,uuid,text,uuid,uuid,text,text,text,text,uuid,integer) OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION public.email_template_write(text,uuid,text,uuid,uuid,text,text,text,text,uuid,integer) FROM PUBLIC,c4g_authority_runtime;
GRANT EXECUTE ON FUNCTION public.email_template_write(text,uuid,text,uuid,uuid,text,text,text,text,uuid,integer) TO c4g_central_runtime;

-- Narrow write boundary for logos. Size and digest are computed here from the
-- bytes, so the caller cannot declare them. p_content NULL removes the logo.
CREATE FUNCTION public.email_logo_write(p_session text,p_actor uuid,p_organization uuid,p_id uuid,p_public text,
 p_mime text,p_width integer,p_height integer,p_content bytea,p_request uuid,p_expected integer)
RETURNS public.email_logo_version LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE current_version integer; current_action text; prior public.email_logo_version; result public.email_logo_version;
 next_action text:=CASE WHEN p_content IS NULL THEN 'REMOVE' ELSE 'SET' END;
 digest text:=CASE WHEN p_content IS NULL THEN NULL ELSE encode(sha256(p_content),'hex') END;
BEGIN
 -- Row locks keep a concurrent revocation from completing under this write.
 IF p_organization IS NULL THEN
  PERFORM 1 FROM public.application_session s JOIN public.global_user u ON u.id=s.global_user_id
   JOIN public.platform_admin_assignment a ON a.global_user_id=u.id WHERE s.sid=p_session AND u.id=p_actor
   AND s.status='ACTIVE' AND s.expires_at>clock_timestamp() AND u.status='ACTIVE'
   AND s.revocation_version=u.session_revocation_version AND a.status='ACTIVE' AND a.role_code='C4G_ADMIN'
   FOR SHARE OF s,u,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'C4G_ADMIN_REQUIRED'; END IF;
 ELSE
  PERFORM 1 FROM public.application_session s JOIN public.global_user u ON u.id=s.global_user_id
   JOIN public.organization o ON o.id=p_organization AND o.status='ACTIVE'
   JOIN public.organization_membership m ON m.id=s.selected_membership_id AND m.organization_id=o.id
    AND m.global_user_id=u.id AND m.membership_version=s.selected_membership_version
   WHERE s.sid=p_session AND u.id=p_actor AND s.selected_organization_id=o.id
   AND s.status='ACTIVE' AND s.expires_at>clock_timestamp() AND u.status='ACTIVE'
   AND s.revocation_version=u.session_revocation_version
   AND m.status='ACTIVE' AND m.base_role_code='ORG_ADMIN'
   AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())
   FOR SHARE OF s,u,o,m;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
 END IF;
 IF p_request IS NULL OR p_id IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('EMAIL_LOGO:'||COALESCE(p_organization::text,'C4G'),51));
 SELECT * INTO prior FROM public.email_logo_version WHERE created_by=p_actor AND request_id=p_request;
 IF FOUND THEN
  IF prior.organization_id IS DISTINCT FROM p_organization OR prior.action<>next_action
   OR prior.sha256 IS DISTINCT FROM digest OR p_expected IS NULL OR prior.version<>p_expected+1 THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN prior;
 END IF;
 SELECT v.version,v.action INTO current_version,current_action FROM public.email_logo_version v
  WHERE v.organization_id IS NOT DISTINCT FROM p_organization ORDER BY v.version DESC LIMIT 1;
 current_version:=COALESCE(current_version,0);
 IF p_expected IS NULL OR p_expected<>current_version THEN RAISE EXCEPTION 'STALE_REVISION'; END IF;
 IF next_action='REMOVE' AND (current_version=0 OR current_action='REMOVE') THEN RAISE EXCEPTION 'EMAIL_LOGO_NOT_SET'; END IF;
 INSERT INTO public.email_logo_version(id,organization_id,version,action,public_id,mime_type,width,height,size_bytes,sha256,content,created_by,request_id)
 VALUES(p_id,p_organization,current_version+1,next_action,
  CASE WHEN next_action='SET' THEN p_public END,CASE WHEN next_action='SET' THEN p_mime END,
  CASE WHEN next_action='SET' THEN p_width END,CASE WHEN next_action='SET' THEN p_height END,
  octet_length(p_content),digest,p_content,p_actor,p_request) RETURNING * INTO result;
 RETURN result;
END $$;
ALTER FUNCTION public.email_logo_write(text,uuid,uuid,uuid,text,text,integer,integer,bytea,uuid,integer) OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION public.email_logo_write(text,uuid,uuid,uuid,text,text,integer,integer,bytea,uuid,integer) FROM PUBLIC,c4g_authority_runtime;
GRANT EXECUTE ON FUNCTION public.email_logo_write(text,uuid,uuid,uuid,text,text,integer,integer,bytea,uuid,integer) TO c4g_central_runtime;
