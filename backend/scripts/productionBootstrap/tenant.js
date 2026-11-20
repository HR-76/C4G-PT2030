'use strict';

const {createHash}=require('node:crypto');
const {Pool}=require('pg');
const {accountIdentityErasureManifest}=require('../../src/security/tenantMigrationManifest');
const {bindingDigest}=require('../../src/security/localTenantCredentialAdapter');
const {validateLocalTenantRoleChain}=require('../../src/security/localTenantIdentityProvisioner');
const {PRODUCTION_EDITORIAL_PROFILE:PROFILE_CODE,requireTenantApiProfile}=require('../../src/security/tenantApiProfile');
const {literal}=require('./config');
const AGGREGATOR='c4g_tenant_api_capabilities';
const FUNCTIONAL_ROLES=requireTenantApiProfile(PROFILE_CODE).functionalRoles;
const ATTRIBUTES='NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION';
function identifier(value){if(!/^[a-z][a-z0-9_]{0,62}$/.test(value||''))throw Error('PRODUCTION_TENANT_IDENTIFIER_INVALID');return '"'+value+'"';}
function refuse(code){throw Object.assign(new Error(code),{code});}

function tenantProfileMarker(config){
 const {installationId,target,organization,tenant}=config;
 const intent={installationId,profile:PROFILE_CODE,host:target.host,port:target.port,expectedSystemIdentifier:target.expectedSystemIdentifier,centralDatabase:target.centralDatabase,tenantDatabase:target.tenantDatabase,
  ssl:target.ssl,organizationId:organization.id,tenantId:tenant.id,generationId:tenant.generationId,login:tenant.apiLogin,credentialRef:tenant.credentialRef};
 return 'C4G_PRODUCTION_TENANT_API:'+createHash('sha256').update(JSON.stringify(intent)).digest('hex');
}

async function validateFreshBaseline(client){
 const names=[AGGREGATOR,...FUNCTIONAL_ROLES];
 const roles=(await client.query(`SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,
  rolconfig IS NOT NULL AS configured FROM pg_roles WHERE rolname=ANY($1::text[])`,[names])).rows;
 if(roles.length!==names.length||roles.some(({rolname,...flags})=>!names.includes(rolname)||Object.values(flags).some(Boolean)))refuse('PRODUCTION_TENANT_PROFILE_BASELINE_INVALID');
 const edges=(await client.query(`SELECT granted.rolname granted,member.rolname member,m.set_option,m.inherit_option,m.admin_option
  FROM pg_auth_members m JOIN pg_roles granted ON granted.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
  WHERE member.rolname=ANY($1::text[])`,[names])).rows;
 if(edges.length!==1||edges[0].granted!=='c4g_f4_metadata_executor'||edges[0].member!==AGGREGATOR
  ||!edges[0].set_option||edges[0].inherit_option||edges[0].admin_option)refuse('PRODUCTION_TENANT_PROFILE_BASELINE_INVALID');
}

async function validatePrivileges(client,config){
 const login=config.tenant.apiLogin,database=config.target.tenantDatabase;
 const row=(await client.query(`WITH managed AS (SELECT oid,rolname FROM pg_roles WHERE rolname=ANY($1::text[])), direct_grants AS (
  SELECT a.grantee FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
  UNION ALL SELECT a.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
  UNION ALL SELECT a.grantee FROM pg_attribute t CROSS JOIN LATERAL aclexplode(t.attacl) a
  UNION ALL SELECT a.grantee FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
  UNION ALL SELECT a.grantee FROM pg_type t CROSS JOIN LATERAL aclexplode(t.typacl) a
  UNION ALL SELECT a.grantee FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  UNION ALL SELECT a.grantee FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a
   WHERE a.grantee=(SELECT oid FROM managed WHERE rolname=$3) OR a.privilege_type<>'CONNECT' OR d.datname<>$2
 ) SELECT EXISTS(SELECT 1 FROM direct_grants WHERE grantee IN(SELECT oid FROM managed))
  OR EXISTS(SELECT 1 FROM pg_class WHERE relowner IN(SELECT oid FROM managed))
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner IN(SELECT oid FROM managed))
  OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner IN(SELECT oid FROM managed))
  OR EXISTS(SELECT 1 FROM pg_type WHERE typowner IN(SELECT oid FROM managed))
  OR EXISTS(SELECT 1 FROM pg_database WHERE datdba IN(SELECT oid FROM managed))
  OR EXISTS(SELECT 1 FROM pg_default_acl WHERE defaclrole IN(SELECT oid FROM managed))
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$4 AND (rolconfig IS NOT NULL OR rolvaliduntil IS NOT NULL))
  OR has_database_privilege($4,$2,'CREATE,TEMP') AS unsafe`,[[login,AGGREGATOR],database,AGGREGATOR,login])).rows[0];
 if(row?.unsafe!==false)refuse('PRODUCTION_TENANT_PROFILE_PRIVILEGE_DRIFT');
 const databases=(await client.query(`SELECT d.datname AS database,has_database_privilege($1,d.oid,'CONNECT') AS login_connect,
  EXISTS(SELECT 1 FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0 AND a.privilege_type='CONNECT') AS public_connect
  FROM pg_database d WHERE d.datname=ANY($2::text[])`,[login,[config.target.centralDatabase,database]])).rows;
 if(databases.length!==2||databases.some(row=>row.public_connect||row.login_connect!==(row.database===database)))refuse('PRODUCTION_TENANT_DATABASE_ISOLATION_DRIFT');
}

