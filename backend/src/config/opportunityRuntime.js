'use strict';
const { Pool } = require('pg');
const { createTenantDirectoryRepository } = require('../security/tenantDirectoryRepository');
const { createMembershipRepository } = require('../security/membershipRepository');
const { createTenantCredentialProvider } = require('../security/tenantCredentialProvider');
const { createTenantPoolManager } = require('../security/tenantPoolManager');
const { createTenantBindingVerifier } = require('../security/tenantBindingVerifier');
const { observeTenantRuntimeMetadata } = require('../security/tenantRuntimeMetadata');
const { bindingDigest } = require('../security/localTenantCredentialAdapter');

// Explicit server configuration only; no caller-supplied destination or fallback pool.
// Provisioning, directory publication, roles and schema are existing F4 contracts.
function createConfiguredOpportunityRuntime({centralPool,authorityCoordinator,env,editorialEnabled=false,documentsEnabled=false,credentialResolver,workerFunctionalRoles=null}) {
  if(typeof editorialEnabled!=='boolean'||typeof documentsEnabled!=='boolean')throw new TypeError('Invalid runtime selection.');
  const workload=workerFunctionalRoles ? 'WORKER' : 'API';
  if(workerFunctionalRoles && (editorialEnabled||documentsEnabled||!Array.isArray(workerFunctionalRoles)))throw new TypeError('Invalid worker role profile.');
  // Validate the service scope before constructing resources with independent ownership.
  let directoryRepository;
  if(documentsEnabled){
    let organizations;try{organizations=JSON.parse(env.DOCUMENT_API_ORGANIZATIONS_JSON);}catch{throw new TypeError('TENANT_DIRECTORY_CONFIGURATION_INVALID');}
    directoryRepository=require('../security/tenantDirectoryReader').createTenantDirectoryReader({coordinator:authorityCoordinator,organizations,workload:'API'});
  }else directoryRepository=createTenantDirectoryRepository(centralPool);
  let entries,regions;
  try{entries=JSON.parse(workload==='WORKER'?env.F12_OPPORTUNITY_WORKER_CREDENTIALS_JSON:env.OPPORTUNITY_API_CREDENTIALS_JSON);regions=JSON.parse(env.OPPORTUNITY_ALLOWED_RESIDENCY_JSON);}
  catch{throw new TypeError('Explicit F12 API credential and residency configuration required.');}
  const keys=['tenantId','credentialRef','connectionVersion','host','port','database','login','password','ssl'];
  if(!Array.isArray(entries)||!entries.length||!Array.isArray(regions)||!regions.length
    ||entries.some(e=>!e||Object.keys(e).some(k=>!keys.includes(k))||!Number.isSafeInteger(e.connectionVersion)||e.connectionVersion<1
      ||!Number.isSafeInteger(e.port)||e.port<1||['tenantId','credentialRef','host','database','login','password'].some(k=>typeof e[k]!=='string'||!e[k])
      ||typeof e.ssl!=='boolean')||regions.some(r=>!r||Object.keys(r).sort().join(',')!=='policyVersion,regionCode'
        ||typeof r.regionCode!=='string'||typeof r.policyVersion!=='string'))throw new TypeError('F12 API runtime configuration invalid.');
  const configured=entries.map(e=>Object.freeze({...e,workload}));
  if(new Set(configured.map(e=>`${e.tenantId}:${e.connectionVersion}:${e.credentialRef}`)).size!==configured.length
    ||new Set(configured.map(e=>`${e.host}:${e.port}:${e.database}:${e.login}`)).size!==configured.length)
    throw new TypeError('F12 API credential bindings must be unique.');
  const clock={now:()=>new Date()},scheduler={setTimeout,clearTimeout};
  async function resolveMaterial(request){
    if(request.workload!==workload)throw new Error('CREDENTIAL_UNAVAILABLE');
    const e=configured.find(e=>e.tenantId===request.tenantId&&e.connectionVersion===request.connectionVersion&&e.credentialRef===request.credentialRef)
      || await credentialResolver?.(request);
    if(!e||e.tenantId!==request.tenantId||e.connectionVersion!==request.connectionVersion||e.credentialRef!==request.credentialRef
      ||!Number.isSafeInteger(e.port)||e.port<1||e.port>65535||typeof e.ssl!=='boolean'
      ||['host','database','login','password'].some(k=>typeof e[k]!=='string'||!e[k]))throw new Error('CREDENTIAL_UNAVAILABLE');
    return {...e,workload};
  }
  const credentialProvider=createTenantCredentialProvider({async resolve(request){
    const e=await resolveMaterial(request);
    return{material:e,async dispose(){}};
  }});
  const poolManager=createTenantPoolManager({clock,scheduler,jitter:Math.random,
    poolFactory:async({credentialMaterial:e})=>require('./poolResilience').guardPool(new Pool({host:e.host,port:e.port,database:e.database,user:e.login,password:e.password,
      ssl:e.ssl?{rejectUnauthorized:true}:false,max:5,connectionTimeoutMillis:5000,idleTimeoutMillis:30000}),'tenant-api'),
    policy:{globalLimit:20,perTenantLimit:5,operationalReserve:2,globalQueueLimit:40,perTenantQueueLimit:10,
      operationalQueueReserve:2,acquireTimeoutMs:5000,leaseTimeoutMs:15000,idleTimeoutMs:30000,drainTimeoutMs:10000,
      circuitFailureThreshold:3,circuitResetMs:10000,backoffBaseMs:25,maxBackoffMs:250}});
  const bindingVerifier=createTenantBindingVerifier({async observe({client,snapshot,phase}){
    const preparation=phase==='PREPARATION';
    if(preparation)await client.query('BEGIN TRANSACTION READ ONLY');
    try{
    const login=(await client.query(`SELECT r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolinherit,
      current_user<>session_user AS altered_role,
      pg_catalog.pg_has_role(session_user::text,'c4g_tenant_runtime','MEMBER') AS general_runtime,
      EXISTS(SELECT 1 FROM pg_catalog.pg_roles unsafe WHERE (unsafe.rolsuper OR unsafe.rolbypassrls OR unsafe.rolname~'(owner|migrator|worker_capabilities)$')
        AND unsafe.rolname<>$1 AND pg_catalog.pg_has_role(session_user::text,unsafe.oid,'MEMBER')) AS unsafe_membership
      FROM pg_catalog.pg_roles r WHERE r.rolname=session_user`,[workload==='WORKER'?'c4g_tenant_worker_capabilities':''])).rows[0];
    if(!login||Object.values(login).some(Boolean))throw new Error('TENANT_LIMITED_LOGIN_REQUIRED');
    if(preparation){const context=(await client.query("SELECT current_setting('app.organization_id',true) AS organization_id")).rows[0];
      if(context?.organization_id)throw new Error('TENANT_CONTEXT_NOT_RESET');}
    if(workload==='WORKER'){
      const physical=(await client.query('SELECT current_database() AS database,session_user AS login')).rows[0];
      await require('../security/localTenantIdentityProvisioner').validateLocalTenantRoleChain(client,{login:physical.login,workload,functionalRoles:workerFunctionalRoles});
      const candidate=await resolveMaterial({...snapshot,workload});
      if(candidate.database!==physical.database||candidate.login!==physical.login)throw new Error('TENANT_BINDING_REQUIRED');
      const observed=await observeTenantRuntimeMetadata(client,{tenantId:snapshot.tenantId,databaseGenerationId:snapshot.databaseGenerationId});
      if(preparation)await client.query('COMMIT');
      return {...observed,schemaVersion:observed.currentVersion,bindingDigest:bindingDigest(candidate)};
    }
    const membership=(await client.query(`SELECT granted.rolname,m.set_option,m.inherit_option,m.admin_option
      FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles granted ON granted.oid=m.roleid
      WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)`)).rows;
    if(membership.length!==1||membership[0].rolname!=='c4g_tenant_api_capabilities'||!membership[0].set_option
      ||membership[0].inherit_option||membership[0].admin_option)throw new Error('TENANT_API_MEMBERSHIP_INVALID');
    const profile=(await client.query(`SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication
      FROM pg_catalog.pg_roles WHERE rolname IN('c4g_tenant_api_capabilities','c4g_opportunity_tenant_runtime','c4g_f4_metadata_executor')`)).rows;
    if(profile.length!==3||profile.some(({rolname,...attributes})=>Object.values(attributes).some(Boolean)))throw new Error('TENANT_API_PROFILE_INVALID');
    const metadataDatabasePrivileges=(await client.query(`SELECT
      has_database_privilege('c4g_f4_metadata_owner',current_database(),'CREATE,TEMP,CONNECT') AS owner_privileges,
      has_database_privilege('c4g_f4_metadata_executor',current_database(),'CREATE,TEMP,CONNECT') AS executor_privileges`)).rows[0];
    if(!metadataDatabasePrivileges||Object.values(metadataDatabasePrivileges).some(Boolean))throw new Error('TENANT_METADATA_DATABASE_PRIVILEGES_INVALID');
    const edges=(await client.query(`SELECT granted.rolname,m.set_option,m.inherit_option,m.admin_option FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles granted ON granted.oid=m.roleid WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='c4g_tenant_api_capabilities')`)).rows;
    const expectedRoles=['c4g_opportunity_tenant_runtime','c4g_f4_metadata_executor',...(editorialEnabled?['c4g_organization_profile_runtime']:[]),...(documentsEnabled?['c4g_document_runtime']:[])];
    if(edges.length!==expectedRoles.length||edges.some(edge=>!expectedRoles.includes(edge.rolname)
      ||!edge.set_option||edge.inherit_option||edge.admin_option))throw new Error('TENANT_API_PROFILE_MEMBERSHIP_INVALID');
    if(editorialEnabled||documentsEnabled)await require('../security/localTenantIdentityProvisioner').validateLocalTenantRoleChain(client,
      {login:(await client.query('SELECT session_user AS login')).rows[0].login,workload:'API',functionalRoles:expectedRoles});
    if(documentsEnabled)await require('../security/documentApiRoleContract').validateDocumentRole(client);
    const direct=(await client.query(`WITH managed AS (SELECT oid FROM pg_roles WHERE rolname IN(session_user,'c4g_tenant_api_capabilities')) SELECT
      has_database_privilege(session_user,current_database(),'CREATE,TEMP') AS database_write,
      EXISTS(SELECT 1 FROM pg_class WHERE relowner IN(SELECT oid FROM managed)) AS object_owner,
      EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner IN(SELECT oid FROM managed)) AS schema_owner,
      EXISTS(SELECT 1 FROM pg_proc WHERE proowner IN(SELECT oid FROM managed)) AS function_owner,
      EXISTS(SELECT 1 FROM (
        SELECT a.grantee FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
        UNION ALL SELECT a.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
        UNION ALL SELECT a.grantee FROM pg_attribute t CROSS JOIN LATERAL aclexplode(t.attacl) a
        UNION ALL SELECT a.grantee FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        UNION ALL SELECT a.grantee FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      ) grants WHERE grantee IN(SELECT oid FROM managed)) AS direct_grant,
      EXISTS(SELECT 1 FROM pg_default_acl WHERE defaclrole IN(SELECT oid FROM managed)) AS default_acl_owner`)).rows[0];
    if(!direct||Object.values(direct).some(Boolean))throw new Error('TENANT_API_DIRECT_PRIVILEGES_INVALID');
    const observed=await observeTenantRuntimeMetadata(client,{tenantId:snapshot.tenantId,databaseGenerationId:snapshot.databaseGenerationId});
    const physical=(await client.query('SELECT current_database() AS database,session_user AS login')).rows[0];
    const candidate=await resolveMaterial({...snapshot,workload:'API'});
    const matches=[candidate].filter(e=>e.database===physical.database&&e.login===physical.login);
    if(matches.length!==1)throw new Error('TENANT_BINDING_REQUIRED');
    if(preparation)await client.query('COMMIT');
    return {...observed,schemaVersion:observed.currentVersion,bindingDigest:bindingDigest(matches[0])};
    }catch(error){if(preparation)await client.query('ROLLBACK').catch(()=>{});throw error;}
  }});
  return{clock,scheduler,poolManager,bindingVerifier,credentialProvider,maxAttempts:1,
    directoryRepository,membershipRepository:createMembershipRepository(centralPool,authorityCoordinator),
    regionPolicy:{allows:(region,policy)=>regions.some(r=>r.regionCode===region&&r.policyVersion===policy)}};
}
module.exports={createConfiguredOpportunityRuntime};
