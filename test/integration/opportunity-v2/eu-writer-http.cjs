'use strict';
// Isolated writer HTTP fixture, concrete production middleware and coordinator.
const assert=require('node:assert/strict'),{randomUUID,randomBytes}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {policyVersion,recentMfaRequirement}=require('./executor-11145-fixture.cjs');
async function httpRuntime({central,connection,fixture,report,fetchImpl,executorEnabled=true,euWriterCapability=null,workerHealth=null,writerWindowWorkspaceRoot,reconciliationWorkspaceRoot}){
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
  const runtimeOptions={express,pool:central,policyVersion,recentMfaRequirement,authenticate:authentication.authenticate,requireServerSession:organization.requireServerSession,originProtection:security.originProtection,csrfProtection:security.csrfProtection,euWriterCapability,workerHealth,writerWindowWorkspaceRoot,reconciliationWorkspaceRoot};
  const runtime=createRuntime({...runtimeOptions,executorMode:executorEnabled?'bounded-v2':'disabled',executorFetchImpl:fetchImpl});
  app.use('/api/admin/opportunity-activation',runtime.router);
  app.use('/api/admin/opportunity-activation-disabled',createRuntime({...runtimeOptions,executorMode:'disabled',executorFetchImpl:fetchImpl}).router);
  const controller=require('../../../backend/src/controllers/oidcAuthController').createOidcAuthController({config:{},oidcClient:null,identityRepository:null,sessionRegistry:registry});
  app.use('/api/auth',require('../../../backend/src/routes/oidcAuthRoutes').createOidcAuthRouter({express,controller,authenticate:authentication.authenticate,generateCsrfToken:security.generateCsrfToken}));
  const catalogReader=require('../../../backend/src/fundingTenders/repository').createFundingRepository({pool:central,readRole:true});
  const funding=require('../../../backend/src/fundingTenders/http').createFundingRouters({express,pool:central,catalogReader,authenticate:authentication.authenticate,organizationMiddleware:organization,sessionRegistry:registry,policyVersion,recentMfaRequirement,sourceMode:'fixture',workerHealth,
   coverage:euWriterCapability?{supported:true,enabled:true,temporalSupported:true,resolutionSupported:true,enrichmentEnabled:true}:{supported:false,enabled:false},euSourceControlEnabled:true,euWriterV2:euWriterCapability});
  app.use('/api/admin/integrations',security.originProtection,security.csrfProtection,funding.admin);
  app.use((error,_req,res,_next)=>{report.lastHttpError={code:error.code||'HTTP_ERROR'};res.status(error.statusCode||error.status||500).json({code:error.code||'HTTP_ERROR'});});
  const call=(method,...args)=>new Promise((resolve,reject)=>store[method](...args,(error,value)=>error?reject(error):resolve(value)));
  async function bind(actor,{stale=false}={}){const now=Date.now(),platformRoles=(await central.query("SELECT role_code FROM public.platform_admin_assignment WHERE global_user_id=$1 AND status='ACTIVE' ORDER BY role_code",[actor.id])).rows.map(row=>row.role_code);actor.session={cookie:{expires:new Date(now+1800000).toISOString(),originalMaxAge:1800000,httpOnly:true,path:'/',sameSite:'lax'},auth:{user:{id:actor.id,platformRoles},identity:{issuer:'https://executor.example.invalid',subject:actor.id},policyVersion,revocationVersion:1,absoluteExpiresAt:now+3600000,evidence:{authTime:Math.floor(now/1000)-(stale?3600:0),acr:'c4g-loa1',amr:['pwd'],policyVersion}}};await registry.rotateSession({sid:actor.sessionId,globalUserId:actor.id,revocationVersion:1,expiresAt:actor.session.auth.absoluteExpiresAt});await call('set',actor.sessionId,actor.session);}
  await bind(fixture.actor);
  return {coordinator,registry,authorityPool,store,call,bind,async request(actor,method,url,body,options={}){
   const signature=require('../../../backend/node_modules/cookie-signature'),headers={};if(actor)headers.cookie=cookieName+'='+encodeURIComponent('s:'+signature.sign(actor.sessionId,secret));
   if(method!=='GET'){headers.origin=options.origin||base;if(actor&&options.csrf!==false)headers['x-csrf-token']=csrfTokenForSession({sessionID:actor.sessionId},secret);headers['content-type']='application/json';}
   const response=await fetch(base+(url.startsWith('/api/')?url:(options.disabled?'/api/admin/opportunity-activation-disabled':'/api/admin/opportunity-activation')+url),{method,headers,signal:AbortSignal.timeout(150000),...(body===undefined?{}:{body:JSON.stringify(body)})});let data;try{data=await response.json();}catch{data=null;}return {status:response.status,data};
  },async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close?.();await authorityPool.end();}};
 }catch(error){if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store?.close?.();await authorityPool.end();throw error;}
}
module.exports={httpRuntime};
