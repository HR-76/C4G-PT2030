'use strict';
// Synthetic authority and legacy history only. The collector's archive and
// SUCCESS run are always produced by its live public transport, never here.
const assert=require('node:assert/strict'),{randomUUID,randomBytes}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {prefix}=require('./registered-package-proof.cjs');
const {seedLegacy,policyVersion,recentMfaRequirement}=require('./activation-proof.cjs');
async function transaction(pool,role,organizationId,work){const c=await pool.connect();try{await c.query('BEGIN');if(role)await c.query('SET LOCAL ROLE '+role);if(organizationId)await c.query("SELECT set_config('app.organization_id',$1,true)",[organizationId]);const value=await work(c);await c.query('COMMIT');return value;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}
async function bootstrap(central,tenant){
 const cm=require('../../../backend/src/security/centralMigrationManifest'),tm=require('../../../backend/src/security/tenantMigrationManifest');
 await central.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
 await require('../../../backend/scripts/runCentralMigrations').applyCentralMigrationsWithManifest(central,prefix(cm.manifest,'035_funding_source_resolution'),cm.migrationSql);
 const actor={id:randomUUID(),assignmentId:randomUUID(),sessionId:'executor-11145-'+randomUUID()},organizationId=randomUUID(),membershipId=randomUUID(),identity={tenantId:randomUUID(),databaseGenerationId:randomUUID()};
 await central.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Isolated executor administrator',$2,'ACTIVE')",[actor.id,actor.id+'@example.invalid']);
 await central.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[actor.assignmentId,actor.id]);
 await central.query("INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code) VALUES($1,'Executor fixture','Executor fixture',$2,'UNIVERSITY','ACTIVE','EUR','OPTIONAL')",[organizationId,'executor-'+organizationId]);
 await central.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) VALUES($1,$2,$3,'ORG_ADMIN','ACTIVE',clock_timestamp())",[membershipId,actor.id,organizationId]);
 await require('../../../backend/src/security/tenantDirectoryRepository').createTenantDirectoryRepository(central).createTenant({organizationId,tenantId:identity.tenantId,correlationId:randomUUID(),idempotencyKey:randomUUID()});
 const legacyRunId=randomUUID();await central.query("INSERT INTO opportunity_catalog.funding_run(run_id,request_id,requested_by,status,source_code,observed_at,error_code,finished_at) VALUES($1,$2,$3,'ERROR','EU_FUNDING_TENDERS','2026-10-30T22:45:39.461Z','ISOLATED_LEGACY_HISTORY',clock_timestamp())",[legacyRunId,randomUUID(),actor.id]);
 const legacy=await seedLegacy(central,(await central.query('SELECT * FROM opportunity_catalog.funding_run WHERE run_id=$1',[legacyRunId])).rows[0]);
 const publisher=require('../../../backend/src/security/tenantSchemaObservationPublisher').createTenantSchemaObservationPublisher(require('../../../backend/src/security/tenantSchemaRepository').createTenantSchemaRepository(central));
 const runner=require('../../../backend/src/security/tenantMigrationRunner').createTenantMigrationRunner({pool:tenant,entries:prefix(tm.manifest,'033_organizational_opportunity_interests'),loadMigration:tm.migrationSql,observationPublisher:publisher,timeoutMs:30000,scheduler:{setTimeout,clearTimeout}});
 await runner.migrate({...identity,expectedRevision:1,correlationId:randomUUID(),idempotencyKey:randomUUID()});
 const applicationId=randomUUID(),interestId=randomUUID(),unitId=randomUUID();
 await transaction(tenant,'c4g_opportunity_tenant_runtime',organizationId,async c=>{
  await c.query("INSERT INTO organizational_scope.scope(scope_id,organization_id,scope_type,label,lifecycle,provenance,created_by_actor_type,created_by_actor_id,updated_by_actor_type,updated_by_actor_id) VALUES($1,$2,'UNIT','Preserved executor unit','ACTIVE','{}','HUMAN',$3,'HUMAN',$3)",[unitId,organizationId,actor.id]);
  await c.query("INSERT INTO opportunity_catalog.opportunity_interest(organization_id,interest_id,central_opportunity_id,central_revision_id,central_snapshot,title,created_by,created_membership_id) VALUES($1,$2,$3,$4,$5,'Preserved executor interest',$6,$7)",[organizationId,interestId,legacy.opportunityId,legacy.revisionId,legacy.snapshot,actor.id,membershipId]);
  await c.query("INSERT INTO opportunity_catalog.interest_change(organization_id,interest_id,revision,kind,title,status,actor_subject_id,actor_membership_id) VALUES($1,$2,1,'REGISTER','Preserved executor interest','ACTIVE',$3,$4)",[organizationId,interestId,actor.id,membershipId]);
  await c.query('INSERT INTO opportunity_catalog.interest_unit(organization_id,interest_id,scope_id) VALUES($1,$2,$3)',[organizationId,interestId,unitId]);
  await c.query("INSERT INTO opportunity_catalog.application(organization_id,application_id,opportunity_id,evaluation_id,title,responsible_membership_id,deadline,status,created_by,central_opportunity_id,central_revision_id,central_snapshot,source_interest_id,source_interest_revision) VALUES($1,$2,NULL,NULL,'Preserved executor application',$3,'2028-09-02','IDENTIFIED',$4,$5,$6,$7,$8,1)",[organizationId,applicationId,membershipId,actor.id,legacy.opportunityId,legacy.revisionId,legacy.snapshot,interestId]);
  await c.query('INSERT INTO opportunity_catalog.application_unit(organization_id,application_id,scope_id) VALUES($1,$2,$3)',[organizationId,applicationId,unitId]);
 });
 return {actor,organizationId,membershipId,identity,legacy,legacyRunId,links:{applicationId,interestId,unitId}};
}
async function httpRuntime({central,connection,fixture,report,fetchImpl,executorEnabled=true}){
 const password=randomBytes(32).toString('hex');await central.query(`ALTER ROLE c4g_authority_runtime PASSWORD '${password}'`);await central.query('GRANT CONNECT ON DATABASE registered_central TO c4g_authority_runtime');
 const authorityPool=new Pool({...connection,database:'registered_central',user:'c4g_authority_runtime',password});let server,store;
 try{
  const coordinator=require('../../../backend/src/security/authorityCoordinator').createAuthorityCoordinator({pool:authorityPool,permitSecret:randomBytes(48).toString('hex')});
  const registry=require('../../../backend/src/security/sessionRegistry').createPgSessionRegistry(central,coordinator);
  const express=require('../../../backend/node_modules/express'),session=require('../../../backend/node_modules/express-session'),PgStore=require('../../../backend/node_modules/connect-pg-simple')(session),app=express();
  server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
  const base='http://127.0.0.1:'+server.address().port,secret=randomBytes(48).toString('hex'),cookieName='executor-11145-session';
  store=new PgStore({pool:coordinator.pool,schemaName:'public',tableName:'application_session_store',createTableIfMissing:false,pruneSessionInterval:false});
  const {createSessionSecurity,csrfTokenForSession}=require('../../../backend/src/security/sessionSecurity');
  const security=createSessionSecurity({config:{sessionCookieName:cookieName,sessionSecret:secret,secureCookie:false,sessionIdleMs:1800000,nodeEnv:'test',publicOrigin:new URL(base),allowedDevelopmentOrigins:[]},pool:coordinator.pool,sessionStore:store,authorityCoordinator:coordinator});
  const authentication=require('../../../backend/src/middlewares/authMiddleware');authentication.configureAuthentication({mode:'oidc',policyVersion,sessionRegistry:registry});
  const organization=require('../../../backend/src/middlewares/organizationContext').createOrganizationContextMiddleware({organizationSession:null});
  app.use(express.json({limit:'1mb'}),security.sessionMiddleware);
  // These are the concrete operational factories; no authority, approval or
  // persistence callback is replaced with a permissive test implementation.
  const createRuntime=require('../../../backend/src/opportunities/v2/activationHttp').createOpportunityActivationHttpRuntime;
  const runtimeOptions={express,pool:central,policyVersion,recentMfaRequirement,authenticate:authentication.authenticate,requireServerSession:organization.requireServerSession,originProtection:security.originProtection,csrfProtection:security.csrfProtection};
  const runtime=createRuntime({...runtimeOptions,executorMode:executorEnabled?'bounded-v2':'disabled',executorFetchImpl:fetchImpl});
  app.use('/api/admin/opportunity-activation',runtime.router);
  app.use('/api/admin/opportunity-activation-disabled',createRuntime({...runtimeOptions,executorMode:'disabled',executorFetchImpl:fetchImpl}).router);
  app.use((error,_req,res,_next)=>{report.lastHttpError={code:error.code||'HTTP_ERROR'};res.status(error.statusCode||error.status||500).json({code:error.code||'HTTP_ERROR'});});
  const call=(method,...args)=>new Promise((resolve,reject)=>store[method](...args,(error,value)=>error?reject(error):resolve(value)));
  async function bind(actor,{stale=false}={}){const now=Date.now();actor.session={cookie:{expires:new Date(now+1800000).toISOString(),originalMaxAge:1800000,httpOnly:true,path:'/',sameSite:'lax'},auth:{user:{id:actor.id},identity:{issuer:'https://executor.example.invalid',subject:actor.id},policyVersion,revocationVersion:1,absoluteExpiresAt:now+3600000,evidence:{authTime:Math.floor(now/1000)-(stale?3600:0),acr:'c4g-loa1',amr:['pwd'],policyVersion}}};await registry.rotateSession({sid:actor.sessionId,globalUserId:actor.id,revocationVersion:1,expiresAt:actor.session.auth.absoluteExpiresAt});await call('set',actor.sessionId,actor.session);}
  await bind(fixture.actor);
  return {coordinator,registry,authorityPool,store,call,bind,async request(actor,method,url,body,options={}){
   const signature=require('../../../backend/node_modules/cookie-signature'),headers={};if(actor)headers.cookie=cookieName+'='+encodeURIComponent('s:'+signature.sign(actor.sessionId,secret));
   if(method!=='GET'){headers.origin=options.origin||base;if(actor&&options.csrf!==false)headers['x-csrf-token']=csrfTokenForSession({sessionID:actor.sessionId},secret);headers['content-type']='application/json';}
   const response=await fetch(base+(options.disabled?'/api/admin/opportunity-activation-disabled':'/api/admin/opportunity-activation')+url,{method,headers,signal:AbortSignal.timeout(150000),...(body===undefined?{}:{body:JSON.stringify(body)})});let data;try{data=await response.json();}catch{data=null;}return {status:response.status,data};
  },async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close?.();await authorityPool.end();}};
 }catch(error){if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store?.close?.();await authorityPool.end();throw error;}
}
module.exports={bootstrap,httpRuntime,transaction,policyVersion,recentMfaRequirement};
