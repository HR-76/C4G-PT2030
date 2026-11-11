'use strict';
const {digest}=require('./model');
const {fail}=require('./readErrors');
// Principal comes only from the server session middleware; never from query/body.
function createPgReadAuthority({pool,policyVersion}){
 if(!pool?.query||!policyVersion)throw new TypeError('Central authority and policy required');
 return async(principal,now)=>{
  if(!principal?.sid||!principal.userId||!Number.isSafeInteger(principal.revocationVersion)||principal.policyVersion!==policyVersion)fail('SESSION_REQUIRED');
  let result;try{result=await pool.query(`SELECT aps.revocation_version,om.id AS membership_id,om.organization_id,om.membership_version,om.base_role_code,
    LEAST(aps.expires_at,ss.expire) AS expires_at
   FROM public.application_session aps
   JOIN public.application_session_store ss ON ss.sid=aps.sid
   JOIN public.global_user gu ON gu.id=aps.global_user_id
   JOIN public.organization_membership om ON om.id=aps.selected_membership_id AND om.global_user_id=gu.id AND om.organization_id=aps.selected_organization_id
   JOIN public.organization org ON org.id=om.organization_id
   WHERE aps.sid=$1 AND aps.global_user_id=$2 AND aps.revocation_version=$3 AND gu.session_revocation_version=$3
    AND aps.status='ACTIVE' AND gu.status='ACTIVE' AND om.status='ACTIVE' AND org.status='ACTIVE'
    AND aps.selected_membership_version=om.membership_version AND om.valid_from<=$4 AND (om.valid_until IS NULL OR om.valid_until>$4)
    AND aps.expires_at>$4 AND ss.expire>$4
    AND ss.sess#>>'{auth,user,id}'=gu.id::text AND ss.sess#>>'{auth,policyVersion}'=$5
    AND ss.sess#>>'{auth,evidence,policyVersion}'=$5
    AND ss.sess#>>'{auth,revocationVersion}'=$3::text
    AND (ss.sess#>>'{auth,absoluteExpiresAt}')::numeric>$6`,[principal.sid,principal.userId,principal.revocationVersion,new Date(now),policyVersion,now]);}catch{fail('CATALOG_UNAVAILABLE');}
  if(result.rows.length!==1)fail('ACCESS_DENIED');
  const row=result.rows[0];return {organizationId:row.organization_id,baseRoleCode:row.base_role_code,scope:digest({subject:principal.userId,organization:row.organization_id,membership:row.membership_id,version:String(row.membership_version),role:row.base_role_code,revocation:String(row.revocation_version),policyVersion}),expiresAt:new Date(row.expires_at).getTime()};
 };
}
module.exports={createPgReadAuthority};
