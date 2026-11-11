'use strict';
// Exact grants for private central originals and previews. No tenant/catalog reader access.
async function assertCentralImportSecurity(client){
 const names=['pt2030_document_upload','pt2030_plan_preview'];
 const rows=(await client.query(`SELECT c.relname,pg_get_userbyid(c.relowner) AS owner,
 COALESCE(r.rolname,'PUBLIC') AS grantee,a.privilege_type,a.is_grantable
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
 LEFT JOIN pg_roles r ON r.oid=a.grantee
 WHERE n.nspname='opportunity_catalog' AND c.relname=ANY($1::text[])`,[names])).rows;
 for(const name of names){
  const grants=rows.filter(r=>r.relname===name);
  if(!grants.length||grants.some(r=>r.owner!=='c4g_opportunity_central_owner'||r.is_grantable||
   !['c4g_opportunity_central_owner','c4g_opportunity_central_runtime'].includes(r.grantee)))throw Error('CENTRAL_IMPORT_PERMISSION_DRIFT');
  const runtime=grants.filter(r=>r.grantee==='c4g_opportunity_central_runtime').map(r=>r.privilege_type).sort();
  if(JSON.stringify(runtime)!==JSON.stringify(['INSERT','SELECT']))throw Error('CENTRAL_IMPORT_PERMISSION_DRIFT');
 }
 const columns=await client.query(`SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='opportunity_catalog' AND c.relname=ANY($1::text[]) AND a.attacl IS NOT NULL`,[names]);
 if(columns.rows.length)throw Error('CENTRAL_IMPORT_PERMISSION_DRIFT');
}
module.exports={assertCentralImportSecurity};
