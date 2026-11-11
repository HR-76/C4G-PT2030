CREATE TABLE public.platform_support_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 global_user_id uuid REFERENCES public.global_user(id),
 code text NOT NULL CHECK (code IN ('LOGIN','AUTH_ERROR','API_ERROR')),
 http_status integer CHECK (http_status BETWEEN 500 AND 599),
 CHECK ((code = 'API_ERROR') = (http_status IS NOT NULL))
);
CREATE INDEX platform_support_event_time ON public.platform_support_event(occurred_at DESC,id DESC);
CREATE INDEX platform_support_event_user ON public.platform_support_event(global_user_id,occurred_at DESC);
ALTER TABLE public.platform_support_event OWNER TO c4g_central_owner;
REVOKE ALL ON public.platform_support_event FROM PUBLIC;
GRANT SELECT,INSERT ON public.platform_support_event TO c4g_central_runtime;
