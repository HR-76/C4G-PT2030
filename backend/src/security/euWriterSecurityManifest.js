'use strict';
const {createHash}=require('node:crypto');
// 043 additionally pins non-trigger helpers. Earlier schema fingerprints retain
// their historical scope; no helper definition or grant is inferred from a GUC.
async function euWriterSecuritySnapshot(client){
 const functions=(await client.query(`SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,
  pg_get_userbyid(p.proowner) AS owner,pg_get_functiondef(p.oid) AS definition,
  p.prosecdef AS security_definer,p.provolatile AS volatility,p.proconfig AS configuration,
  COALESCE(p.proacl,acldefault('f',p.proowner))::text AS acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='opportunity_catalog' ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)`)).rows;
 const relations=(await client.query(`SELECT c.relname AS name,pg_get_userbyid(c.relowner) AS owner,
  c.relrowsecurity,c.relforcerowsecurity,COALESCE(c.relacl,acldefault('r',c.relowner))::text AS acl
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='opportunity_catalog' AND c.relkind IN ('r','p') ORDER BY c.relname`)).rows;
 const columns=(await client.query(`SELECT c.relname AS relation,a.attname AS name,a.attacl::text AS acl
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='opportunity_catalog' AND a.attacl IS NOT NULL ORDER BY c.relname,a.attname`)).rows;
 const roles=(await client.query(`SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolinherit
  FROM pg_roles WHERE rolname='c4g_eu_writer_runtime' ORDER BY rolname`)).rows;
 // Login membership is deployment-specific; role inheritance into another
 // reusable runtime/owner role would instead expand authority globally.
 const memberships=(await client.query(`SELECT parent.rolname AS parent,member.rolname AS member,
  a.admin_option,a.inherit_option,a.set_option FROM pg_auth_members a
  JOIN pg_roles parent ON parent.oid=a.roleid JOIN pg_roles member ON member.oid=a.member
  WHERE member.rolname='c4g_eu_writer_runtime' OR
  (parent.rolname='c4g_eu_writer_runtime' AND NOT member.rolcanlogin) ORDER BY parent.rolname,member.rolname`)).rows;
 return {functions,relations,columns,roles,memberships};
}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function assertEuWriterSecurity(client,expected){
 const snapshot=await euWriterSecuritySnapshot(client);
 if(!expected||digest(snapshot)!==expected)throw Object.assign(new Error('EU_WRITER_SECURITY_DRIFT'),{code:'EU_WRITER_SECURITY_DRIFT'});
 return snapshot;
}
module.exports={euWriterSecuritySnapshot,digest,assertEuWriterSecurity};
