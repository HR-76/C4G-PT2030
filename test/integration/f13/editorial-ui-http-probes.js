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
      if(sql.includes('audit.append_event_v1')&&values?.[2]==='PROFILE_VERSION_APPROVED'&&fault==='F7'){fault=null;throw new Error('SYNTHETIC_F7_FAILURE');}
      if(sql.includes('audit.append_event_v1')&&values?.[2]==='PROFILE_VERSION_PUBLISHED'&&fault==='COMMIT'){fault=null;lost=true;}
      if(sql.includes('audit.append_event_v1')&&values?.[2]==='PROFILE_VERSION_PUBLISHED'&&fault==='PAUSE'){fault=null;paused=true;}
      if(sql==='COMMIT'&&paused){paused=false;reachedCommit();await commitBarrier;}
      const result=await client.query(sql,values);if(sql==='COMMIT'&&lost){lost=false;throw new Error('SYNTHETIC_COMMIT_ACK_LOST');}return result;
    }}};}};
  const dependencies={...configured,poolManager:observedManager,directoryRepository:{async resolveSnapshotByOrganization(org){return structuredClone(databases.find(db=>db.org===org)?.httpSnapshot||null);}}};
  // Distinct coordinator instance, same protected Central protocol and recovery
  // binding: this models a fresh HTTP process rather than rebinding a live one.
  const coordinator=require('../../../backend/src/security/authorityCoordinator').createAuthorityCoordinator({pool:central.authorityPool,permitSecret:central.permitSecret});
  const registry=require('../../../backend/src/security/sessionRegistry').createPgSessionRegistry(central.pool,coordinator);
  const store={get(sid,callback){coordinator.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[sid]).then(result=>callback(null,result.rows[0]?.sess),callback);}};
  const service=require('../../../backend/src/organizationalProfile/editorialUiComposition').createEditorialUiComposition({...options,
    sessionRegistry:registry,sessionStore:store,authorityCoordinator:coordinator,tenantRuntimeDependencies:dependencies,
    tokenKeys:{local:randomBytes(32).toString('hex')},tokenKeyId:'local',mfaCategory:'recent-mfa',
    onFailure(error){console.error('UI_GATE_DIAGNOSTIC',error.code,error.message);}});
  const sessions=new Map();
  for(const db of databases)for(const actor of [db.maker,db.checker,db.submitter])sessions.set(actor.sid,actor.request);
  const app=express();app.use(express.json());
  const pass=(req,res,next)=>next();
  app.use('/api/organization-profile/editorial-ui',require('../../../backend/src/routes/editorialUiRoutes').createEditorialUiRouter({express,service,
    authenticate(req,res,next){const request=sessions.get(req.headers['x-synthetic-session']);if(!request)return res.status(401).json({error:{code:'SESSION_REQUIRED'}});Object.assign(req,request);next();},
    organizationMiddleware:{requireServerSession:pass,resolveOrganizationContext:pass,requireOrganizationContext:pass}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const root=`http://127.0.0.1:${server.address().port}/api/organization-profile/editorial-ui`;
  async function call(path,actor,body,method=body?'POST':'GET') {
    const response=await fetch(root+path,{method,headers:{'content-type':'application/json','x-synthetic-session':actor.sid},...(body?{body:JSON.stringify(body)}:{})});
    const value=await response.json();
    assert(!/"[^" ]*(?:digest|authors|policyRef|evidenceRefs)[^" ]*"\s*:/i.test(JSON.stringify(value)));
    process.stdout.write(`UI_HTTP ${method} ${path.replace(/[a-f0-9-]{36}/g,':id')} ${response.status}\n`);
    return {status:response.status,value};
  }
  try {
    if(process.env.CRITERIA_GATE==='1'){await require('../criteria/browser').browserEditorial({central,databases,dependencies});return;}
    if(process.env.F13_UI_BROWSER_ONLY==='1'){await require('./editorial-browser').browserEditorial({central,databases,dependencies});return;}
    const recoveries=[];
    for(const db of databases) {
      const created={draftId:randomUUID(),items:db.draft.items.map(i=>({...i,itemId:randomUUID(),itemVersionId:randomUUID()})),idempotencyKey:randomUUID()};
      let result=await call('/drafts',db.maker,created);assert.equal(result.status,201,JSON.stringify(result));
      result=await call('/drafts/'+created.draftId,db.maker);assert.equal(result.status,200,JSON.stringify(result));
      result=await call('/drafts/'+created.draftId,db.maker,{expectedRevision:1,items:created.items,idempotencyKey:randomUUID()},'PUT');assert.equal(result.status,200,JSON.stringify(result));
      result=await call('/catalog?domain=THEMATIC_AREA',db.maker);assert.equal(result.status,200,JSON.stringify(result));assert(result.value.items.length);
      result=await call('/drafts?limit=1',db.maker);assert.equal(result.status,200,JSON.stringify(result));
      const submitKey=randomUUID();
      result=await call(`/drafts/${created.draftId}/submit`,db.submitter,{expectedRevision:2,idempotencyKey:submitKey});assert.equal(result.status,201,JSON.stringify(result));
      const candidateId=result.value.candidateId;
      result=await call(`/candidates/${candidateId}`,db.maker);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.value.actions[0].reason,'AUTHOR_OR_SUBMITTER');
      result=await call(`/candidates/${candidateId}`,db.checker);assert.equal(result.status,200,JSON.stringify(result));
      const approval={concurrencyToken:result.value.actions[0].concurrencyToken,idempotencyKey:randomUUID()};assert(approval.concurrencyToken);
      result=await call(`/candidates/${candidateId}`,db.checker);assert.equal(result.status,200,JSON.stringify(result));
      const renewed={...approval,concurrencyToken:result.value.actions[0].concurrencyToken};
      if(db===databases[0]) {
        fault='F7';const failed={...approval,idempotencyKey:randomUUID()};
        const before=(await db.pool.query('SELECT count(*)::int n FROM organization_profile.editorial_version')).rows[0].n;
        const beforeEvents=(await db.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_data->>'eventCode'='PROFILE_VERSION_APPROVED'")).rows[0].n;
        const rejected=await call(`/candidates/${candidateId}/approve`,db.checker,failed);assert.equal(rejected.status,503);
        assert.equal((await db.pool.query('SELECT count(*)::int n FROM organization_profile.editorial_version')).rows[0].n,before);
        const found=(await coordinator.pool.query(require('../../../backend/src/security/authorityProtocolQueries').intentionLookupQuery,[db.org,db.checker.id,failed.idempotencyKey,'EDITORIAL_APPROVE',candidateId])).rows;
        assert.equal((await db.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_data->>'eventCode'='PROFILE_VERSION_APPROVED'")).rows[0].n,beforeEvents);
        assert.equal(found.length,1);await coordinator.recover(found[0].guard_id,true);
        const recovered=await call('/intentions/lookup',db.checker,{operation:'APPROVE',resourceId:candidateId,idempotencyKey:failed.idempotencyKey});assert.equal(recovered.value.status,'FAILED_FINAL');
        console.log('UI_F7_ROLLBACK_NO_VERSION: PASS');
      }
      result=await call(`/candidates/${candidateId}/approve`,db.checker,approval);assert.equal(result.status,201,JSON.stringify(result));
      const versionId=result.value.versionId;
      result=await call(`/candidates/${candidateId}/approve`,db.checker,renewed);assert.equal(result.status,201,JSON.stringify(result));assert.equal(result.value.versionId,versionId);
      result=await call(`/versions/${versionId}`,db.checker);assert.equal(result.status,200,JSON.stringify(result));
      const publication={concurrencyToken:result.value.actions[0].concurrencyToken,idempotencyKey:randomUUID()};
      if(db===databases[0]){fault='COMMIT';result=await call(`/versions/${versionId}/publish`,db.checker,publication);}
      else {const started=new Promise(resolve=>{reachedCommit=resolve;});commitBarrier=new Promise(resolve=>{releaseCommit=resolve;});fault='PAUSE';
        const writing=call(`/versions/${versionId}/publish`,db.checker,publication);await started;
        try {const pending=await call('/intentions/lookup',db.checker,{operation:'PUBLISH',resourceId:versionId,idempotencyKey:publication.idempotencyKey});assert.equal(pending.value.status,'RESOLVING');}
        finally {releaseCommit();} result=await writing;console.log('UI_RESOLVING_REAL_TRANSACTION: PASS');
      }assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.value.active,false);
      recoveries.push({actor:db.checker,body:{operation:'PUBLISH',resourceId:versionId,idempotencyKey:publication.idempotencyKey}});
      const other=databases.find(other=>other!==db);
      result=await call(`/versions/${versionId}`,other.maker);assert.equal(result.status,404,JSON.stringify(result));
    }
    for(const recovery of recoveries){const result=await call('/intentions/lookup',recovery.actor,recovery.body);
      assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.value.status,'CONFIRMED',JSON.stringify(result));}
    const original=recoveries[0], other=recoveries[1];
    for(const [actor,body] of [[databases[0].maker,original.body],[other.actor,original.body],
      [original.actor,{...original.body,operation:'APPROVE'}],[original.actor,{...original.body,idempotencyKey:randomUUID()}],
      [original.actor,{...original.body,resourceId:randomUUID()}]]) {
      const result=await call('/intentions/lookup',actor,body);assert.equal(result.status,200);assert.equal(result.value.status,'UNKNOWN');assert.equal(result.value.receipt,null);
    }
    const db=databases[0];
    await central.data.change({organizationId:db.org,membershipId:db.checker.membershipId,expectedVersion:2,grants:[],assuranceRequirements:central.requirement});
    assert.equal((await call('/intentions/lookup',db.checker,original.body)).status,403);
    await central.data.change({organizationId:db.org,membershipId:db.checker.membershipId,expectedVersion:3,grants:['draft.create','draft.edit','submit','approve','publish','read'].map(suffix=>({permission:'organization_profile.'+suffix,scope:{type:'ORGANIZATION',id:db.org,organizationId:db.org}})),assuranceRequirements:central.requirement});
    process.stdout.write('F13_EDITORIAL_UI_HTTP_AB: PASS\n');
    if(process.env.F13_UI_HTTP_ONLY!=='1')await require('./editorial-browser').browserEditorial({central,databases,dependencies});
  } finally {await new Promise(resolve=>server.close(resolve));await configured.poolManager.closeAll();}
}
module.exports={runEditorialUiHttpProbes};
