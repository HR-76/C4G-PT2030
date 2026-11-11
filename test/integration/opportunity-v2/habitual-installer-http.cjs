'use strict';
// Concrete HTTP routes with a declared synthetic signed session. No OIDC
// response or application read response is supplied by the proof driver.
const {randomBytes}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {policyVersion,recentMfaRequirement}=require('./executor-11145-fixture.cjs');
async function createHttp({central,connection,fixture,report,fetchImpl}){
 const password=randomBytes(32).toString('hex');await central.query(`ALTER ROLE c4g_authority_runtime PASSWORD '${password}'`);await central.query('GRANT CONNECT ON DATABASE registered_central TO c4g_authority_runtime');
 const authorityPool=new Pool({...connection,database:'registered_central',user:'c4g_authority_runtime',password});let server,store;
 try{
  const coordinator=require('../../../backend/src/security/authorityCoordinator').createAuthorityCoordinator({pool:authorityPool,permitSecret:randomBytes(48).toString('hex')});
  const registry=require('../../../backend/src/security/sessionRegistry').createPgSessionRegistry(central,coordinator);
  const express=require('../../../backend/node_modules/express'),session=require('../../../backend/node_modules/express-session'),PgStore=require('../../../backend/node_modules/connect-pg-simple')(session),app=express();
  server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
  const base='http://127.0.0.1:'+server.address().port,secret=randomBytes(48).toString('hex'),cookieName='habitual-installer-isolated-session';
  store=new PgStore({pool:coordinator.pool,schemaName:'public',tableName:'application_session_store',createTableIfMissing:false,pruneSessionInterval:false});
  const {createSessionSecurity,csrfTokenForSession}=require('../../../backend/src/security/sessionSecurity');
  const security=createSessionSecurity({config:{sessionCookieName:cookieName,sessionSecret:secret,secureCookie:false,sessionIdleMs:1800000,nodeEnv:'test',publicOrigin:new URL(base),allowedDevelopmentOrigins:[]},pool:coordinator.pool,sessionStore:store,authorityCoordinator:coordinator});
  const authentication=require('../../../backend/src/middlewares/authMiddleware');authentication.configureAuthentication({mode:'oidc',policyVersion,sessionRegistry:registry});
  const organization=require('../../../backend/src/middlewares/organizationContext').createOrganizationContextMiddleware({organizationSession:null});
  app.use(express.json({limit:'1mb'}),security.sessionMiddleware,security.originProtection,security.csrfProtection);
  const options={express,pool:central,policyVersion,recentMfaRequirement,authenticate:authentication.authenticate,requireServerSession:organization.requireServerSession,originProtection:security.originProtection,csrfProtection:security.csrfProtection};
  app.use('/api/admin/opportunity-activation',require('../../../backend/src/opportunities/v2/activationHttp').createOpportunityActivationHttpRuntime({...options,executorMode:'bounded-v2',executorFetchImpl:fetchImpl}).router);
  // Login/provider callbacks are not invoked. The production session route and
  // concrete session authentication read the coordinator-persisted session.
  const controller=require('../../../backend/src/controllers/oidcAuthController').createOidcAuthController({config:{},oidcClient:null,identityRepository:null,sessionRegistry:registry});
  app.use('/api/auth',require('../../../backend/src/routes/oidcAuthRoutes').createOidcAuthRouter({express,controller,authenticate:authentication.authenticate,generateCsrfToken:security.generateCsrfToken}));
  const catalogReader=require('../../../backend/src/fundingTenders/repository').createFundingRepository({pool:central,readRole:true});
  const funding=require('../../../backend/src/fundingTenders/http').createFundingRouters({express,pool:central,catalogReader,authenticate:authentication.authenticate,organizationMiddleware:organization,sessionRegistry:registry,policyVersion,recentMfaRequirement,sourceMode:'fixture',euSourceControlEnabled:true});
  app.use('/api/admin/central-opportunities',funding.platformCatalog);app.use('/api/admin/integrations',funding.admin);
  app.use((error,_req,res,_next)=>{report.lastHttpError={code:error.code||'HTTP_ERROR'};res.status(error.statusCode||error.status||500).json({code:error.code||'HTTP_ERROR'});});
  const roles=(await central.query("SELECT role_code FROM public.platform_admin_assignment WHERE global_user_id=$1 AND status='ACTIVE' ORDER BY role_code",[fixture.actor.id])).rows.map(row=>row.role_code),now=Date.now();
  const stored={cookie:{expires:new Date(now+1800000).toISOString(),originalMaxAge:1800000,httpOnly:true,path:'/',sameSite:'lax'},auth:{user:{id:fixture.actor.id,platformRoles:roles},identity:{issuer:'https://installer.example.invalid',subject:fixture.actor.id},policyVersion,revocationVersion:1,absoluteExpiresAt:now+3600000,evidence:{authTime:Math.floor(now/1000),acr:'c4g-loa1',amr:['pwd'],policyVersion}}};
  await registry.rotateSession({sid:fixture.actor.sessionId,globalUserId:fixture.actor.id,revocationVersion:1,expiresAt:stored.auth.absoluteExpiresAt});await new Promise((resolve,reject)=>store.set(fixture.actor.sessionId,stored,error=>error?reject(error):resolve()));
  return{authenticatedAt:now,async request(method,url,body,expectedStatus=200){
   require('../../../scripts/opportunity-v2-approve.cjs').httpCommand(method,url,body);
   const signature=require('../../../backend/node_modules/cookie-signature'),headers={cookie:cookieName+'='+encodeURIComponent('s:'+signature.sign(fixture.actor.sessionId,secret))};
   if(method!=='GET'){headers.origin=base;headers['x-csrf-token']=csrfTokenForSession({sessionID:fixture.actor.sessionId},secret);headers['content-type']='application/json';}
   const response=await fetch(base+url,{method,headers,signal:AbortSignal.timeout(90000),...(body===undefined?{}:{body:JSON.stringify(body)})}),data=await response.json();
   if(response.status!==expectedStatus)throw Object.assign(Error('INSTALLER_HTTP_STATUS_MISMATCH'),{code:'INSTALLER_HTTP_STATUS_MISMATCH',httpStatus:response.status,publicCode:data?.error?.code||data?.code});if(url.startsWith('/api/admin/central-opportunities/'))report.catalogShape={rowVersionType:typeof data.rowVersion,sourceVersion:data.readModel?.sourceVersion,snapshotSchemaVersion:data.snapshot?.schemaVersion};return data;
  },async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close?.();await authorityPool.end();}};
 }catch(error){if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store?.close?.();await authorityPool.end();throw error;}
}
module.exports={createHttp};
