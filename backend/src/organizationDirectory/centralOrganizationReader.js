'use strict';
const {fail}=require('./contracts');
function createCentralOrganizationReader({pool,organizationId}){
 return async function organization(id){
  if(id!==organizationId)fail('RESOURCE_NOT_AVAILABLE');
  const r=(await pool.query('SELECT id,legal_name,display_name,type_code FROM public.organization WHERE id=$1 AND status=\'ACTIVE\'',[organizationId])).rows[0];
  if(!r)fail('RESOURCE_NOT_AVAILABLE');
  return {id:r.id,name:r.display_name,legalName:r.legal_name,typeCode:r.type_code};
 };
}
function createCentralMembershipReader({pool,organizationId}){
 return async function memberships(){return (await pool.query(`SELECT m.id AS "membershipId",u.display_name AS name,u.primary_email AS email,m.status,m.membership_version AS revision FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id WHERE m.organization_id=$1 AND m.status IN ('ACTIVE','SUSPENDED') ORDER BY u.display_name,m.id LIMIT 1001`,[organizationId])).rows;};
}
module.exports={createCentralOrganizationReader,createCentralMembershipReader};