// Installation-only: an existing login must carry this exact immutable intent.
// Replays never ALTER ROLE, rotate a password, or repair unexpected privileges.
async function provisionTenantApiProfile({pool,config,password},dependencies={}){
 const login=identifier(config.tenant.apiLogin),database=identifier(config.target.tenantDatabase),marker=tenantProfileMarker(config);
 if(config.tenant.apiLogin.startsWith('c4g_'))refuse('PRODUCTION_TENANT_DEDICATED_LOGIN_REQUIRED');
 if(typeof password!=='string'||password.length<24)refuse('PRODUCTION_TENANT_PASSWORD_REQUIRED');
 const validateChain=dependencies.validateRoleChain||validateLocalTenantRoleChain;
 const baseline=dependencies.validateFreshBaseline||validateFreshBaseline;
 const verifyPassword=dependencies.verifyPassword||require('./cluster').verifyPassword;
 const client=await pool.connect();let began=false;
 try{
  await client.query('BEGIN');began=true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL password_encryption='scram-sha-256'");
  const lock=(await client.query('SELECT pg_try_advisory_xact_lock(43001510) AS acquired')).rows[0];
  if(lock?.acquired!==true)refuse('PRODUCTION_TENANT_PROFILE_BUSY');
  const existing=(await client.query("SELECT shobj_description(oid,'pg_authid') AS ownership FROM pg_roles WHERE rolname=$1",[config.tenant.apiLogin])).rows[0];
  let state;
  if(existing){
   if(existing.ownership!==marker)refuse('PRODUCTION_TENANT_PROFILE_OWNERSHIP_CONFLICT');
   state='ALREADY_CONFORMING';
  }else{
   await baseline(client);
   await client.query(`CREATE ROLE ${login} LOGIN ${ATTRIBUTES} PASSWORD ${literal(password)}`);
   await client.query(`COMMENT ON ROLE ${login} IS ${literal(marker)}`);
   await client.query(`GRANT ${AGGREGATOR} TO ${login} WITH SET TRUE, INHERIT FALSE, ADMIN FALSE`);
   await client.query(`GRANT c4g_opportunity_tenant_runtime TO ${AGGREGATOR} WITH SET TRUE, INHERIT FALSE, ADMIN FALSE`);
   await client.query(`GRANT c4g_organization_profile_runtime TO ${AGGREGATOR} WITH SET TRUE, INHERIT FALSE, ADMIN FALSE`);
   await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${login}`);
   state='PROVISIONED';
  }
  await validateChain(client,{login:config.tenant.apiLogin,workload:'API',functionalRoles:FUNCTIONAL_ROLES});
  await validatePrivileges(client,config);
  await verifyPassword(client,config.tenant.apiLogin,password);
  await client.query('COMMIT');began=false;
  return Object.freeze({state,login:config.tenant.apiLogin,aggregator:AGGREGATOR,functionalRoles:FUNCTIONAL_ROLES});
 }catch(error){if(began)await client.query('ROLLBACK').catch(()=>{});throw error;}
 finally{client.release();}
}

async function verifyTenantConnection({config,snapshot,tenantCredentials},{PoolClass=Pool,createRuntime=require('../../src/config/opportunityRuntime').createConfiguredOpportunityRuntime}={}){
 const runtime=createRuntime({centralPool:{query(){refuse('PRODUCTION_TENANT_CENTRAL_QUERY_FORBIDDEN');}},editorialEnabled:true,env:{
  OPPORTUNITY_API_CREDENTIALS_JSON:JSON.stringify([tenantCredentials]),
  OPPORTUNITY_ALLOWED_RESIDENCY_JSON:JSON.stringify([{regionCode:config.tenant.regionCode,policyVersion:config.tenant.residencyPolicyVersion}])}});
 const candidate=new PoolClass({host:tenantCredentials.host,port:tenantCredentials.port,database:tenantCredentials.database,user:tenantCredentials.login,
  password:tenantCredentials.password,ssl:config.target.ssl,max:1,connectionTimeoutMillis:5000,
  statement_timeout:30000,idle_in_transaction_session_timeout:30000});
 let client;
 try{
  client=await candidate.connect();
  await runtime.bindingVerifier.verify({client,snapshot,requiredCapabilities:['ACCOUNT_IDENTITY_ERASURE'],correlationId:config.installationId,phase:'PREPARATION'});
 }catch{refuse('PRODUCTION_TENANT_LIMITED_CONNECTION_FAILED');}
 finally{if(client)client.release();await candidate.end();await runtime.poolManager.closeAll();}
}

async function installTenant({tenantPool,config,credentials},dependencies={}){
 const database=identifier(config.target.tenantDatabase);
 const native=dependencies.nativePool||require('../localPlatform/installerAuthority').nativePool;
 const createRunner=dependencies.createRunner||require('../../src/security/tenantMigrationRunner').createTenantMigrationRunner;
 const preflight=dependencies.preflight||require('../../src/security/tenantMigrationPreflight').preflightTenant;
 const ensureAudit=dependencies.ensureAudit||require('../../src/audit/partitionMaintenance').ensureAuditPartitionsWithPool;
 const provisionProfile=dependencies.provisionProfile||provisionTenantApiProfile;
 const verifyConnection=dependencies.verifyConnection||verifyTenantConnection;
 const marker=(await tenantPool.query(`SELECT current_database() AS database,
  (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier,
  to_regclass('c4g_system.tenant_identity') IS NOT NULL AS marker_exists,
  to_regclass('c4g_system.schema_migration') IS NOT NULL AS ledger_exists,
  EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN('public','information_schema'))
   OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
   OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
   OR EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public') AS has_user_objects`)).rows[0];
 if(marker?.database!==config.target.tenantDatabase||marker?.system_identifier!==config.target.expectedSystemIdentifier)refuse('PRODUCTION_TENANT_TARGET_MISMATCH');
 if(marker.marker_exists!==marker.ledger_exists||(!marker.marker_exists&&marker.has_user_objects!==false))refuse('PRODUCTION_TENANT_BASELINE_INVALID');
 if(!marker.marker_exists){
  await tenantPool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await tenantPool.query(`REVOKE CONNECT,TEMP ON DATABASE ${database} FROM PUBLIC`);
  await tenantPool.query(`GRANT CONNECT,CREATE ON DATABASE ${database} TO c4g_tenant_owner`);
  await tenantPool.query(`GRANT CONNECT ON DATABASE ${database} TO c4g_tenant_migrator,c4g_tenant_runtime`);
  await tenantPool.query(`ALTER DATABASE ${database} SET timezone TO 'UTC'`);
  await tenantPool.query("SET TIME ZONE 'UTC'");
  await tenantPool.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${database} SET search_path TO pg_catalog,c4g_app`);
 }
 await createRunner({pool:native(tenantPool),entries:accountIdentityErasureManifest,observationPublisher:{async publish(){}},
  timeoutMs:120000,scheduler:{setTimeout,clearTimeout}}).migrate({tenantId:config.tenant.id,databaseGenerationId:config.tenant.generationId,
  expectedRevision:1,correlationId:config.installationId,idempotencyKey:config.installationId+':tenant-schema'});
 await ensureAudit(tenantPool);
 await provisionProfile({pool:tenantPool,config,password:credentials.tenantApi});
 const evidence=await preflight(tenantPool,{tenantId:config.tenant.id,databaseGenerationId:config.tenant.generationId},accountIdentityErasureManifest,{timeoutMs:30000});
 const expected=accountIdentityErasureManifest.at(-1);
 if(evidence.tenantId!==config.tenant.id||evidence.databaseGenerationId!==config.tenant.generationId
  ||evidence.currentVersion!==expected.version||evidence.schemaFingerprint!==expected.schemaFingerprint
  ||evidence.systemIdentifier!==config.target.expectedSystemIdentifier)refuse('PRODUCTION_TENANT_EVIDENCE_MISMATCH');
 const tenantCredentials={tenantId:config.tenant.id,credentialRef:config.tenant.credentialRef,connectionVersion:1,host:config.target.host,port:config.target.port,
  database:config.target.tenantDatabase,login:config.tenant.apiLogin,password:credentials.tenantApi,ssl:Boolean(config.target.ssl)};
 const snapshot={organizationId:config.organization.id,tenantId:config.tenant.id,workload:'API',deploymentMode:'DATABASE_PER_ORGANIZATION',
  provisioningStatus:'READY',connectionState:'AVAILABLE',connectionVersion:1,connectionRevision:1,versionState:'VALIDATED',
  databaseGenerationId:config.tenant.generationId,databaseRef:config.target.tenantDatabase,credentialRef:config.tenant.credentialRef,
  bindingDigest:bindingDigest({...tenantCredentials,workload:'API'}),observedSystemIdentifier:evidence.systemIdentifier,
  regionCode:config.tenant.regionCode,residencyPolicyVersion:config.tenant.residencyPolicyVersion,fence:0,
  schema:{compatibilityState:'COMPATIBLE',currentVersion:evidence.currentVersion,schemaFingerprint:evidence.schemaFingerprint,revision:1,
   verifiedCapabilities:Object.fromEntries(evidence.capabilities.map(capability=>[capability,true]))}};
 await verifyConnection({config,snapshot,tenantCredentials});
 return {snapshot,tenantCredentials};
}

module.exports={installTenant,provisionTenantApiProfile,verifyTenantConnection,tenantProfileMarker,validateFreshBaseline,FUNCTIONAL_ROLES,PROFILE_CODE};
