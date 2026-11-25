-- Registered incremental 058: requires the exact generic production 057 baseline.
-- Historical candidates remain immutable; this package journals their combined installation.

-- Isolated candidate: requires controlled security-manifest admission before rollout.
DO $migration$
DECLARE definition text; needle constant text := ' CASE query_code';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='authority_api.execute(text,text[],text)'::regprocedure AND prosecdef AND pg_get_userbyid(proowner)='c4g_authority_owner' AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']) THEN RAISE EXCEPTION 'MEMBER_EMAIL_PROTOCOL_SECURITY_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='c4g_authority_owner' AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolinherit)) THEN RAISE EXCEPTION 'MEMBER_EMAIL_OWNER_DRIFT'; END IF;
 SELECT pg_get_functiondef('authority_api.execute(text,text[],text)'::regprocedure) INTO STRICT definition;
 IF (length(definition)-length(replace(definition,needle,'')))<>length(needle) THEN RAISE EXCEPTION 'MEMBER_EMAIL_PROTOCOL_PATCH_POINT_INVALID'; END IF;
 IF position('413612ce1ae6f48815025fb9fc5e7855359ecfc145a9245596d8cab0c4370d23' in definition)>0 THEN RAISE EXCEPTION 'MEMBER_EMAIL_PROTOCOL_ALREADY_PRESENT'; END IF;
 EXECUTE replace(definition,needle,needle||$cases$
 WHEN '413612ce1ae6f48815025fb9fc5e7855359ecfc145a9245596d8cab0c4370d23' THEN statement:='UPDATE public.platform_member_operation SET receipt=jsonb_set(receipt,''{activationEmail}'',$2::jsonb),revision=revision+1 WHERE id=$1 AND phase=''READY'' AND EXISTS(SELECT 1 FROM public.platform_member_invitation WHERE id=$3::uuid AND operation_id=$1 AND status=''OPEN'') AND NOT COALESCE((receipt->''activationEmail''->>''invitationId''=$3::text AND receipt->''activationEmail''->>''status''=''ACCEPTED'' AND $2::jsonb->>''status''<>''ACCEPTED''),false)';
$cases$);
END $migration$;

