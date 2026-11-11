'use strict';
// Closed observations only. Caller authorization belongs to the guarded composition.
const eligible=" FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id JOIN public.organization o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.status='ACTIVE' AND u.status='ACTIVE' AND o.status='ACTIVE' AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())";
module.exports=Object.freeze({
 list:'SELECT m.id AS membership_id,u.display_name'+eligible+' AND ($2::uuid IS NULL OR m.id>$2) ORDER BY m.id LIMIT 26',
 validate:'SELECT m.id AS membership_id'+eligible+' AND m.id=$2 LIMIT 1',
 names:'SELECT m.id AS membership_id,u.display_name FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id WHERE m.organization_id=$1 AND m.id=ANY($2::uuid[]) AND cardinality($2::uuid[])<=100 ORDER BY m.id LIMIT 100'
});
