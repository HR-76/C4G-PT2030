'use strict';
const {fail}=require('./contracts');
function createAlertRecipientReader({pool,organizationId}){
 return async(ids,exclude)=>{if(!ids.length)return [];return (await pool.query(`SELECT m.id FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id JOIN public.organization o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.id=ANY($2::uuid[]) AND m.global_user_id<>$3 AND m.status='ACTIVE' AND u.status='ACTIVE' AND o.status='ACTIVE' AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())`,[organizationId,ids,exclude])).rows.map(r=>r.id)};
}
function createNoticeRecipientReader({pool,organizationId}){
 return async ids=>{const rows=(await pool.query(`SELECT m.id,u.display_name FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id JOIN public.organization o ON o.id=m.organization_id
      WHERE m.organization_id=$1 AND ($2::uuid[] IS NULL OR m.id=ANY($2)) AND m.status='ACTIVE' AND u.status='ACTIVE' AND o.status='ACTIVE'
      AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()) ORDER BY u.display_name,m.id LIMIT 1001`,[organizationId,ids])).rows;
  if(rows.length>1000)fail('LIMIT_EXCEEDED');return rows.map(r=>({membershipId:r.id,name:r.display_name}));};
}
module.exports={createAlertRecipientReader,createNoticeRecipientReader};
