'use strict';
const { createHash } = require('node:crypto');
// Full capability ACLs, function bodies and parent edges; login membership is checked independently on every checkout.
async function snapshot(client) {
  const roles = (await client.query("SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname LIKE 'c4g_prod_%_role' ORDER BY rolname")).rows;
  const parents = (await client.query("SELECT m.rolname member,p.rolname parent,a.admin_option,a.inherit_option,a.set_option FROM pg_auth_members a JOIN pg_roles m ON m.oid=a.member JOIN pg_roles p ON p.oid=a.roleid WHERE m.rolname LIKE 'c4g_prod_%_role' ORDER BY 1,2")).rows;
  const tables = (await client.query(`SELECT n.nspname,c.relname,pg_get_userbyid(c.relowner) owner,c.relrowsecurity,c.relforcerowsecurity,
    r.rolname,a.privilege_type,a.is_grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
    LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid=a.grantee WHERE r.rolname LIKE 'c4g_prod_%_role' ORDER BY 1,2,6,7`)).rows;
  const columns = (await client.query(`SELECT n.nspname,c.relname,t.attname,r.rolname,a.privilege_type,a.is_grantable
    FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace,
    LATERAL aclexplode(t.attacl) a JOIN pg_roles r ON r.oid=a.grantee WHERE r.rolname LIKE 'c4g_prod_%_role' ORDER BY 1,2,3,4,5`)).rows;
  const functions = (await client.query(`SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,
    pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) definition,
    COALESCE(r.rolname,'PUBLIC') grantee,a.privilege_type,a.is_grantable
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
    LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='c4g_production' OR r.rolname LIKE 'c4g_prod_%_role' OR (a.grantee=0 AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema') ORDER BY 1,2,3,8,9`)).rows;
  const schemas = (await client.query(`SELECT n.nspname,pg_get_userbyid(n.nspowner) owner,COALESCE(r.rolname,'PUBLIC') grantee,a.privilege_type,a.is_grantable
    FROM pg_namespace n,LATERAL aclexplode(n.nspacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='c4g_production' OR r.rolname LIKE 'c4g_prod_%_role' ORDER BY 1,3,4`)).rows;
  const publicAcl = (await client.query(`SELECT 'relation' AS kind,n.nspname,c.relname AS name,a.privilege_type,a.is_grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(c.relacl) a
    WHERE a.grantee=0 AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
    UNION ALL SELECT 'schema',n.nspname,n.nspname,a.privilege_type,a.is_grantable FROM pg_namespace n,LATERAL aclexplode(n.nspacl) a
    WHERE a.grantee=0 AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY 1,2,3,4`)).rows;
  return { roles, parents, tables, columns, functions, schemas, publicAcl };
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
module.exports = { snapshot, digest };