-- Prepared candidate; not applied by application startup. Requires exact schema admission and isolated gates.
CREATE TABLE public.platform_user_deletion (
 global_user_id uuid PRIMARY KEY REFERENCES public.global_user(id),
 request_key uuid NOT NULL UNIQUE, requested_by uuid NOT NULL REFERENCES public.global_user(id),
 phase text NOT NULL DEFAULT 'BLOCKED' CHECK(phase IN ('BLOCKED','IDENTITY_REMOVED','TENANTS_ANONYMIZED','COMPLETE')),
 identities jsonb NOT NULL CHECK(jsonb_typeof(identities)='array'),
 memberships jsonb NOT NULL CHECK(jsonb_typeof(memberships)='array'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,
 CHECK((phase='COMPLETE')=(completed_at IS NOT NULL)), CHECK(phase<>'COMPLETE' OR identities='[]'::jsonb)
);
ALTER TABLE public.platform_user_deletion OWNER TO c4g_authority_owner;
REVOKE ALL ON public.platform_user_deletion FROM PUBLIC,c4g_central_runtime,c4g_authority_runtime;
GRANT UPDATE(display_name,primary_email) ON public.global_user TO c4g_authority_owner;
DO $migration$
DECLARE definition text; needle constant text := ' CASE query_code';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='authority_api.execute(text,text[],text)'::regprocedure AND prosecdef AND pg_get_userbyid(proowner)='c4g_authority_owner' AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']) THEN RAISE EXCEPTION 'DELETION_PROTOCOL_SECURITY_DRIFT'; END IF;
 SELECT pg_get_functiondef('authority_api.execute(text,text[],text)'::regprocedure) INTO STRICT definition;
 IF (length(definition)-length(replace(definition,needle,'')))<>length(needle) THEN RAISE EXCEPTION 'DELETION_PATCH_POINT_INVALID'; END IF;
 EXECUTE replace(definition,needle,needle||$cases$
 WHEN 'afa588806d1c54e4cb15d426b5ce0a090749145f4b54f7d2b415eb2c176c2d50' THEN statement:='SELECT id,status,session_revocation_version FROM public.global_user WHERE id=$1 FOR UPDATE';
 WHEN '5642b7e60eae72cc554c45ef4fe0f7d9128877d92e728dc535b15e860caf098d' THEN statement:='SELECT * FROM public.platform_user_deletion WHERE global_user_id=$1 FOR UPDATE';
 WHEN 'f84e30f02b2ad2b9bdcd9514de2ce1e40b910fbd09c1a06d29ec513bf9335bd2' THEN statement:='SELECT issuer,subject FROM public.auth_identity_ref WHERE global_user_id=$1 ORDER BY issuer,subject';
 WHEN 'bdbcc156ebe79a0adc233630cec8102900a75915d568dfc82a3a441f7099cb5b' THEN statement:='SELECT id AS "membershipId",organization_id AS "organizationId" FROM public.organization_membership WHERE global_user_id=$1 ORDER BY organization_id,id';
 WHEN '01c814a0a716b23d5e428f0b45827404f557563d885bdeb8c0bc548a38e529d0' THEN statement:='SELECT EXISTS(SELECT 1 FROM public.platform_member_operation WHERE global_user_id=$1 AND phase<>''COMPLETE'' UNION ALL SELECT 1 FROM public.platform_onboarding_operation WHERE global_user_id=$1 AND phase<>''COMPLETE'' UNION ALL SELECT 1 FROM public.entity_admission WHERE global_user_id=$1 AND phase NOT IN (''COMPLETE'',''CANCELLED'')) AS pending';
 WHEN '22797e3d02c7dfc0bbe5d27700b00cf03b02bcee18333dd687e6f00fc3838be6' THEN statement:='SELECT EXISTS(SELECT 1 FROM public.platform_admin_assignment a WHERE a.global_user_id=$1 AND a.role_code=''C4G_ADMIN'' AND a.status=''ACTIVE'' AND NOT EXISTS(SELECT 1 FROM public.platform_admin_assignment b JOIN public.global_user u ON u.id=b.global_user_id WHERE b.global_user_id<>$1 AND b.role_code=''C4G_ADMIN'' AND b.status=''ACTIVE'' AND u.status=''ACTIVE'')) OR EXISTS(SELECT 1 FROM public.organization_membership a JOIN public.organization o ON o.id=a.organization_id WHERE a.global_user_id=$1 AND a.base_role_code=''ORG_ADMIN'' AND a.status=''ACTIVE'' AND o.status=''ACTIVE'' AND NOT EXISTS(SELECT 1 FROM public.organization_membership b JOIN public.global_user u ON u.id=b.global_user_id WHERE b.organization_id=a.organization_id AND b.global_user_id<>$1 AND b.base_role_code=''ORG_ADMIN'' AND b.status=''ACTIVE'' AND u.status=''ACTIVE'' AND b.valid_from<=clock_timestamp() AND (b.valid_until IS NULL OR b.valid_until>clock_timestamp()))) AS protected';
 WHEN '8f81d4fcb5ee3fc5e7ff0e7f0237132dd4072eb0e69d69bd859206d37d09756f' THEN statement:='INSERT INTO public.platform_user_deletion(global_user_id,request_key,requested_by,identities,memberships) VALUES($1,$2,$3,$4,$5) RETURNING *';
 WHEN 'f86f1da36796cf7c917bcab97a8f2d44a639e8fa381cc6e679aacdd04a84c96c' THEN statement:='UPDATE public.global_user SET status=''ARCHIVED'',session_revocation_version=session_revocation_version+1,updated_at=clock_timestamp() WHERE id=$1';
 WHEN 'f82253fbfebcc5cea6e9d72100fa0cb75984fa58e68a7b78c2c4f30a5390ee44' THEN statement:='UPDATE public.application_session SET status=''REVOKED'',revoked_at=clock_timestamp(),revocation_reason=''ACCOUNT_DELETED'' WHERE global_user_id=$1 AND status=''ACTIVE''';
 WHEN '5a6717e946228a1f1ce36eae5349b8d36131c565ab4a35debc2963a0b4160ad7' THEN statement:='DELETE FROM public.application_session_store WHERE sid IN(SELECT sid FROM public.application_session WHERE global_user_id=$1)';
 WHEN 'de5e7a1ae2355eb9880f0917d2c656c7d38b67727ccdf54a615e1651dc81088f' THEN statement:='UPDATE public.platform_admin_assignment SET status=''REVOKED'',revoked_at=clock_timestamp() WHERE global_user_id=$1 AND status=''ACTIVE''';
 WHEN '4e9980fb063c8b679511efe6ea245f73cee7d349630e3e35514b7f55112d6af9' THEN statement:='UPDATE public.organization_membership SET status=''REMOVED'',removed_at=clock_timestamp(),membership_version=membership_version+1,status_reason=''ACCOUNT_DELETED'',updated_at=clock_timestamp() WHERE global_user_id=$1 AND status<>''REMOVED''';
 WHEN 'a10af6e681dfb8cc131860d16270eeeed403fd1329b5a645a465ab0fc4caabd2' THEN statement:='UPDATE public.platform_member_invitation SET status=''REVOKED'',revision=revision+1 WHERE status=''OPEN'' AND operation_id IN(SELECT id FROM public.platform_member_operation WHERE global_user_id=$1)';
 WHEN 'fa8f583fa1bdbdb8461b81edee89b34b86df0c402c1642f85a4fa42d942550d2' THEN statement:='UPDATE public.platform_onboarding_invitation SET status=''REVOKED'',revision=revision+1 WHERE status=''OPEN'' AND operation_id IN(SELECT id FROM public.platform_onboarding_operation WHERE global_user_id=$1)';
 WHEN 'a1f2b61ae83077a66bc951ec0346607e3cb6e03b78ae80c693fe6e2ad41ab9e1' THEN statement:='UPDATE public.platform_user_deletion SET phase=$3,updated_at=clock_timestamp() WHERE global_user_id=$1 AND request_key=$2 RETURNING *';
 WHEN '9f05b5fd1f6de86662a8aa449da6bdd88fcee83de673c8ab24e5dc973e2d18d9' THEN statement:='UPDATE public.global_user SET display_name=''Utilizador eliminado'',primary_email=$2,updated_at=clock_timestamp() WHERE id=$1 AND status=''ARCHIVED''';
 WHEN 'f5e88339d2720552030293d5dec6de507a610863a8709d0d4789d1c5b31b2526' THEN statement:='UPDATE public.auth_identity_ref SET subject=''deleted:''||id::text WHERE global_user_id=$1';
 WHEN 'f4f5f05b76b022b13392d0ff469a3a8598472f1a2f89cf63390cbfd1dea04f97' THEN statement:='UPDATE public.platform_member_operation SET input=jsonb_set(jsonb_set(input-''expectedSubject'',''{adminName}'',''"Utilizador eliminado"''),''{adminEmail}'',to_jsonb($2::text)),receipt=receipt-''subject''-''activationEmail'',revision=revision+1 WHERE global_user_id=$1';
 WHEN '8505f934d14de65cb865cebad438c187a2a9299e65122c0a57b3c4b47044a388' THEN statement:='UPDATE public.platform_onboarding_operation SET input=jsonb_set(jsonb_set(input-''expectedSubject'',''{adminName}'',''"Utilizador eliminado"''),''{adminEmail}'',to_jsonb($2::text)),receipt=receipt-''subject''-''activationEmail'',revision=revision+1 WHERE global_user_id=$1';
 WHEN '429f11b96a8b7324bb9a506a1f7086b077317544b0325f118c34977addc2b909' THEN statement:='UPDATE public.platform_member_invitation SET verified_identity=NULL,exchange_digest=NULL,binding_digest=NULL,exchange_until=NULL,revision=revision+1 WHERE operation_id IN(SELECT id FROM public.platform_member_operation WHERE global_user_id=$1)';
 WHEN '9cf45e06a3d65264673902b422bbde5b07f3c288115740587546f7bab5a3ce7e' THEN statement:='UPDATE public.platform_onboarding_invitation SET verified_identity=NULL,exchange_digest=NULL,binding_digest=NULL,exchange_until=NULL,revision=revision+1 WHERE operation_id IN(SELECT id FROM public.platform_onboarding_operation WHERE global_user_id=$1)';
 WHEN 'cb51203d9303e21cdf485b8089e241c8156e81519dc89b3cc99ebaedcc233866' THEN statement:='UPDATE public.entity_admission SET input=jsonb_set(jsonb_set(input-''expectedSubject'',''{adminName}'',''"Utilizador eliminado"''),''{adminEmail}'',to_jsonb($2::text)),receipt=receipt-''subject''-''activationEmail'',revision=revision+1 WHERE global_user_id=$1';
 WHEN '39a1a39eaeb19f435153ec1b779ec63eb7be1339f755fb478a3a4e05c1ec19f0' THEN statement:='UPDATE public.entity_admission_invitation SET verified_identity=NULL,exchange_digest=NULL,binding_digest=NULL,exchange_until=NULL,revision=revision+1,status=CASE WHEN status=''OPEN'' THEN ''REVOKED'' ELSE status END WHERE operation_id IN(SELECT id FROM public.entity_admission WHERE global_user_id=$1)';
 WHEN 'bc6837992eaa2fd5b93483cf92afae2ce61a94c3c8fa8b060a838d9767570997' THEN statement:='UPDATE public.platform_user_deletion SET phase=''COMPLETE'',identities=''[]'',completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE global_user_id=$1 AND request_key=$2 RETURNING *';
$cases$);
END $migration$;
