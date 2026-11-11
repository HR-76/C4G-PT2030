'use strict';
// Only validated server-side OIDC claims may supply these exact-match parameters.
const resolveIdentity = "SELECT gu.id,gu.display_name,gu.primary_email,gu.session_revocation_version FROM public.auth_identity_ref air JOIN public.global_user gu ON gu.id=air.global_user_id WHERE air.issuer=$1 AND air.subject=$2 AND gu.status='ACTIVE' LIMIT 2";
const loginRoles = "SELECT DISTINCT paa.role_code FROM public.auth_identity_ref air JOIN public.global_user gu ON gu.id=air.global_user_id JOIN public.platform_admin_assignment paa ON paa.global_user_id=gu.id WHERE air.issuer=$1 AND air.subject=$2 AND gu.id=$3 AND gu.status='ACTIVE' AND paa.status='ACTIVE' ORDER BY paa.role_code";
module.exports = Object.freeze({ resolveIdentity, loginRoles });
