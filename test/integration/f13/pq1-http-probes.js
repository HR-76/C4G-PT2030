'use strict';
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const express=require('../../../backend/node_modules/express');
async function runEditorialUiHttpProbes({databases,central,admin,url,options}){
  // Independent HTTP phase starts with fresh synthetic authentication. Do not
  // lengthen the approved 300-second MFA window to accommodate gate duration.
  for(const db of databases)for(const actor of [db.maker,db.checker,db.submitter]){
    const stored=(await central.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[actor.sid])).rows[0].sess;
    const sid='synthetic-editorial-http-'+randomUUID();stored.auth.evidence.authTime=Math.floor(Date.now()/1000);
    await central.registry.rotateSession({sid,globalUserId:actor.id,revocationVersion:1,expiresAt:stored.auth.absoluteExpiresAt,organizationContext:stored.auth.organizationContext});
    await central.coordinator.write([central.coordinator.sessionKey(sid)],()=>central.coordinator.pool.query(
      'INSERT INTO "public"."application_session_store" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid',
      [stored,stored.auth.absoluteExpiresAt/1000,sid]));
    actor.sid=sid;actor.request={...actor.request,sessionID:sid,authContext:{sessionId:sid}};
    actor.authoring=await db.authoring.captureAuthenticatedRequest(actor.request);
  }
  const {createLocalTenantIdentityProvisioner,configureLocalTenantDatabaseConnect}=require('../../../backend/src/security/localTenantIdentityProvisioner');
  const {bindingDigest}=require('../../../backend/src/security/localTenantCredentialAdapter');
  const credentials=[];
  for(let n=0;n<databases.length;n++){
    const db=databases[n],apiLogin=`c4g_editorial_api_${n}`,workerLogin=`c4g_editorial_worker_${n}`,password=randomBytes(32).toString('hex');
    await (await createLocalTenantIdentityProvisioner(admin)).reconcile({apiLogin,workerLogin,apiPassword:password,
      workerPassword:randomBytes(32).toString('hex'),apiRoles:['c4g_opportunity_tenant_runtime','c4g_organization_profile_runtime'],workerRoles:['c4g_import_worker_runtime']});
    await configureLocalTenantDatabaseConnect(admin,{database:db.name,authorizedLogins:[apiLogin],knownLogins:databases.map((_,i)=>`c4g_editorial_api_${i}`).filter((_,i)=>i<=n)});
    const credentialRef=`editorial-http-${n}`;
    credentials.push({tenantId:db.org,credentialRef,connectionVersion:1,host:url.hostname,port:Number(url.port),database:db.name,login:apiLogin,password,ssl:false});
    db.httpSnapshot={...db.snapshot,credentialRef,bindingDigest:bindingDigest({tenantId:db.org,workload:'API',connectionVersion:1,credentialRef,database:db.name,login:apiLogin})};
  }
  for(const db of databases)await configureLocalTenantDatabaseConnect(admin,{database:db.name,
    authorizedLogins:[credentials.find(c=>c.tenantId===db.org).login],knownLogins:credentials.map(c=>c.login)});
  const configured=require('../../../backend/src/config/opportunityRuntime').createConfiguredOpportunityRuntime({centralPool:central.pool,
    authorityCoordinator:central.coordinator,editorialEnabled:true,env:{OPPORTUNITY_API_CREDENTIALS_JSON:JSON.stringify(credentials),
      OPPORTUNITY_ALLOWED_RESIDENCY_JSON:JSON.stringify([{regionCode:'SYNTHETIC',policyVersion:'synthetic-v1'}])}});
  let fault=null, reachedCommit=null, releaseCommit=null, commitBarrier=null;
  const observedManager={...configured.poolManager,async acquire(request){const allocation=await configured.poolManager.acquire(request);const client=allocation.client;let lost=false,paused=false;return {...allocation,client:{
    on:(...args)=>client.on(...args),removeListener:(...args)=>client.removeListener(...args),
    async query(sql,values){
      if(sql.includes('audit.append_event_v1')&&((values?.[2]==='PROFILE_VERSION_APPROVED'&&fault==='F7')||(values?.[2]==='PROFILE_VERSION_PUBLISHED'&&fault==='F7_PUBLISH')||(values?.[2]==='ASSERTION_REVOKED'&&fault==='F7_REVOKE')||(values?.[2]==='PROFILE_DRAFT_REVISION_CREATED'&&fault==='F7_EXPERIENCE'))){fault=null;throw new Error('SYNTHETIC_F7_FAILURE');}
      if(sql.includes('audit.append_event_v1')&&values?.[2]==='PROFILE_VERSION_PUBLISHED'&&fault==='COMMIT'){fault=null;lost=true;}
      if(sql.includes('audit.append_event_v1')&&fault==='PAUSE:'+values?.[2]){fault=null;paused=true;}
      if(sql==='COMMIT'&&paused){paused=false;reachedCommit();await commitBarrier;}
      const result=await client.query(sql,values);if(sql==='COMMIT'&&lost){lost=false;throw new Error('SYNTHETIC_COMMIT_ACK_LOST');}return result;
    }}};}};
  const dependencies={...configured,poolManager:observedManager,directoryRepository:{async resolveSnapshotByOrganization(org){return structuredClone(databases.find(db=>db.org===org)?.httpSnapshot||null);}}};
  // Distinct coordinator instance, same protected Central protocol and recovery
  // binding: this models a fresh HTTP process rather than rebinding a live one.
  const coordinator=require('../../../backend/src/security/authorityCoordinator').createAuthorityCoordinator({pool:central.authorityPool,permitSecret:central.permitSecret});
  const registry=require('../../../backend/src/security/sessionRegistry').createPgSessionRegistry(central.pool,coordinator);
  const store={get(sid,callback){coordinator.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[sid]).then(result=>callback(null,result.rows[0]?.sess),callback);}};
  const service=require('../../../backend/src/organizationalProfile/pq1UiComposition').createPq1UiComposition({...options,
    sessionRegistry:registry,sessionStore:store,authorityCoordinator:coordinator,tenantRuntimeDependencies:dependencies,
    tokenKeys:{local:randomBytes(32).toString('hex')},tokenKeyId:'local',mfaCategory:'recent-mfa',
    onFailure(error){console.error('UI_GATE_DIAGNOSTIC',error.code,error.message);}});
  const sessions=new Map();
  for(const db of databases)for(const actor of [db.maker,db.checker,db.submitter])sessions.set(actor.sid,actor.request);
  const app=express();app.use(express.json());
  const pass=(req,res,next)=>next();
  app.use('/api/organizational-profile/pq1-publication',require('../../../backend/src/routes/pq1UiRoutes').createPq1UiRouter({express,service,
    authenticate(req,res,next){const request=sessions.get(req.headers['x-synthetic-session']);if(!request)return res.status(401).json({error:{code:'SESSION_REQUIRED'}});Object.assign(req,request);next();},
    organizationMiddleware:{requireServerSession:pass,resolveOrganizationContext:pass,requireOrganizationContext:pass}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const root=`http://127.0.0.1:${server.address().port}/api/organizational-profile/pq1-publication`;
  async function call(path,actor,body,method=body?'POST':'GET') {
    const response=await fetch(root+path,{method,headers:{'content-type':'application/json','x-synthetic-session':actor.sid},...(body?{body:JSON.stringify(body)}:{})});
    const value=await response.json();
    assert(!/"[^" ]*(?:digest|authors|policyRef|evidenceRefs)[^" ]*"\s*:/i.test(JSON.stringify(value)));
    process.stdout.write(`UI_HTTP ${method} ${path.replace(/[a-f0-9-]{36}/g,':id')} ${response.status}\n`);
    return {status:response.status,value};
  }
  const control={pause(event='PROFILE_VERSION_PUBLISHED'){const reached=new Promise(resolve=>{reachedCommit=resolve;});commitBarrier=new Promise(resolve=>{releaseCommit=resolve;});fault='PAUSE:'+event;return {reached,release:()=>releaseCommit()};}};
  try {
    if(process.env.PQ1_STATUS_RACES==='1') await require('./pq1-status-races').run({databases,call,control});
    else if(process.env.PQ1_RACES_ONLY==='1') await require('./pq1-competency-races').run({databases,call,control});
    else if(process.env.PQ1_AUTHORIZATION_ONLY==='1') await require('./pq1-authorization-probes').run({databases,central,call});
    else if(process.env.PQ1_RECOVERY_ONLY==='1') {
      const db=databases[0],draftId=randomUUID(),assertions=[{assertionId:randomUUID(),versionId:randomUUID(),knowledgeStatus:'UNKNOWN',conceptId:null,levelId:null}];
      const ok=async(path,actor,body,verb)=>{const r=await call(path,actor,body,verb);assert(r.status<300,JSON.stringify(r));return r.value;};
      await ok('/drafts',db.maker,{draftId,items:db.draft.items,idempotencyKey:randomUUID()});
      await ok(`/drafts/${draftId}/competencies`,db.maker,{expectedRevision:1,assertions,idempotencyKey:randomUUID()},'PUT');
      const c=await ok(`/drafts/${draftId}/submit`,db.maker,{expectedRevision:2,idempotencyKey:randomUUID()});
      const projection=await ok('/candidates/'+c.candidateId,db.checker);
      const v=await ok(`/candidates/${c.candidateId}/approve`,db.checker,{concurrencyToken:projection.actions[0].concurrencyToken,idempotencyKey:randomUUID()});
      db.pq1ApprovedVersion=v.versionId;
    }
    else if(process.env.PQ1_CONSISTENCY==='1') await require('./pq1-consistency-probes').run({databases,central,call,control});
    else if(process.env.PQ1_BROWSER_ONLY==='1') { for(const db of databases) await require('./pq1-http-scenarios').seed(db); }
    else await require('./pq1-http-scenarios').run({databases,central,call,control,setFault:value=>{fault=value;}});
    if(process.env.PQ1_BROWSER==='1'||process.env.PQ1_BROWSER_ONLY==='1'||process.env.PQ1_RECOVERY_ONLY==='1') await require('./pq1-browser').browserEditorial({central,databases,dependencies,control});
  } finally {await new Promise(resolve=>server.close(resolve));await configured.poolManager.closeAll();}
}
module.exports={runEditorialUiHttpProbes};
