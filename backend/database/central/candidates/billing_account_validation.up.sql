-- Central 054. Explicit installation after 053; never applied by API startup.
-- Requests and confirmations are separate, append-only records. Email delivery
-- is an outbox intent; no external side effect occurs inside these functions.
CREATE TABLE public.billing_account_validation_request (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES public.organization(id),
 account_version_id uuid NOT NULL,
 requested_by uuid NOT NULL REFERENCES public.global_user(id),
 request_key uuid NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(account_version_id,organization_id) REFERENCES public.billing_account_version(id,organization_id),
 UNIQUE(organization_id,account_version_id),
 UNIQUE(requested_by,request_key)
);
CREATE TABLE public.billing_account_validation_confirmation (
 request_id uuid PRIMARY KEY REFERENCES public.billing_account_validation_request(id),
 confirmed_by uuid NOT NULL REFERENCES public.global_user(id),
 confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.billing_account_validation_email (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL REFERENCES public.billing_account_validation_request(id),
 recipient_id uuid NOT NULL REFERENCES public.global_user(id),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','ACCEPTED','CANCELLED','FAILED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 accepted_at timestamptz,
 first_attempt_at timestamptz,
 lease_token uuid,
 recipient_email text,
 UNIQUE(request_id,recipient_id)
);
ALTER TABLE public.billing_account_validation_request OWNER TO c4g_authority_owner;
ALTER TABLE public.billing_account_validation_confirmation OWNER TO c4g_authority_owner;
ALTER TABLE public.billing_account_validation_email OWNER TO c4g_authority_owner;
REVOKE ALL ON public.billing_account_validation_request,public.billing_account_validation_confirmation,
 public.billing_account_validation_email FROM PUBLIC,c4g_central_runtime,c4g_authority_runtime;
CREATE TRIGGER billing_validation_request_immutable BEFORE UPDATE OR DELETE ON public.billing_account_validation_request
 FOR EACH ROW EXECUTE FUNCTION public.email_record_immutable();
CREATE TRIGGER billing_validation_request_no_truncate BEFORE TRUNCATE ON public.billing_account_validation_request
 FOR EACH STATEMENT EXECUTE FUNCTION public.email_record_immutable();
CREATE TRIGGER billing_validation_confirmation_immutable BEFORE UPDATE OR DELETE ON public.billing_account_validation_confirmation
 FOR EACH ROW EXECUTE FUNCTION public.email_record_immutable();
CREATE TRIGGER billing_validation_confirmation_no_truncate BEFORE TRUNCATE ON public.billing_account_validation_confirmation
 FOR EACH STATEMENT EXECUTE FUNCTION public.email_record_immutable();

CREATE FUNCTION public.billing_validation_request(p_session text,p_actor uuid,p_organization uuid,
 p_version uuid,p_key uuid,p_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prior public.billing_account_validation_request; current_id uuid; recipients integer;
BEGIN
 PERFORM 1 FROM public.application_session s JOIN public.global_user u ON u.id=s.global_user_id
 JOIN public.platform_admin_assignment a ON a.global_user_id=u.id
 WHERE s.sid=p_session AND u.id=p_actor AND s.status='ACTIVE' AND s.expires_at>clock_timestamp()
 AND s.revocation_version=u.session_revocation_version AND u.status='ACTIVE'
 AND a.role_code='C4G_ADMIN' AND a.status='ACTIVE' FOR SHARE OF s,u,a;
 IF NOT FOUND THEN RAISE EXCEPTION 'C4G_ADMIN_REQUIRED'; END IF;
 PERFORM 1 FROM public.organization WHERE id=p_organization AND status='ACTIVE' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE'; END IF;
 -- The account lock serializes request creation, confirmation and account edits.
 SELECT v.id INTO current_id FROM public.billing_account a
 JOIN public.billing_account_version v ON v.billing_account_id=a.id AND v.organization_id=a.organization_id
 AND v.version=a.current_version WHERE a.organization_id=p_organization FOR UPDATE OF a;
 IF current_id IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE'; END IF;
 SELECT * INTO prior FROM public.billing_account_validation_request WHERE requested_by=p_actor AND request_key=p_key;
 IF FOUND THEN
  IF prior.organization_id<>p_organization OR prior.account_version_id<>p_version THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN prior.id;
 END IF;
 IF current_id<>p_version THEN RAISE EXCEPTION 'STALE_REVISION'; END IF;
 SELECT * INTO prior FROM public.billing_account_validation_request
 WHERE organization_id=p_organization AND account_version_id=p_version;
 IF FOUND THEN RETURN prior.id; END IF;
 INSERT INTO public.billing_account_validation_request(id,organization_id,account_version_id,requested_by,request_key)
 VALUES(p_id,p_organization,p_version,p_actor,p_key);
 INSERT INTO public.billing_account_validation_email(id,request_id,recipient_id)
 SELECT gen_random_uuid(),p_id,u.id FROM public.global_user u
 WHERE u.status='ACTIVE' AND u.primary_email IS NOT NULL AND btrim(u.primary_email)<>''
 AND EXISTS(SELECT 1 FROM public.organization_membership m WHERE m.global_user_id=u.id
 AND m.organization_id=p_organization AND m.status='ACTIVE' AND m.base_role_code='ORG_ADMIN'
 AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()));
 GET DIAGNOSTICS recipients=ROW_COUNT;
 IF recipients=0 THEN RAISE EXCEPTION 'BILLING_VALIDATION_NO_RECIPIENT'; END IF;
 RETURN p_id;
END $$;
ALTER FUNCTION public.billing_validation_request(text,uuid,uuid,uuid,uuid,uuid) OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION public.billing_validation_request(text,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,c4g_authority_runtime;
GRANT EXECUTE ON FUNCTION public.billing_validation_request(text,uuid,uuid,uuid,uuid,uuid) TO c4g_central_runtime;

CREATE FUNCTION public.billing_validation_confirm(p_session text,p_actor uuid,p_organization uuid,p_request uuid,p_version uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE current_id uuid; requested_version uuid;
BEGIN
 PERFORM 1 FROM public.application_session s JOIN public.global_user u ON u.id=s.global_user_id
 JOIN public.organization o ON o.id=p_organization AND o.status='ACTIVE'
 JOIN public.organization_membership m ON m.id=s.selected_membership_id AND m.organization_id=o.id
 AND m.global_user_id=u.id AND m.membership_version=s.selected_membership_version
 WHERE s.sid=p_session AND u.id=p_actor AND s.selected_organization_id=o.id
 AND s.status='ACTIVE' AND s.expires_at>clock_timestamp() AND u.status='ACTIVE'
 AND s.revocation_version=u.session_revocation_version AND m.status='ACTIVE' AND m.base_role_code='ORG_ADMIN'
 AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())
 FOR SHARE OF s,u,o,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
 SELECT v.id INTO current_id FROM public.billing_account a
 JOIN public.billing_account_version v ON v.billing_account_id=a.id AND v.organization_id=a.organization_id
 AND v.version=a.current_version WHERE a.organization_id=p_organization FOR UPDATE OF a;
 SELECT account_version_id INTO requested_version FROM public.billing_account_validation_request
 WHERE id=p_request AND organization_id=p_organization;
 IF requested_version IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE'; END IF;
 IF current_id IS DISTINCT FROM p_version OR requested_version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'STALE_REVISION'; END IF;
 INSERT INTO public.billing_account_validation_confirmation(request_id,confirmed_by) VALUES(p_request,p_actor)
 ON CONFLICT(request_id) DO NOTHING;
 RETURN p_request;
END $$;
ALTER FUNCTION public.billing_validation_confirm(text,uuid,uuid,uuid,uuid) OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION public.billing_validation_confirm(text,uuid,uuid,uuid,uuid) FROM PUBLIC,c4g_authority_runtime;
GRANT EXECUTE ON FUNCTION public.billing_validation_confirm(text,uuid,uuid,uuid,uuid) TO c4g_central_runtime;


-- This projection is the only read surface; internal account notes never leave it.
CREATE FUNCTION public.billing_validation_read(p_session text,p_actor uuid,p_organization uuid,p_admin boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v public.billing_account_version; r public.billing_account_validation_request; c public.billing_account_validation_confirmation;
BEGIN
 IF p_admin THEN
  IF NOT public.email_platform_admin(p_session,p_actor) THEN RAISE EXCEPTION 'C4G_ADMIN_REQUIRED'; END IF;
 ELSE
  IF NOT public.email_organization_admin(p_session,p_actor,p_organization) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization WHERE id=p_organization AND status='ACTIVE') THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE'; END IF;
 SELECT av.* INTO v FROM public.billing_account a JOIN public.billing_account_version av
 ON av.billing_account_id=a.id AND av.organization_id=a.organization_id AND av.version=a.current_version
 WHERE a.organization_id=p_organization;
 IF v.id IS NULL THEN RETURN jsonb_build_object('enabled',true,'account',NULL,'status','NOT_REQUESTED'); END IF;
 SELECT * INTO r FROM public.billing_account_validation_request WHERE organization_id=p_organization ORDER BY requested_at DESC,id DESC LIMIT 1;
 SELECT * INTO c FROM public.billing_account_validation_confirmation WHERE request_id=r.id;
 RETURN jsonb_build_object('enabled',true,'organizationId',p_organization,'versionId',v.id,'requestId',r.id,
 'requestedAt',r.requested_at,'confirmedAt',c.confirmed_at,
 'status',CASE WHEN r.id IS NULL THEN 'NOT_REQUESTED' WHEN r.account_version_id<>v.id THEN 'OUTDATED' WHEN c.request_id IS NOT NULL THEN 'CONFIRMED' ELSE 'PENDING' END,
 'email',CASE WHEN NOT p_admin THEN NULL ELSE (SELECT jsonb_build_object('pending',count(*) FILTER(WHERE state='PENDING'),
 'accepted',count(*) FILTER(WHERE state='ACCEPTED'),'failed',count(*) FILTER(WHERE state='FAILED'),'cancelled',count(*) FILTER(WHERE state='CANCELLED'))
 FROM public.billing_account_validation_email WHERE request_id=r.id) END,
 'account',jsonb_build_object('legalName',v.legal_name,'taxIdentifier',v.tax_identifier,'taxCountry',v.tax_country,
 'addressLine1',v.address_line_1,'addressLine2',v.address_line_2,'postalCode',v.postal_code,'locality',v.locality,
 'region',v.region,'billingEmail',v.billing_email,'contactName',v.contact_name));
END $$;
ALTER FUNCTION public.billing_validation_read(text,uuid,uuid,boolean) OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION public.billing_validation_read(text,uuid,uuid,boolean) FROM PUBLIC,c4g_authority_runtime;
GRANT EXECUTE ON FUNCTION public.billing_validation_read(text,uuid,uuid,boolean) TO c4g_central_runtime;

-- Dedicated no-login worker role. The API cannot claim deliveries or mark mail sent.
CREATE ROLE c4g_billing_validation_worker NOLOGIN;
CREATE FUNCTION public.billing_validation_email_claim() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.billing_account_validation_email; r public.billing_account_validation_request; destination text; org_name text; token uuid;
BEGIN
 SELECT * INTO e FROM public.billing_account_validation_email WHERE state='PENDING' AND available_at<=clock_timestamp()
 ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public.billing_account_validation_request WHERE id=e.request_id;
 SELECT u.primary_email,v.legal_name INTO destination,org_name FROM public.global_user u
 JOIN public.organization o ON o.id=r.organization_id AND o.status='ACTIVE'
 JOIN public.billing_account a ON a.organization_id=o.id
 JOIN public.billing_account_version v ON v.billing_account_id=a.id AND v.organization_id=o.id AND v.version=a.current_version AND v.id=r.account_version_id
 WHERE u.id=e.recipient_id AND u.status='ACTIVE' AND u.primary_email IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM public.billing_account_validation_confirmation WHERE request_id=r.id)
 AND EXISTS(SELECT 1 FROM public.organization_membership m WHERE m.global_user_id=u.id AND m.organization_id=o.id
 AND m.status='ACTIVE' AND m.base_role_code='ORG_ADMIN' AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()));
 IF destination IS NULL OR (e.recipient_email IS NOT NULL AND e.recipient_email<>destination) THEN
  UPDATE public.billing_account_validation_email SET state='CANCELLED',lease_token=NULL WHERE id=e.id;
  RETURN jsonb_build_object('skipped',true);
 END IF;
 -- Resend idempotency is bounded. Never replay an uncertain send on a later day.
 IF e.attempts>=8 OR e.first_attempt_at<clock_timestamp()-interval '20 hours' THEN
  UPDATE public.billing_account_validation_email SET state='FAILED',lease_token=NULL WHERE id=e.id;
  RETURN jsonb_build_object('skipped',true);
 END IF;
 token:=gen_random_uuid();
 UPDATE public.billing_account_validation_email SET attempts=attempts+1,lease_token=token,
 available_at=clock_timestamp()+interval '2 minutes',first_attempt_at=COALESCE(first_attempt_at,clock_timestamp()),
 recipient_email=destination WHERE id=e.id;
 RETURN jsonb_build_object('id',e.id,'token',token,'to',destination,'organizationId',r.organization_id,'organizationName',org_name);
