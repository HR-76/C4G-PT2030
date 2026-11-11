'use strict';
const list=`SELECT m.id AS "membershipId",u.display_name AS name,u.primary_email AS email,m.status,m.membership_version AS revision,m.base_role_code AS "profileCode" FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id WHERE m.organization_id=$1 AND m.status IN ('ACTIVE','SUSPENDED') AND u.status='ACTIVE' ORDER BY u.display_name,m.id LIMIT 1001`;
const profile=`UPDATE public.organization_membership SET base_role_code=$3,membership_version=membership_version+1,status_reason=$4,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2`;
module.exports={list,profile};
