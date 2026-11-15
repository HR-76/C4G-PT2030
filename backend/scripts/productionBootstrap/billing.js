'use strict';
const {identifier,literal}=require('./config');
const {ownership,verifyPassword}=require('./cluster');
const BILLING_LOGIN='c4g_prod_billing_mail',BILLING_ROLE='c4g_billing_validation_worker';
const fail=code=>{throw Object.assign(new Error(code),{code});};
async function inspectRoles(client,{fresh=false}={}){
 const names=fresh?[BILLING_ROLE]:[BILLING_LOGIN,BILLING_ROLE];
 const roles=(await client.query(`SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,
  rolconfig IS NOT NULL AS configured,rolvaliduntil IS NOT NULL AS expires FROM pg_roles WHERE rolname=ANY($1::text[])`,[names])).rows;
 if(roles.length!==names.length||roles.some(r=>!names.includes(r.rolname)||r.rolcanlogin!==(r.rolname===BILLING_LOGIN)
  ||r.rolinherit!==(r.rolname===BILLING_ROLE)||r.rolsuper||r.rolbypassrls||r.rolcreatedb||r.rolcreaterole||r.rolreplication||r.configured||r.expires))fail('PRODUCTION_BILLING_ROLE_UNSAFE');
 const edges=(await client.query(`SELECT granted.rolname granted,member.rolname member,m.set_option,m.inherit_option,m.admin_option
  FROM pg_auth_members m JOIN pg_roles granted ON granted.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
  WHERE member.rolname=ANY($1::text[]) OR granted.rolname=ANY($1::text[])`,[[BILLING_LOGIN,BILLING_ROLE]])).rows;
 if(fresh?edges.length!==0:edges.length!==1||edges[0].granted!==BILLING_ROLE||edges[0].member!==BILLING_LOGIN||edges[0].set_option||!edges[0].inherit_option||edges[0].admin_option)fail('PRODUCTION_BILLING_MEMBERSHIP_DRIFT');
}
async function inspectBillingProfile(client,config){
 await inspectRoles(client);
 // Validate only metadata. Admission must never claim a pending mail job.
 const result=(await client.query(`WITH managed AS (SELECT oid,rolname FROM pg_roles WHERE rolname=ANY($1::text[])), grants AS (
  SELECT a.grantee FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
   WHERE NOT(a.grantee=(SELECT oid FROM managed WHERE rolname=$2) AND n.nspname='public' AND a.privilege_type='USAGE' AND NOT a.is_grantable)
  UNION ALL SELECT a.grantee FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(p.proacl) a
   WHERE NOT(a.grantee=(SELECT oid FROM managed WHERE rolname=$2) AND n.nspname='public'
    AND p.oid IN(to_regprocedure('public.billing_validation_email_claim()'),to_regprocedure('public.billing_validation_email_finish(uuid,uuid,boolean)'))
    AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
  UNION ALL SELECT a.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
  UNION ALL SELECT a.grantee FROM pg_attribute t CROSS JOIN LATERAL aclexplode(t.attacl) a
  UNION ALL SELECT a.grantee FROM pg_type t CROSS JOIN LATERAL aclexplode(t.typacl) a
  UNION ALL SELECT a.grantee FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  UNION ALL SELECT a.grantee FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a
   WHERE NOT(a.grantee=(SELECT oid FROM managed WHERE rolname=$3) AND d.datname=$4 AND a.privilege_type='CONNECT' AND NOT a.is_grantable)
 ) SELECT EXISTS(SELECT 1 FROM grants WHERE grantee IN(SELECT oid FROM managed))
  OR EXISTS(SELECT 1 FROM pg_class WHERE relowner IN(SELECT oid FROM managed))
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner IN(SELECT oid FROM managed))
  OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner IN(SELECT oid FROM managed))
  OR EXISTS(SELECT 1 FROM pg_type WHERE typowner IN(SELECT oid FROM managed))
  OR EXISTS(SELECT 1 FROM pg_database WHERE datdba IN(SELECT oid FROM managed))
  OR EXISTS(SELECT 1 FROM pg_default_acl WHERE defaclrole IN(SELECT oid FROM managed))
  OR EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole IN(SELECT oid FROM managed))
  OR EXISTS(SELECT 1 FROM pg_database WHERE datallowconn AND datname<>$4 AND has_database_privilege($3,oid,'CONNECT'))
  OR has_database_privilege($3,$4,'CREATE,TEMP')
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' AND has_schema_privilege($3,oid,'CREATE'))
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%'
   AND n.nspname<>'information_schema' AND CASE WHEN c.relkind IN('r','p','v','m','f') THEN
    (has_table_privilege($3,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege($3,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) ELSE false END)
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%'
   AND n.nspname<>'information_schema' AND CASE WHEN c.relkind='S' THEN has_sequence_privilege($3,c.oid,'USAGE,SELECT,UPDATE') ELSE false END)
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosecdef AND n.nspname NOT LIKE 'pg_%'
   AND n.nspname<>'information_schema' AND has_schema_privilege($3,n.oid,'USAGE') AND has_function_privilege($3,p.oid,'EXECUTE')
   AND p.oid NOT IN(to_regprocedure('public.billing_validation_email_claim()'),to_regprocedure('public.billing_validation_email_finish(uuid,uuid,boolean)'))) AS unsafe`,[[BILLING_LOGIN,BILLING_ROLE],BILLING_ROLE,BILLING_LOGIN,config.target.centralDatabase])).rows[0];
 if(result?.unsafe!==false)fail('PRODUCTION_BILLING_PRIVILEGE_DRIFT');
 const access=(await client.query(`SELECT has_function_privilege($1,'public.billing_validation_email_claim()','EXECUTE') AS claim,
  has_function_privilege($1,'public.billing_validation_email_finish(uuid,uuid,boolean)','EXECUTE') AS finish,
  has_database_privilege($1,$2,'CONNECT') AS connect,has_schema_privilege($1,'public','USAGE') AS public_usage`,[BILLING_LOGIN,config.target.centralDatabase])).rows[0];
 if(!access||['claim','finish','connect','public_usage'].some(key=>access[key]!==true))fail('PRODUCTION_BILLING_PRIVILEGE_MISSING');
}
async function provisionBillingProfile({centralPool,config,password},dependencies={}){
 if(typeof password!=='string'||password.length<32||password.length>4096||/[^\x21-\x7e]/.test(password)||/REPLACE/i.test(password))fail('PRODUCTION_BILLING_CREDENTIAL_REQUIRED');
 const marker=ownership(config)+':billing-validation-v1',client=await centralPool.connect();let began=false;
 try{
  const target=(await client.query('SELECT current_database() AS database,(pg_control_system()).system_identifier::text AS system_identifier')).rows[0];
  if(target?.database!==config.target.centralDatabase||target.system_identifier!==config.target.expectedSystemIdentifier)fail('PRODUCTION_BILLING_TARGET_MISMATCH');
  await client.query('BEGIN');began=true;
  await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL password_encryption='scram-sha-256'");
  const lock=(await client.query('SELECT pg_try_advisory_xact_lock(43001511) AS acquired')).rows[0];
  if(lock?.acquired!==true)fail('PRODUCTION_BILLING_PROFILE_BUSY');
  const existing=(await client.query("SELECT shobj_description(oid,'pg_authid') AS ownership FROM pg_roles WHERE rolname=$1",[BILLING_LOGIN])).rows[0];
  if(existing&&existing.ownership!==marker)fail('PRODUCTION_BILLING_OWNERSHIP_CONFLICT');
  if(!existing){
   await inspectRoles(client,{fresh:true});
   await client.query(`CREATE ROLE ${identifier(BILLING_LOGIN)} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${literal(password)}`);
   await client.query(`COMMENT ON ROLE ${identifier(BILLING_LOGIN)} IS ${literal(marker)}`);
   // The standalone worker executes two narrow functions directly; it never SET ROLEs.
   await client.query(`GRANT ${identifier(BILLING_ROLE)} TO ${identifier(BILLING_LOGIN)} WITH INHERIT TRUE, SET FALSE, ADMIN FALSE`);
   await client.query(`GRANT CONNECT ON DATABASE ${identifier(config.target.centralDatabase)} TO ${identifier(BILLING_LOGIN)}`);
  }
  await inspectBillingProfile(client,config);
  await (dependencies.verifyPassword||verifyPassword)(client,BILLING_LOGIN,password);
  await client.query('COMMIT');began=false;
  return Object.freeze({state:existing?'ALREADY_CONFORMING':'PROVISIONED',login:BILLING_LOGIN,role:BILLING_ROLE});
 }catch(error){if(began)await client.query('ROLLBACK').catch(()=>{});throw error;}
 finally{client.release();}
}
async function validateBillingProfile({config,password,Pool=require('pg').Pool}){
 const pool=new Pool({host:config.target.host,port:config.target.port,database:config.target.centralDatabase,ssl:config.target.ssl,
  user:BILLING_LOGIN,password,max:1,connectionTimeoutMillis:10000,statement_timeout:15000});let client;
 try{
  client=await pool.connect();
  const row=(await client.query('SELECT current_database() AS database,session_user AS login,current_user AS current_role')).rows[0];
  if(row?.database!==config.target.centralDatabase||row.login!==BILLING_LOGIN||row.current_role!==BILLING_LOGIN)fail('PRODUCTION_BILLING_CONNECTION_MISMATCH');
  await inspectBillingProfile(client,config);
  return Object.freeze({login:BILLING_LOGIN,role:BILLING_ROLE});
 }finally{if(client)client.release();await pool.end();}
}
module.exports={BILLING_LOGIN,BILLING_ROLE,provisionBillingProfile,validateBillingProfile,inspectBillingProfile};
