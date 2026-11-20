-- Central 057: approved production capability boundary. No service login or password is created here.
CREATE ROLE c4g_prod_read_role NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE c4g_prod_commands_role NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE c4g_prod_authoring_role NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE c4g_prod_logs_role NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE c4g_prod_retention_role NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE c4g_prod_gate_owner_role NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA c4g_production AUTHORIZATION c4g_prod_gate_owner_role;
REVOKE ALL ON SCHEMA c4g_production FROM PUBLIC;
GRANT USAGE ON SCHEMA public,c4g_production TO c4g_prod_read_role;
GRANT SELECT ON public.c4g_database_identity,public.c4g_schema_migration TO c4g_prod_read_role;
GRANT USAGE ON SCHEMA public,c4g_production TO c4g_prod_commands_role;
GRANT SELECT ON public.c4g_database_identity,public.c4g_schema_migration TO c4g_prod_commands_role;
GRANT USAGE ON SCHEMA public,c4g_production TO c4g_prod_authoring_role;
GRANT SELECT ON public.c4g_database_identity,public.c4g_schema_migration TO c4g_prod_authoring_role;
GRANT USAGE ON SCHEMA public,c4g_production TO c4g_prod_logs_role;
GRANT SELECT ON public.c4g_database_identity,public.c4g_schema_migration TO c4g_prod_logs_role;
GRANT USAGE ON SCHEMA public,c4g_production TO c4g_prod_retention_role;
GRANT SELECT ON public.c4g_database_identity,public.c4g_schema_migration TO c4g_prod_retention_role;
GRANT USAGE ON SCHEMA public TO c4g_prod_gate_owner_role;
GRANT SELECT ON public.global_user,public.application_session,public.platform_admin_assignment TO c4g_prod_gate_owner_role;
GRANT UPDATE(id) ON public.global_user,public.platform_admin_assignment TO c4g_prod_gate_owner_role;
GRANT UPDATE(sid) ON public.application_session TO c4g_prod_gate_owner_role;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO c4g_prod_gate_owner_role;
CREATE FUNCTION c4g_production.system_identifier() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT system_identifier::text FROM pg_catalog.pg_control_system()
$$;
ALTER FUNCTION c4g_production.system_identifier() OWNER TO c4g_prod_gate_owner_role;
REVOKE ALL ON FUNCTION c4g_production.system_identifier() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c4g_production.system_identifier() TO c4g_prod_read_role;
CREATE FUNCTION c4g_production.administrator(p_session text,p_actor uuid,p_lock boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_session IS NULL OR p_actor IS NULL THEN RETURN false; END IF;
 IF p_lock THEN
  PERFORM u.id FROM public.application_session s JOIN public.global_user u ON u.id=s.global_user_id
  JOIN public.platform_admin_assignment a ON a.global_user_id=u.id
  WHERE s.sid=p_session AND u.id=p_actor AND s.status='ACTIVE' AND s.expires_at>clock_timestamp()
   AND s.revocation_version=u.session_revocation_version AND u.status='ACTIVE'
   AND a.role_code='C4G_ADMIN' AND a.status='ACTIVE' FOR SHARE OF s,u,a;
  RETURN FOUND;
 END IF;
 RETURN EXISTS(SELECT 1 FROM public.application_session s JOIN public.global_user u ON u.id=s.global_user_id
  JOIN public.platform_admin_assignment a ON a.global_user_id=u.id
  WHERE s.sid=p_session AND u.id=p_actor AND s.status='ACTIVE' AND s.expires_at>clock_timestamp()
   AND s.revocation_version=u.session_revocation_version AND u.status='ACTIVE'
   AND a.role_code='C4G_ADMIN' AND a.status='ACTIVE');
END $$;
ALTER FUNCTION c4g_production.administrator(text,uuid,boolean) OWNER TO c4g_prod_gate_owner_role;
REVOKE ALL ON FUNCTION c4g_production.administrator(text,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c4g_production.administrator(text,uuid,boolean) TO c4g_prod_read_role,c4g_prod_authoring_role,c4g_prod_commands_role;
-- Internal read-side administrator projection. Authentication/session enforcement stays at the HTTP boundary.
CREATE FUNCTION c4g_production.active_administrator(p_actor uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.global_user u JOIN public.platform_admin_assignment a ON a.global_user_id=u.id
 WHERE u.id=p_actor AND u.status='ACTIVE' AND a.role_code='C4G_ADMIN' AND a.status='ACTIVE')
$$;
ALTER FUNCTION c4g_production.active_administrator(uuid) OWNER TO c4g_prod_gate_owner_role;
REVOKE ALL ON FUNCTION c4g_production.active_administrator(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c4g_production.active_administrator(uuid) TO c4g_prod_authoring_role;
GRANT SELECT ON public.organization,public.global_user,public.organization_membership,public.billing_account,public.billing_account_version,public.billing_cycle,public.billing_cycle_revision,public.billing_fiscal_document,public.billing_fiscal_document_revision,public.billing_payment_record,public.billing_activity,public.billing_command_receipt,public.platform_support_event TO c4g_prod_read_role;
GRANT INSERT ON public.platform_support_event TO c4g_prod_logs_role;
GRANT USAGE ON SCHEMA opportunity_catalog TO c4g_prod_read_role,c4g_prod_commands_role,c4g_prod_authoring_role;
GRANT SELECT ON opportunity_catalog.opportunity TO c4g_prod_read_role,c4g_prod_commands_role;
GRANT SELECT ON public.organization,public.global_user,public.email_template_version,public.email_logo_version,public.opportunity_complement_version,public.billing_document_file,public.billing_fiscal_document,public.billing_cycle TO c4g_prod_commands_role;
GRANT EXECUTE ON FUNCTION public.billing_pdf_admin(text,uuid) TO c4g_prod_commands_role;
GRANT EXECUTE ON FUNCTION public.billing_attach_pdf(text,uuid,uuid,uuid,uuid,text,integer,text,uuid,integer) TO c4g_prod_commands_role;
GRANT EXECUTE ON FUNCTION public.email_platform_admin(text,uuid) TO c4g_prod_commands_role;
GRANT EXECUTE ON FUNCTION public.email_organization_admin(text,uuid,uuid) TO c4g_prod_commands_role;
GRANT EXECUTE ON FUNCTION public.email_template_write(text,uuid,text,uuid,uuid,text,text,text,text,uuid,integer) TO c4g_prod_commands_role;
GRANT EXECUTE ON FUNCTION public.email_logo_write(text,uuid,uuid,uuid,text,text,integer,integer,bytea,uuid,integer) TO c4g_prod_commands_role;
GRANT EXECUTE ON FUNCTION public.opportunity_complement_write(text,uuid,uuid,uuid,text,jsonb,text,text,text,timestamptz,timestamptz,boolean,uuid,integer) TO c4g_prod_commands_role;
GRANT EXECUTE ON FUNCTION public.billing_validation_read(text,uuid,uuid,boolean) TO c4g_prod_commands_role;
GRANT EXECUTE ON FUNCTION public.billing_validation_request(text,uuid,uuid,uuid,uuid,uuid) TO c4g_prod_commands_role;
GRANT EXECUTE ON FUNCTION public.billing_validation_confirm(text,uuid,uuid,uuid,uuid) TO c4g_prod_commands_role;
GRANT EXECUTE ON FUNCTION public.email_delivery_begin(uuid,uuid,text,boolean) TO c4g_prod_commands_role;
GRANT EXECUTE ON FUNCTION public.email_delivery_finish(uuid,text) TO c4g_prod_commands_role;
GRANT EXECUTE ON FUNCTION public.email_delivery_list(text,uuid,timestamptz,uuid,text) TO c4g_prod_commands_role;
GRANT EXECUTE ON FUNCTION public.email_delivery_retention() TO c4g_prod_retention_role;
GRANT SELECT,INSERT ON opportunity_catalog.opportunity,opportunity_catalog.revision,opportunity_catalog.provenance,opportunity_catalog.idempotency_record,opportunity_catalog.pt2030_document_upload,opportunity_catalog.pt2030_plan_preview,opportunity_catalog.pt2030_plan_identity,opportunity_catalog.pt2030_plan_revision,opportunity_catalog.pt2030_plan_import,opportunity_catalog.pt2030_plan_observation,opportunity_catalog.source_identity_v2,opportunity_catalog.source_observation_v2,opportunity_catalog.accepted_receipt_v2,opportunity_catalog.revision_evidence_v2,opportunity_catalog.revision_concept_v2,opportunity_catalog.revision_allocation_v2,opportunity_catalog.revision_allocation_concept_v2,opportunity_catalog.revision_financial_detail_v2,opportunity_catalog.revision_deadline_v2 TO c4g_prod_authoring_role;
GRANT SELECT ON opportunity_catalog.funding_identity,opportunity_catalog.funding_resolution TO c4g_prod_authoring_role;
GRANT UPDATE(revision_number,latest_revision_id) ON opportunity_catalog.pt2030_plan_identity TO c4g_prod_authoring_role;
GRANT UPDATE(last_v2_observed_at) ON opportunity_catalog.opportunity TO c4g_prod_authoring_role;
GRANT USAGE ON SCHEMA authority_api,audit TO c4g_prod_authoring_role;
GRANT EXECUTE ON FUNCTION authority_api.opportunity_v2_administrator(text,uuid) TO c4g_prod_authoring_role;
GRANT EXECUTE ON FUNCTION opportunity_catalog.v2_decimal_valid(text) TO c4g_prod_authoring_role;
GRANT EXECUTE ON FUNCTION opportunity_catalog.v2_iso_date(text) TO c4g_prod_authoring_role;
GRANT EXECUTE ON FUNCTION opportunity_catalog.v2_iso_instant(text) TO c4g_prod_authoring_role;
GRANT EXECUTE ON FUNCTION opportunity_catalog.guard_v2_projection() TO c4g_prod_authoring_role;
GRANT EXECUTE ON FUNCTION opportunity_catalog.guard_current_revision_version() TO c4g_prod_authoring_role;
GRANT EXECUTE ON FUNCTION opportunity_catalog.guard_v2_evidence() TO c4g_prod_authoring_role;
GRANT EXECUTE ON FUNCTION opportunity_catalog.guard_v2_allocation_link() TO c4g_prod_authoring_role;
GRANT EXECUTE ON FUNCTION audit.prepare_append_v1(uuid,text) TO c4g_prod_authoring_role;
GRANT EXECUTE ON FUNCTION audit.prepare_platform_append_v1(uuid,text) TO c4g_prod_authoring_role;
GRANT EXECUTE ON FUNCTION audit.append_event_v1(uuid,text,text,integer,text,text,audit.ledger_location,uuid,uuid,audit.actor_type,text,text,text,bigint,timestamptz,timestamptz,uuid,uuid,text,text,text,text,jsonb) TO c4g_prod_authoring_role;
GRANT EXECUTE ON FUNCTION audit.append_platform_event_v1(uuid,text,text,integer,text,text,audit.ledger_location,uuid,uuid,audit.actor_type,text,text,text,bigint,timestamptz,timestamptz,uuid,uuid,text,text,text,text,jsonb) TO c4g_prod_authoring_role;
