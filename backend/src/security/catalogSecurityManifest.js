'use strict';
const { createHash } = require('node:crypto');
const names = Object.freeze(['funding_identity','funding_observation','funding_run','funding_run_item','funding_cycle','funding_batch','funding_cycle_seen','funding_refresh_target','funding_resolution']);
async function catalogSecuritySnapshot(client) {
  const relations = await client.query(`SELECT c.relname,pg_get_userbyid(c.relowner) owner,c.relrowsecurity,c.relforcerowsecurity,
    COALESCE(r.rolname,'PUBLIC') grantee,a.privilege_type,a.is_grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='opportunity_catalog' AND c.relname=ANY($1::text[]) ORDER BY 1,5,6`, [names]);
  const columns = await client.query(`SELECT c.relname,t.attname,t.attacl::text FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='opportunity_catalog' AND c.relname=ANY($1::text[]) AND t.attacl IS NOT NULL ORDER BY 1,2`,[names]);
  const roles = await client.query(`SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolinherit FROM pg_roles
    WHERE rolname IN ('c4g_opportunity_central_owner','c4g_opportunity_central_runtime') ORDER BY 1`);
  const memberships = await client.query(`SELECT r.rolname parent,m.rolname member,a.admin_option,a.inherit_option,a.set_option FROM pg_auth_members a
    JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member
    WHERE r.rolname IN ('c4g_opportunity_central_owner','c4g_opportunity_central_runtime') OR m.rolname IN ('c4g_opportunity_central_owner','c4g_opportunity_central_runtime') ORDER BY 1,2`);
  const schema = await client.query(`SELECT pg_get_userbyid(nspowner) owner,nspacl::text FROM pg_namespace WHERE nspname='opportunity_catalog'`);
  return {relations:relations.rows,columns:columns.rows,roles:roles.rows,memberships:memberships.rows,schema:schema.rows};
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function assertCatalogSecurity(client, expected) {
  const snapshot = await catalogSecuritySnapshot(client);
  if (!expected || digest(snapshot)!==expected) throw new Error('CATALOG_SECURITY_DRIFT');
  return snapshot;
}
module.exports={catalogSecuritySnapshot,assertCatalogSecurity,digest};
