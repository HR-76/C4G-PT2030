-- Refuse to erase unresolved protocol evidence or authority state.
SELECT pg_advisory_xact_lock(43001306,1);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.authority_commit_guard) OR EXISTS(SELECT 1 FROM public.authority_f5_state)
    OR EXISTS(SELECT 1 FROM public.authority_write_permit) OR EXISTS(SELECT 1 FROM public.authority_scope_epoch)
    OR EXISTS(SELECT 1 FROM public.authority_write_request)
  THEN RAISE EXCEPTION 'AUTHORITY_DOWN_HAS_DATA'; END IF;
END $$;
DROP SCHEMA authority_api CASCADE;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['application_session','application_session_store','global_user','organization','organization_membership','authority_f5_state'] LOOP
    EXECUTE format('DROP TRIGGER authority_effect_commit_guard ON public.%I',tab);
  END LOOP;
END $$;
DROP FUNCTION public.authority_effect_commit_guard();
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['application_session','application_session_store','global_user','organization','organization_membership','authority_f5_state','authority_scope_epoch'] LOOP
    EXECUTE format('DROP TRIGGER authority_write_guard ON public.%I',tab);
    EXECUTE format('DROP TRIGGER authority_first_lock ON public.%I',tab);
  END LOOP;
END $$;
DROP FUNCTION public.authority_require_write();
DROP TRIGGER authority_guard_first_lock ON public.authority_commit_guard;
DROP FUNCTION public.authority_metadata_lock();
DROP TABLE public.authority_f5_state,public.authority_commit_guard,public.authority_write_permit,public.authority_scope_epoch,public.authority_write_request;
DROP FUNCTION public.authority_protocol_guard();
DROP SEQUENCE public.authority_epoch_seq;
REVOKE ALL ON public.c4g_database_identity,public.global_user,public.organization,public.organization_membership,
  public.application_session,public.application_session_store,public.oidc_transaction FROM c4g_authority_owner;
REVOKE UPDATE(status,session_revocation_version,updated_at) ON public.global_user FROM c4g_authority_owner;
REVOKE UPDATE(status,mfa_policy_code,updated_at) ON public.organization FROM c4g_authority_owner;
REVOKE ALL ON public.c4g_schema_migration,public.c4g_database_identity FROM c4g_authority_runtime;
REVOKE USAGE ON SCHEMA public FROM c4g_authority_owner;
REVOKE c4g_authority_coordinator FROM c4g_authority_runtime;
REVOKE c4g_authority_owner FROM c4g_central_owner;
DROP ROLE c4g_authority_runtime,c4g_authority_coordinator,c4g_authority_owner;
