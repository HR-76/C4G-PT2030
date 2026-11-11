-- 050_billing_private_documents: additive, explicit installation only.
CREATE TABLE public.billing_document_file (
 id uuid PRIMARY KEY,
 document_id uuid NOT NULL,
 organization_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 object_id uuid NOT NULL UNIQUE,
 filename text NOT NULL CHECK(length(filename) BETWEEN 5 AND 120 AND filename ~* '\.pdf$'),
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 16 AND 10485760),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 scan_state text NOT NULL DEFAULT 'CLEAN' CHECK(scan_state='CLEAN'),
 created_by uuid NOT NULL REFERENCES public.global_user(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(document_id,organization_id) REFERENCES public.billing_fiscal_document(id,organization_id) ON DELETE RESTRICT,
 UNIQUE(document_id,version), UNIQUE(created_by,request_id)
);
ALTER TABLE public.billing_document_file OWNER TO c4g_authority_owner;
CREATE TRIGGER billing_file_immutable BEFORE UPDATE OR DELETE ON public.billing_document_file
 FOR EACH ROW EXECUTE FUNCTION public.billing_immutable();
CREATE TRIGGER billing_file_no_truncate BEFORE TRUNCATE ON public.billing_document_file
 FOR EACH STATEMENT EXECUTE FUNCTION public.billing_immutable();
REVOKE ALL ON public.billing_document_file FROM PUBLIC,c4g_central_runtime,c4g_authority_runtime;
GRANT SELECT ON public.billing_document_file TO c4g_central_runtime;

-- Narrow write boundary: caller cannot choose organization, author or revision.
CREATE FUNCTION public.billing_attach_pdf(p_session text,p_actor uuid,p_document uuid,p_id uuid,p_object uuid,
 p_filename text,p_size integer,p_sha text,p_request uuid,p_expected integer)
RETURNS public.billing_document_file LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org uuid; current_version integer; prior public.billing_document_file; result public.billing_document_file;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.application_session s JOIN public.global_user u ON u.id=s.global_user_id
  JOIN public.platform_admin_assignment a ON a.global_user_id=u.id WHERE s.sid=p_session AND u.id=p_actor
  AND s.status='ACTIVE' AND s.expires_at>clock_timestamp() AND u.status='ACTIVE'
  AND s.revocation_version=u.session_revocation_version AND a.status='ACTIVE' AND a.role_code='C4G_ADMIN'
  FOR SHARE OF s,u,a) THEN RAISE EXCEPTION 'C4G_ADMIN_REQUIRED'; END IF;
 SELECT d.organization_id INTO org FROM public.billing_fiscal_document d JOIN public.organization o ON o.id=d.organization_id
  WHERE d.id=p_document AND o.status='ACTIVE' FOR SHARE OF d,o;
 IF org IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('BILLING_PDF:'||p_document::text,50));
 SELECT * INTO prior FROM public.billing_document_file WHERE created_by=p_actor AND request_id=p_request;
 IF FOUND THEN
  IF prior.document_id<>p_document OR prior.sha256<>p_sha OR prior.size_bytes<>p_size
   OR prior.filename<>p_filename OR prior.version<>p_expected+1 THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN prior;
 END IF;
 SELECT COALESCE(max(version),0) INTO current_version FROM public.billing_document_file WHERE document_id=p_document;
 IF p_expected IS NULL OR p_expected<>current_version THEN RAISE EXCEPTION 'STALE_REVISION'; END IF;
 INSERT INTO public.billing_document_file(id,document_id,organization_id,version,object_id,filename,size_bytes,sha256,created_by,request_id)
 VALUES(p_id,p_document,org,current_version+1,p_object,p_filename,p_size,p_sha,p_actor,p_request) RETURNING * INTO result;
 RETURN result;
END $$;
ALTER FUNCTION public.billing_attach_pdf(text,uuid,uuid,uuid,uuid,text,integer,text,uuid,integer) OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION public.billing_attach_pdf(text,uuid,uuid,uuid,uuid,text,integer,text,uuid,integer) FROM PUBLIC,c4g_authority_runtime;
GRANT EXECUTE ON FUNCTION public.billing_attach_pdf(text,uuid,uuid,uuid,uuid,text,integer,text,uuid,integer) TO c4g_central_runtime;

CREATE FUNCTION public.billing_pdf_admin(p_session text,p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.application_session s JOIN public.global_user u ON u.id=s.global_user_id
 JOIN public.platform_admin_assignment a ON a.global_user_id=u.id WHERE s.sid=p_session AND u.id=p_actor
 AND s.status='ACTIVE' AND s.expires_at>clock_timestamp() AND u.status='ACTIVE'
 AND s.revocation_version=u.session_revocation_version AND a.status='ACTIVE' AND a.role_code='C4G_ADMIN');
$$;
ALTER FUNCTION public.billing_pdf_admin(text,uuid) OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION public.billing_pdf_admin(text,uuid) FROM PUBLIC,c4g_authority_runtime;
GRANT EXECUTE ON FUNCTION public.billing_pdf_admin(text,uuid) TO c4g_central_runtime;
