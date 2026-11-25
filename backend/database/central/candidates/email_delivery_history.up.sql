-- Candidate 056; explicit installation only after the isolated security gate.
CREATE TABLE public.email_delivery_history (
 id uuid PRIMARY KEY,
 organization_id uuid REFERENCES public.organization(id) ON DELETE SET NULL,
 recipient varchar(254),
 occurred_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 result text NOT NULL DEFAULT 'UNCONFIRMED' CHECK (result IN ('UNCONFIRMED','ACCEPTED','NOT_CONFIGURED')),
 is_test boolean NOT NULL DEFAULT false,
 CHECK (recipient IS NULL OR (length(recipient)>3 AND recipient !~ '[[:cntrl:][:space:]]'))
);
ALTER TABLE public.email_delivery_history OWNER TO c4g_authority_owner;
CREATE INDEX email_delivery_history_page ON public.email_delivery_history(occurred_at DESC,id DESC);
CREATE INDEX email_delivery_history_retention ON public.email_delivery_history(occurred_at) WHERE recipient IS NOT NULL;
REVOKE ALL ON public.email_delivery_history FROM PUBLIC,c4g_authority_runtime,c4g_central_runtime;

-- Runtime can neither list recipients directly nor write arbitrary SQL.
CREATE FUNCTION public.email_delivery_begin(p_id uuid,p_organization uuid,p_recipient text,p_test boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.email_delivery_history;
BEGIN
 IF p_id IS NULL OR p_test IS NULL OR p_recipient IS NULL OR length(p_recipient)>254
    OR p_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 INSERT INTO public.email_delivery_history(id,organization_id,recipient,is_test)
 VALUES(p_id,p_organization,p_recipient,p_test) ON CONFLICT(id) DO NOTHING;
 SELECT * INTO STRICT prior FROM public.email_delivery_history WHERE id=p_id;
 IF prior.organization_id IS DISTINCT FROM p_organization OR prior.is_test<>p_test
    OR (prior.recipient IS NOT NULL AND prior.recipient<>p_recipient) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
 -- Replays never restore an anonymized address or move its retention deadline.
 RETURN prior.result;
END $$;
CREATE FUNCTION public.email_delivery_finish(p_id uuid,p_result text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF p_result IS NULL OR p_result NOT IN ('ACCEPTED','UNCONFIRMED','NOT_CONFIGURED') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 UPDATE public.email_delivery_history SET result=p_result WHERE id=p_id AND result<>'ACCEPTED';
 IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM public.email_delivery_history WHERE id=p_id) THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE'; END IF;
END $$;
CREATE FUNCTION public.email_delivery_retention() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE affected bigint;
BEGIN
 UPDATE public.email_delivery_history SET recipient=NULL
 WHERE recipient IS NOT NULL AND occurred_at<=clock_timestamp()-interval '90 days';
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected;
END $$;
CREATE FUNCTION public.email_delivery_list(p_session text,p_actor uuid,p_before timestamptz,p_id uuid,p_result text)
RETURNS TABLE(id uuid,organization_id uuid,recipient text,occurred_at timestamptz,result text,is_test boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT public.email_platform_admin(p_session,p_actor) THEN RAISE EXCEPTION 'C4G_ADMIN_REQUIRED'; END IF;
 IF p_before IS NULL OR p_id IS NULL OR p_result IS NULL OR p_result NOT IN ('','ACCEPTED','UNCONFIRMED','NOT_CONFIGURED') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 RETURN QUERY SELECT d.id,d.organization_id,
 CASE WHEN d.occurred_at<=clock_timestamp()-interval '90 days' THEN NULL ELSE d.recipient::text END,
 d.occurred_at,d.result,d.is_test
 FROM public.email_delivery_history d WHERE (d.occurred_at,d.id)<=(p_before,p_id)
 AND (p_result='' OR d.result=p_result) ORDER BY d.occurred_at DESC,d.id DESC LIMIT 52;
END $$;
ALTER FUNCTION public.email_delivery_begin(uuid,uuid,text,boolean) OWNER TO c4g_authority_owner;
ALTER FUNCTION public.email_delivery_finish(uuid,text) OWNER TO c4g_authority_owner;
ALTER FUNCTION public.email_delivery_retention() OWNER TO c4g_authority_owner;
ALTER FUNCTION public.email_delivery_list(text,uuid,timestamptz,uuid,text) OWNER TO c4g_authority_owner;
REVOKE ALL ON FUNCTION public.email_delivery_begin(uuid,uuid,text,boolean),public.email_delivery_finish(uuid,text),public.email_delivery_retention(),public.email_delivery_list(text,uuid,timestamptz,uuid,text) FROM PUBLIC,c4g_authority_runtime;
GRANT EXECUTE ON FUNCTION public.email_delivery_begin(uuid,uuid,text,boolean),public.email_delivery_finish(uuid,text),public.email_delivery_retention(),public.email_delivery_list(text,uuid,timestamptz,uuid,text) TO c4g_central_runtime;
