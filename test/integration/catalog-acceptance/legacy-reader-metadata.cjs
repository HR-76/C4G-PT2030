'use strict';
const ROLE='c4g_catalog_reader';
async function catalogReaderSnapshot(client) {
  const enabled = await client.query(`SELECT 1 FROM pg_namespace n,LATERAL aclexplode(n.nspacl) a
    JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='opportunity_catalog' AND r.rolname=$1`, [ROLE]);
  if (!enabled.rows.length) return null;
  const roles = await client.query(`SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,
    rolreplication,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=$1`, [ROLE]);
  const parents = await client.query(`SELECT r.rolname,a.admin_option,a.inherit_option,a.set_option
    FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid
    WHERE a.member=$1::regrole ORDER BY 1`, [ROLE]);
  const tables = await client.query(`SELECT c.relname,pg_get_userbyid(c.relowner) owner,
    c.relrowsecurity,c.relforcerowsecurity,COALESCE(r.rolname,'PUBLIC') grantee,a.privilege_type,a.is_grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='opportunity_catalog'
    AND c.relname IN ('opportunity','revision','funding_identity') ORDER BY 1,5,6`);
  const columns = await client.query(`SELECT c.relname,t.attname,t.attacl::text FROM pg_attribute t
    JOIN pg_class c ON c.oid=t.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='opportunity_catalog' AND t.attacl IS NOT NULL ORDER BY 1,2`);
  const database=await client.query(`SELECT EXISTS(SELECT 1 FROM pg_database d,
    LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a
    WHERE d.datname=current_database() AND a.grantee=0 AND a.privilege_type='TEMPORARY') AS public_temp`);
  return {roles:roles.rows,parents:parents.rows,tables:tables.rows,columns:columns.rows,database:database.rows};
}
module.exports={catalogReaderSnapshot};