END $$;
CREATE FUNCTION public.billing_validation_email_finish(p_id uuid,p_token uuid,p_accepted boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.billing_account_validation_email SET state=CASE WHEN p_accepted THEN 'ACCEPTED' WHEN attempts>=8 THEN 'FAILED' ELSE 'PENDING' END,
 accepted_at=CASE WHEN p_accepted THEN clock_timestamp() ELSE NULL END,lease_token=NULL,
 available_at=clock_timestamp()+interval '5 minutes'
 WHERE id=p_id AND lease_token=p_token AND state='PENDING' AND available_at>clock_timestamp();
 RETURN FOUND;
END $$;
ALTER FUNCTION public.billing_validation_email_claim() OWNER TO c4g_authority_owner;
ALTER FUNCTION public.billing_validation_email_finish(uuid,uuid,boolean) OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION public.billing_validation_email_claim(),public.billing_validation_email_finish(uuid,uuid,boolean) FROM PUBLIC,c4g_central_runtime,c4g_authority_runtime;
GRANT USAGE ON SCHEMA public TO c4g_billing_validation_worker;
GRANT EXECUTE ON FUNCTION public.billing_validation_email_claim(),public.billing_validation_email_finish(uuid,uuid,boolean) TO c4g_billing_validation_worker;
