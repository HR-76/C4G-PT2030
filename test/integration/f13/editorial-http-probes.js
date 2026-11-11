'use strict';
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const express=require('../../../backend/node_modules/express');
async function runEditorialHttpProbes({databases,central,admin,url,options}){
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
  const dependencies={...configured,directoryRepository:{async resolveSnapshotByOrganization(org){return structuredClone(databases.find(db=>db.org===org)?.httpSnapshot||null);}}};
  // Distinct coordinator instance, same protected Central protocol and recovery
  // binding: this models a fresh HTTP process rather than rebinding a live one.
  const coordinator=require('../../../backend/src/security/authorityCoordinator').createAuthorityCoordinator({pool:central.authorityPool,permitSecret:central.permitSecret});
  const registry=require('../../../backend/src/security/sessionRegistry').createPgSessionRegistry(central.pool,coordinator);
  const store={get(sid,callback){coordinator.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[sid]).then(result=>callback(null,result.rows[0]?.sess),callback);}};
  const service=require('../../../backend/src/organizationalProfile/editorialComposition').createEditorialHttpComposition({...options,
    sessionRegistry:registry,sessionStore:store,authorityCoordinator:coordinator,tenantRuntimeDependencies:dependencies});
  const sessions=new Map();
  for(const db of databases)for(const actor of [db.maker,db.checker,db.submitter])sessions.set(actor.sid,actor.request);
  const deniedActor=await central.user(databases[0].org,randomUUID(),randomUUID());
  sessions.set(deniedActor.sid,deniedActor.request);
  const app=express();app.use(express.json());
  const pass=(req,res,next)=>next();
  app.use('/api/organization-profile/editorial',require('../../../backend/src/routes/editorialProfileRoutes').createEditorialProfileRouter({express,service,
    authenticate(req,res,next){const request=sessions.get(req.headers['x-synthetic-session']);if(!request)return res.status(401).json({error:{code:'SESSION_REQUIRED'}});Object.assign(req,request);next();},
    organizationMiddleware:{requireServerSession:pass,resolveOrganizationContext:pass,requireOrganizationContext:pass}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const root=`http://127.0.0.1:${server.address().port}/api/organization-profile/editorial`;
  try{
    for(const db of databases){
      const draft={...db.draft,draftId:randomUUID(),idempotencyKey:randomUUID()};
      await db.authoring.service.createDraft(draft,db.maker.authoring);
      const post=async(path,body,actor)=>fetch(`${root}${path}`,{method:'POST',headers:{'content-type':'application/json','x-synthetic-session':actor.sid},body:JSON.stringify(body)});
      const submitted=await post(`/drafts/${draft.draftId}/submit`,{expectedRevision:1,idempotencyKey:randomUUID()},db.submitter);
      assert.equal(submitted.status,201);const candidate=await submitted.json();
      const approval={expectedCandidateDigest:candidate.candidateDigest,idempotencyKey:randomUUID()};
      assert.equal((await post(`/candidates/${candidate.candidateId}/approve`,approval,db.maker)).status,403);
      const approved=await post(`/candidates/${candidate.candidateId}/approve`,approval,db.checker);
      assert.equal(approved.status,201);const version=await approved.json();
      const published=await post(`/versions/${version.versionId}/publish`,{expectedVersionDigest:version.versionDigest,idempotencyKey:randomUUID()},db.checker);
      assert.equal(published.status,200);assert.deepEqual(await published.json(),{versionId:version.versionId,state:'PUBLISHED',active:false});
      const response=await fetch(`${root}/versions/${db.version.versionId}`,{headers:{'x-synthetic-session':db.maker.sid}});
      assert.equal(response.status,200);const read=await response.json();assert.equal(read.state,'PUBLISHED');assert.equal(read.active,false);
      assert.equal(JSON.stringify(read).includes('sourceDigest'),false);
      for(const id of [randomUUID(),databases.find(other=>other!==db).version.versionId]){
        const negative=await fetch(`${root}/versions/${id}`,{headers:{'x-synthetic-session':db.maker.sid}});
        assert.equal(negative.status,404);assert.deepEqual(await negative.json(),{error:{code:'F13_RESOURCE_NOT_AVAILABLE'}});
      }
      const unknown=await fetch(`${root}/versions/${db.version.versionId}?policy=other`,{headers:{'x-synthetic-session':db.maker.sid}});assert.equal(unknown.status,400);
      assert.ok((await db.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='PROFILE_ACCESSED'")).rows[0].n>=1);
    }
    for(const id of [databases[0].version.versionId,databases[1].version.versionId,randomUUID()]){
      const response=await fetch(`${root}/versions/${id}`,{headers:{'x-synthetic-session':deniedActor.sid}});
      assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:{code:'F13_AUTHORIZATION_REQUIRED'}});
    }
    assert.equal((await fetch(`${root}/versions/${randomUUID()}`)).status,401);
    process.stdout.write('F13_EDITORIAL_HTTP_LIMITED_IDENTITY_AB: PASS\n');
  }finally{await new Promise(resolve=>server.close(resolve));await configured.poolManager.closeAll();}
}
module.exports={runEditorialHttpProbes};
