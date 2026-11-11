'use strict';
const {validateLocalTenantRoleChain}=require('./localTenantIdentityProvisioner');
const BASE=Object.freeze(['c4g_opportunity_tenant_runtime','c4g_f4_metadata_executor']);
const ROLES=Object.freeze([...BASE,'c4g_document_runtime']);
const ATTRIBUTES='NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
const ident=value=>{if(!/^[a-z][a-z0-9_]{0,62}$/.test(value||''))throw new TypeError('DOCUMENT_API_LOGIN_INVALID');return '"'+value+'"';};
async function validateLoginPrivileges(client,login){
 const result=await client.query(`WITH target AS (SELECT oid FROM pg_roles WHERE rolname=$1), grants AS (
  SELECT a.grantee FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
  UNION ALL SELECT a.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
  UNION ALL SELECT a.grantee FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
  UNION ALL SELECT a.grantee FROM pg_attribute t CROSS JOIN LATERAL aclexplode(t.attacl) a
  UNION ALL SELECT a.grantee FROM pg_type t CROSS JOIN LATERAL aclexplode(t.typacl) a
  UNION ALL SELECT a.grantee FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a)
  SELECT EXISTS(SELECT 1 FROM grants WHERE grantee=(SELECT oid FROM target))
   OR EXISTS(SELECT 1 FROM pg_class WHERE relowner=(SELECT oid FROM target))
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=(SELECT oid FROM target))
   OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner=(SELECT oid FROM target))
   OR EXISTS(SELECT 1 FROM pg_type WHERE typowner=(SELECT oid FROM target))
   OR EXISTS(SELECT 1 FROM pg_database WHERE datdba=(SELECT oid FROM target))
   OR EXISTS(SELECT 1 FROM pg_default_acl WHERE defaclrole=(SELECT oid FROM target))
   OR has_database_privilege($1,current_database(),'CREATE,TEMP') AS bad`,[login]);
 if(result.rows[0]?.bad!==false)throw Error('DOCUMENT_API_LOGIN_PRIVILEGE_DRIFT');
}
// Installation-only. No application startup code calls this function.
async function provisionDocumentApiProfile(client,{login,password}){
 ident(login);if(/^c4g_/.test(login))throw new TypeError('DOCUMENT_API_LOGIN_MUST_BE_DEDICATED');
 let began=false;
 try{
  await client.query('BEGIN');began=true;await client.query("SET LOCAL lock_timeout='5s'");await client.query('SELECT pg_advisory_xact_lock(43000032)');
  const profiles=(await client.query('SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=ANY($1::text[])',[ROLES])).rows;
  if(profiles.length!==ROLES.length||profiles.some(({rolname,...attributes})=>Object.values(attributes).some(Boolean)))throw Error('DOCUMENT_API_FUNCTIONAL_ROLE_DRIFT');
  await require('./documentApiRoleContract').validateDocumentRole(client);
  const existing=(await client.query("SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])",[[login,'c4g_tenant_api_capabilities']])).rows.map(row=>row.rolname);
  let state;
  if(existing.length===0){
   if(typeof password!=='string'||password.length<24)throw new TypeError('DOCUMENT_API_PASSWORD_REQUIRED');
   // Validate functional roles have no path to a more privileged role before creating anything.
   const edges=await client.query('SELECT 1 FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[])) LIMIT 1',[ROLES]);
   if(edges.rowCount)throw Error('DOCUMENT_API_FUNCTIONAL_ROLE_DRIFT');
   await client.query(`CREATE ROLE c4g_tenant_api_capabilities NOLOGIN ${ATTRIBUTES}`);
   await client.query(`CREATE ROLE ${ident(login)} LOGIN ${ATTRIBUTES} PASSWORD '${password.replace(/'/g,"''")}'`);
   await client.query(`GRANT c4g_tenant_api_capabilities TO ${ident(login)} WITH SET TRUE, INHERIT FALSE, ADMIN FALSE`);
   for(const role of ROLES)await client.query(`GRANT ${role} TO c4g_tenant_api_capabilities WITH SET TRUE, INHERIT FALSE, ADMIN FALSE`);
   state='PROVISIONED';
  }else{
   if(existing.length!==2)throw Error('DOCUMENT_API_PARTIAL_PROFILE');
   await validateLoginPrivileges(client,login);
   const edge=(await client.query("SELECT 1 FROM pg_auth_members WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname='c4g_document_runtime') AND member=(SELECT oid FROM pg_roles WHERE rolname='c4g_tenant_api_capabilities')")).rowCount;
   await validateLocalTenantRoleChain(client,{login,workload:'API',functionalRoles:edge?ROLES:BASE});
   if(!edge){await client.query('GRANT c4g_document_runtime TO c4g_tenant_api_capabilities WITH SET TRUE, INHERIT FALSE, ADMIN FALSE');state='UPGRADED_APPROVED_BASELINE';}
   else state='ALREADY_CONFORMING';
  }
  await validateLocalTenantRoleChain(client,{login,workload:'API',functionalRoles:ROLES});
  await validateLoginPrivileges(client,login);
  await client.query('COMMIT');began=false;
  return Object.freeze({state,login,aggregator:'c4g_tenant_api_capabilities',functionalRoles:ROLES});
 }catch(error){if(began){try{await client.query('ROLLBACK');}catch{/* keep the original failure */}}throw error;}
}
module.exports={BASE,ROLES,provisionDocumentApiProfile};
