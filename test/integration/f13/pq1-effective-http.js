'use strict';
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const express=require('../../../backend/node_modules/express');
async function run({databases,central,admin,url,options}){
  // Independent HTTP phase starts with fresh synthetic authentication. Do not
  // lengthen the approved 300-second MFA window to accommodate gate duration.
  for(const db of databases)for(const actor of [db.maker,db.checker,db.submitter]){
    const stored=(await central.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[actor.sid])).rows[0].sess;
    const sid=actor.sid;stored.auth.evidence.authTime=Math.floor(Date.now()/1000);
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
  const verifierModule=require('../../../backend/src/security/tenantBindingVerifier'),originalVerifier=verifierModule.createTenantBindingVerifier;
  verifierModule.createTenantBindingVerifier=adapter=>originalVerifier({async observe(input){try{return await adapter.observe(input);}catch(e){console.error('PQ1_BINDING_DIAGNOSTIC',e.internalCode||e.code||'REFUSAL',e.message);throw e;}}});
  const configured=require('../../../backend/src/config/opportunityRuntime').createConfiguredOpportunityRuntime({centralPool:central.pool,
    authorityCoordinator:central.coordinator,editorialEnabled:true,env:{OPPORTUNITY_API_CREDENTIALS_JSON:JSON.stringify(credentials),
      OPPORTUNITY_ALLOWED_RESIDENCY_JSON:JSON.stringify([{regionCode:'SYNTHETIC',policyVersion:'synthetic-v1'}])}});
  let fault=null, reachedCommit=null, releaseCommit=null, commitBarrier=null;
  const observedManager={...configured.poolManager,async acquire(request){const allocation=await configured.poolManager.acquire(request);const client=allocation.client;let lost=false,paused=false;return {...allocation,client:{
    on:(...args)=>client.on(...args),removeListener:(...args)=>client.removeListener(...args),
    async query(sql,values){
      if(sql.includes('audit.append_event_v1')&&((values?.[2]==='PROFILE_VERSION_APPROVED'&&fault==='F7')||(values?.[2]==='PROFILE_VERSION_PUBLISHED'&&fault==='F7_PUBLISH')||(values?.[2]==='ASSERTION_REVOKED'&&fault==='F7_REVOKE')||(values?.[2]==='PROFILE_DRAFT_REVISION_CREATED'&&fault==='F7_EXPERIENCE'))){fault=null;throw new Error('SYNTHETIC_F7_FAILURE');}
      if(sql.includes('audit.append_event_v1')&&values?.[2]==='PROFILE_COHORT_ACTIVATED'&&fault==='COMMIT'){fault=null;lost=true;}
      if(sql.includes('audit.append_event_v1')&&fault==='PAUSE:'+values?.[2]){fault=null;paused=true;}
      if(sql==='COMMIT'&&paused){paused=false;reachedCommit();await commitBarrier;}
      let result;try{result=await client.query(sql,values);}catch(e){console.error('PQ1_SQL_DIAGNOSTIC',e.code,e.message);throw e;}if(sql==='COMMIT'&&lost){lost=false;throw new Error('SYNTHETIC_COMMIT_ACK_LOST');}return result;
    }}};}};
  const dependencies={...configured,poolManager:observedManager,directoryRepository:{async resolveSnapshotByOrganization(org){return structuredClone(databases.find(db=>db.org===org)?.httpSnapshot||null);}}};
  // Distinct coordinator instance, same protected Central protocol and recovery
  // binding: this models a fresh HTTP process rather than rebinding a live one.
  const coordinator=require('../../../backend/src/security/authorityCoordinator').createAuthorityCoordinator({pool:central.authorityPool,permitSecret:central.permitSecret});
  const registry=require('../../../backend/src/security/sessionRegistry').createPgSessionRegistry(central.pool,coordinator);
  const store={get(sid,callback){coordinator.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[sid]).then(result=>callback(null,result.rows[0]?.sess),callback);}};
  const service=require('../../../backend/src/prequalification/composition').createPrequalificationComposition({...options,requirePreview:true,
    sessionRegistry:registry,sessionStore:store,authorityCoordinator:coordinator,tenantRuntimeDependencies:dependencies,
    onFailure:e=>console.error('PQ1_HTTP_DIAGNOSTIC',e.code,e.internalCode,e.message),tokenKeys:{local:randomBytes(32).toString('hex')},tokenKeyId:'local',mfaCategory:'recent-mfa'});
  const sessions=new Map();for(const db of databases)for(const actor of [db.maker,db.checker,db.submitter])sessions.set(actor.sid,actor.request);
  const pass=(req,res,next)=>next(),middleware={requireServerSession:pass,resolveOrganizationContext:pass,requireOrganizationContext:pass};
  function authenticate(req,res,next){const request=sessions.get(req.headers['x-synthetic-session']);if(!request)return res.status(401).json({error:{code:'SESSION_REQUIRED'}});Object.assign(req,request);next();}
  const app=express();app.use(express.json());const router=require('../../../backend/src/routes/pq1ActivationRoutes').createPq1ActivationRouter;
  app.use('/api/organizational-profile/pq1-activation',router({express,service,authenticate,organizationMiddleware:middleware}));
  app.use('/api/opportunities',router({express,service,authenticate,organizationMiddleware:middleware,consumer:true}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  const root='/api/organizational-profile/pq1-activation';
  async function call(path,actor,body){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-synthetic-session':actor.sid},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,value:await response.json(),cache:response.headers.get('cache-control')};}
  const ok=async(path,actor,body)=>{console.log('PQ1_HTTP_REQUEST',path.replace(/[a-f0-9-]{36}/g,':id'));const r=await call(path,actor,body);assert(r.status<300,JSON.stringify(r));assert.equal(r.cache,'no-store');assert(!JSON.stringify(r.value).match(/"[^" ]*digest"/i));return r.value;};
  try{
   const [a,b]=databases;
   const c=await ok(root+'/context',a.checker);assert(c.items.some(p=>p.versionId===a.versionId));
   const beforePreview=Number((await a.pool.query('SELECT count(*)::int AS n FROM organization_profile.pq1_effective_snapshot')).rows[0].n);
   const p=await ok(root+'/preview',a.checker,{versionId:a.versionId});assert.equal(p.readiness,'READY');assert.equal(p.capability.allowed,true,JSON.stringify(p.capability));
   assert.equal(Number((await a.pool.query('SELECT count(*)::int AS n FROM organization_profile.pq1_effective_snapshot')).rows[0].n),beforePreview);
   assert.equal((await call(root+'/preview',b.checker,{versionId:a.versionId})).status,404);
   const command={versionId:a.versionId,previewToken:p.concurrencyToken,expectedActivationId:p.expectedActivationId,expectedGeneration:p.expectedGeneration,reason:'HTTP fixture',idempotencyKey:randomUUID()};
   assert.equal((await call(root+'/activate',a.submitter,command)).status,409);
   const activated=await ok(root+'/activate',a.checker,command);assert.equal(activated.generation,p.expectedGeneration+1);
   assert.deepEqual(await ok(root+'/activate',a.checker,command),activated);
   assert.equal((await call(root+'/activate',a.checker,{...command,idempotencyKey:randomUUID()})).status,409);
   const snapshot=await ok(root+'/snapshots/'+activated.snapshotId,a.checker);assert.equal(snapshot.isActive,true);
   assert.equal((await call(root+'/snapshots/'+activated.snapshotId,b.checker)).status,404);
   const recovered=await ok(root+'/intentions/lookup',a.checker,{operation:'PQ1_ACTIVATE',resourceId:a.org,idempotencyKey:command.idempotencyKey});assert.equal(recovered.status,'CONFIRMED');assert.deepEqual(recovered.receipt,activated);
   assert.equal((await ok(root+'/intentions/lookup',a.submitter,{operation:'PQ1_ACTIVATE',resourceId:a.org,idempotencyKey:command.idempotencyKey})).status,'UNKNOWN');
   assert.equal((await ok(root+'/intentions/lookup',b.checker,{operation:'PQ1_ACTIVATE',resourceId:a.org,idempotencyKey:command.idempotencyKey})).status,'UNKNOWN');
   const cr=(await a.pool.query('SELECT r.revision_id,r.opportunity_revision_id,s.opportunity_id FROM opportunity_catalog.criteria_revision r JOIN opportunity_catalog.criteria_set s USING(organization_id,set_id) LIMIT 1')).rows[0];
   a.testOpportunityId=cr.opportunity_id;
   const ev={opportunityRevisionId:cr.opportunity_revision_id,criteriaRevisionId:cr.revision_id,activationId:activated.activationId,generation:activated.generation,idempotencyKey:randomUUID()};
   const result=await ok('/api/opportunities/'+cr.opportunity_id+'/prequalifications',a.checker,ev);
   const detail=await ok('/api/opportunities/prequalifications/'+result.evaluationId,a.checker);assert.equal(detail.freshness,'CURRENT');assert.equal(detail.result.globalResult,'INDETERMINATE');
   assert.equal((await call('/api/opportunities/prequalifications/'+result.evaluationId,b.checker)).status,404);
   assert.equal((await ok(root+'/intentions/lookup',a.checker,{operation:'PQ1_EVALUATE',resourceId:cr.opportunity_id,idempotencyKey:ev.idempotencyKey})).status,'CONFIRMED');
   console.log('PQ1_HTTP_AB_PREVIEW_ACTIVATE_EVALUATE_READ_LOOKUP PASS');
   await require('./pq1-effective-browser').run({central,databases,dependencies,control:{setFault:value=>{fault=value;}}});
  }finally{await new Promise(r=>server.close(r));await configured.poolManager.closeAll();}
}
module.exports={run};
