'use strict';
const assert=require('node:assert/strict'),{randomUUID,randomBytes,createHash}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {stageEu,seedLegacy,policyVersion,recentMfaRequirement}=require('./activation-proof.cjs');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const CENTRAL_BASELINE='035_funding_source_resolution',TENANT_BASELINE='033_organizational_opportunity_interests';
function prefix(entries,version){const index=entries.findIndex(entry=>entry.version===version);assert(index>=0);return Object.freeze(entries.slice(0,index+1));}
async function snapshot(pool,{central=false}={}){
 const tables=(await pool.query("SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY 1,2")).rows;
 const result={};
 for(const table of tables){
  const name=quote(table.nspname)+'.'+quote(table.relname),columns=(await pool.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',[table.nspname,table.relname])).rows.map(row=>quote(row.column_name));
  const filter=central&&name==='"public"."c4g_schema_migration"'?" WHERE version<='035_funding_source_resolution'":!central&&name==='"c4g_system"."schema_migration"'?' WHERE ordinal<=33':'';
  const sql=`SELECT to_jsonb(t) AS value FROM (SELECT ${columns.join(',')} FROM ${name}${filter}) t ORDER BY to_jsonb(t)::text`;
  const rows=(await pool.query(sql)).rows;result[name]={sql,count:rows.length,digest:hash(rows)};
 }
 return result;
}
async function preserved(pool,before,exclude=[]){for(const [name,item] of Object.entries(before)){if(exclude.includes(name))continue;const rows=(await pool.query(item.sql)).rows;assert.equal(rows.length,item.count,'REGISTERED_PRESERVE_COUNT:'+name);assert.equal(hash(rows),item.digest,'REGISTERED_PRESERVE_DIGEST:'+name);}}
async function roleTransaction(pool,role,work,organizationId=null){const client=await pool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE '+role);if(organizationId)await client.query("SELECT set_config('app.organization_id',$1,true)",[organizationId]);const result=await work(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
async function seedBaseline(central,tenant,identity){
 const actor={id:randomUUID(),assignmentId:randomUUID(),sessionId:'registered-package-'+randomUUID()},organizationId=randomUUID(),membershipId=randomUUID(),runId=randomUUID();
 await central.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Registered package fixture',$2,'ACTIVE')",[actor.id,actor.id+'@example.invalid']);
 await central.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[actor.assignmentId,actor.id]);
 await central.query("INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code) VALUES($1,'Registered fixture','Registered fixture',$2,'UNIVERSITY','ACTIVE','EUR','OPTIONAL')",[organizationId,'registered-'+organizationId]);
 await central.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) VALUES($1,$2,$3,'ORG_ADMIN','ACTIVE',clock_timestamp())",[membershipId,actor.id,organizationId]);
 await require('../../../backend/src/security/tenantDirectoryRepository').createTenantDirectoryRepository(central).createTenant({organizationId,tenantId:identity.tenantId,correlationId:randomUUID(),idempotencyKey:randomUUID()});
 await central.query("INSERT INTO opportunity_catalog.funding_run(run_id,request_id,requested_by,status,source_code,observed_at,collected) VALUES($1,$2,$3,'SUCCESS','EU_FUNDING_TENDERS','2026-10-30T22:45:39.461Z',true)",[runId,randomUUID(),actor.id]);
 const run=(await central.query('SELECT * FROM opportunity_catalog.funding_run WHERE run_id=$1',[runId])).rows[0],legacy=await seedLegacy(central,run);
 return {actor,organizationId,membershipId,legacy,identity};
}
async function seedTenantLinks(pool,f){return roleTransaction(pool,'c4g_opportunity_tenant_runtime',async tenant=>{
 const interestId=randomUUID(),applicationId=randomUUID(),unitId=randomUUID();
 await tenant.query("INSERT INTO organizational_scope.scope(scope_id,organization_id,scope_type,label,lifecycle,provenance,created_by_actor_type,created_by_actor_id,updated_by_actor_type,updated_by_actor_id) VALUES($1,$2,'UNIT','Preserved fixture unit','ACTIVE','{}','HUMAN',$3,'HUMAN',$3)",[unitId,f.organizationId,f.actor.id]);
 await tenant.query("INSERT INTO opportunity_catalog.opportunity_interest(organization_id,interest_id,central_opportunity_id,central_revision_id,central_snapshot,title,created_by,created_membership_id) VALUES($1,$2,$3,$4,$5,'Preserved fixture interest',$6,$7)",[f.organizationId,interestId,f.legacy.opportunityId,f.legacy.revisionId,f.legacy.snapshot,f.actor.id,f.membershipId]);
 await tenant.query("INSERT INTO opportunity_catalog.interest_change(organization_id,interest_id,revision,kind,title,status,actor_subject_id,actor_membership_id) VALUES($1,$2,1,'REGISTER','Preserved fixture interest','ACTIVE',$3,$4)",[f.organizationId,interestId,f.actor.id,f.membershipId]);
 await tenant.query('INSERT INTO opportunity_catalog.interest_unit(organization_id,interest_id,scope_id) VALUES($1,$2,$3)',[f.organizationId,interestId,unitId]);
 await tenant.query("INSERT INTO opportunity_catalog.application(organization_id,application_id,opportunity_id,evaluation_id,title,responsible_membership_id,deadline,status,created_by,central_opportunity_id,central_revision_id,central_snapshot,source_interest_id,source_interest_revision) VALUES($1,$2,NULL,NULL,'Preserved fixture application',$3,'2028-09-02','IDENTIFIED',$4,$5,$6,$7,$8,1)",[f.organizationId,applicationId,f.membershipId,f.actor.id,f.legacy.opportunityId,f.legacy.revisionId,f.legacy.snapshot,interestId]);
 await tenant.query('INSERT INTO opportunity_catalog.application_unit(organization_id,application_id,scope_id) VALUES($1,$2,$3)',[f.organizationId,applicationId,unitId]);
 return {interestId,applicationId,unitId};
},f.organizationId);}
async function createNormalSessionRuntime(central,connection,actor,report){
 const password=randomBytes(32).toString('hex');
 await central.query(`ALTER ROLE c4g_authority_runtime PASSWORD '${password}'`);
 await central.query('GRANT CONNECT ON DATABASE registered_central TO c4g_authority_runtime');
 const authorityPool=new Pool({...connection,database:'registered_central',user:'c4g_authority_runtime',password});
 let server,store;
 try{
 const coordinator=require('../../../backend/src/security/authorityCoordinator').createAuthorityCoordinator({pool:authorityPool,permitSecret:randomBytes(48).toString('hex')});
 const registry=require('../../../backend/src/security/sessionRegistry').createPgSessionRegistry(central,coordinator);
 const express=require('../../../backend/node_modules/express'),session=require('../../../backend/node_modules/express-session'),PgStore=require('../../../backend/node_modules/connect-pg-simple')(session);
 const app=express();server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
 const base='http://127.0.0.1:'+server.address().port,secret=randomBytes(48).toString('hex'),cookieName='registered-package-session';
 store=new PgStore({pool:coordinator.pool,schemaName:'public',tableName:'application_session_store',createTableIfMissing:false,pruneSessionInterval:false});
 const {createSessionSecurity,csrfTokenForSession}=require('../../../backend/src/security/sessionSecurity');
 const security=createSessionSecurity({config:{sessionCookieName:cookieName,sessionSecret:secret,secureCookie:false,sessionIdleMs:1800000,nodeEnv:'test',publicOrigin:new URL(base),allowedDevelopmentOrigins:[]},pool:coordinator.pool,sessionStore:store,authorityCoordinator:coordinator});
 const authentication=require('../../../backend/src/middlewares/authMiddleware');authentication.configureAuthentication({mode:'oidc',policyVersion,sessionRegistry:registry});
 const organization=require('../../../backend/src/middlewares/organizationContext').createOrganizationContextMiddleware({organizationSession:null});
 app.use(express.json({limit:'1mb'}),security.sessionMiddleware);
 const runtime=require('../../../backend/src/opportunities/v2/activationHttp').createOpportunityActivationHttpRuntime({express,pool:central,policyVersion,recentMfaRequirement,authenticate:authentication.authenticate,requireServerSession:organization.requireServerSession,originProtection:security.originProtection,csrfProtection:security.csrfProtection});
 app.use('/api/admin/opportunity-activation',runtime.router);
 app.use((error,_req,res,_next)=>{report.lastHttpError={code:error.code||'HTTP_ERROR'};res.status(error.statusCode||error.status||500).json({code:error.code||'HTTP_ERROR'});});
 const call=(method,...args)=>new Promise((resolve,reject)=>store[method](...args,(error,value)=>error?reject(error):resolve(value)));
 const now=Date.now();actor.session={cookie:{expires:new Date(now+1800000).toISOString(),originalMaxAge:1800000,httpOnly:true,path:'/',sameSite:'lax'},auth:{user:{id:actor.id},identity:{issuer:'https://registered.example.invalid',subject:actor.id},policyVersion,revocationVersion:1,absoluteExpiresAt:now+3600000,evidence:{authTime:Math.floor(now/1000),acr:'c4g-loa1',amr:['pwd'],policyVersion}}};
  await registry.rotateSession({sid:actor.sessionId,globalUserId:actor.id,revocationVersion:1,expiresAt:actor.session.auth.absoluteExpiresAt});
  await call('set',actor.sessionId,actor.session);
 return {coordinator,registry,authorityPool,store,call,async request(method,url,body){
  const signature=require('../../../backend/node_modules/cookie-signature'),headers={cookie:cookieName+'='+encodeURIComponent('s:'+signature.sign(actor.sessionId,secret))};
  if(method!=='GET'){headers.origin=base;headers['x-csrf-token']=csrfTokenForSession({sessionID:actor.sessionId},secret);headers['content-type']='application/json';}
  const response=await fetch(base+'/api/admin/opportunity-activation'+url,{method,headers,signal:AbortSignal.timeout(30000),...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()};
 },async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close?.();await authorityPool.end();}};
 }catch(error){if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store?.close?.();await authorityPool.end();throw error;}
}
async function registeredPackageProof({central,tenant,connection,report,check}){
 // Package selection is closed by the registered production runner. The only
 // explicit manifest prefix below bootstraps the historical baseline.
 const cm=require('../../../backend/src/security/centralMigrationManifest'),tm=require('../../../backend/src/security/tenantMigrationManifest');
 const migration=require('../../../backend/scripts/runCentralMigrations');
 const identity={tenantId:randomUUID(),databaseGenerationId:randomUUID()};let fixture,http,reader,tenantReader;
 try{
  await check('REGISTERED_BOOTSTRAP_EXACT_CENTRAL035_TENANT033',async()=>{
   await central.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
   await migration.applyCentralMigrationsWithManifest(central,prefix(cm.manifest,CENTRAL_BASELINE),cm.migrationSql);
   fixture=await seedBaseline(central,tenant,identity);
   const publisher=require('../../../backend/src/security/tenantSchemaObservationPublisher').createTenantSchemaObservationPublisher(require('../../../backend/src/security/tenantSchemaRepository').createTenantSchemaRepository(central));
   const baseline=await require('../../../backend/src/security/tenantMigrationRunner').createTenantMigrationRunner({pool:tenant,entries:prefix(tm.manifest,TENANT_BASELINE),loadMigration:tm.migrationSql,observationPublisher:publisher,timeoutMs:30000,scheduler:{setTimeout,clearTimeout}}).migrate({...identity,expectedRevision:1,correlationId:randomUUID(),idempotencyKey:randomUUID()});
   assert.equal(baseline.evidence.currentVersion,TENANT_BASELINE);fixture.links=await seedTenantLinks(tenant,fixture);
   report.baseline={central:await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(central),tenant:baseline.evidence};
   assert.equal(report.baseline.central.currentVersion,CENTRAL_BASELINE);
  });
  await check('REGISTERED_BASELINE_NORMAL_AUTHORITY_AND_COORDINATED_SESSION',async()=>{
   http=await createNormalSessionRuntime(central,connection,fixture.actor,report);
   const login=(await http.authorityPool.query('SELECT session_user,current_user')).rows[0];assert.deepEqual(login,{session_user:'c4g_authority_runtime',current_user:'c4g_authority_runtime'});
   assert.equal(await http.registry.validateSession({sid:fixture.actor.sessionId,globalUserId:fixture.actor.id,revocationVersion:1,now:Date.now()}),true);
   assert.equal((await http.request('GET','/sources/eu')).status,503);
   report.normalAuthority={physicalAuthorityLogin:true,coordinatorAdmission:true,coordinatedSessionStore:true,touchEnabled:true,fixturePermitBypass:false};
  });
  await check('REGISTERED_MAINTENANCE_PENDING_WORK_REAL_CENTRAL_AND_TENANT',async()=>{
   const {pendingWork,isQuiescentWork}=require('../../../backend/scripts/localPlatform/backupOpportunityV2');
   assert.equal((await tenant.query("SELECT to_regclass('async_exec.execution') AS execution")).rows[0].execution,null);
   assert.equal(isQuiescentWork(await pendingWork(tenant,'tenant'),'tenant'),true);
   const repository=require('../../../backend/src/fundingTenders/repository').createFundingRepository({pool:central});
   const job=await repository.enqueue(fixture.actor.id,randomUUID(),'CORDIS'),run=await repository.claim(job.runId);
   await repository.stage(run,{records:[],received:0,failed:0,limited:false,observedAt:new Date().toISOString()});await repository.finish(run);
   const outbox=new(require('../../../backend/src/async/outboxRepository').OutboxRepository)(),projection=require('../../../backend/src/async/executionLineageProjection').createExecutionLineageProjection({transaction:repository.transaction});let published;
   await repository.transaction(async client=>{const rows=await outbox.claim(client,{owner:'registered-projection-fixture'});assert.equal(rows.length,1);published=rows[0];await projection.project({row:published,envelope:published.envelope,client});assert.equal(await outbox.markPublished(client,{id:published.outbox_id,owner:published.claim_owner,fence:published.fence,queueId:randomUUID()}),true);});
   const settled=await pendingWork(central,'central');assert.equal(isQuiescentWork(settled,'central'),true);
   async function temporary(sql,values,verify){const client=await central.connect();try{await client.query('BEGIN');await client.query(sql,values);await verify(await pendingWork(client,'central'));}finally{await client.query('ROLLBACK');client.release();}}
   await temporary("UPDATE opportunity_catalog.funding_run SET status='QUEUED',finished_at=NULL WHERE run_id=$1",[job.runId],counts=>{assert(counts.funding>0);assert(counts.execution>0);assert(counts.published>0);assert.equal(isQuiescentWork(counts,'central'),false);});
   await temporary("UPDATE async_exec.execution SET state='RUNNING',claim_owner='registered-fixture',lease_until=clock_timestamp()+interval '30 seconds' WHERE execution_id=$1",[job.runId],counts=>{assert(counts.execution>0);});
   await temporary("INSERT INTO async_exec.execution(execution_id,organization_id,job_type,state,attempt,deadline_at,lineage_version,delivery_kind,root_execution_id,previous_execution_id,content_digest,envelope_digest,replay_request_id) VALUES($1,NULL,'funding_tenders.refresh','QUEUED',1,clock_timestamp()+interval '1 minute',1,'INITIAL',$1,NULL,$2,$3,NULL)",[randomUUID(),'d'.repeat(64),'e'.repeat(64)],counts=>{assert(counts.execution>0);});
   // A structurally valid delivery for an unknown run is deliberately published
   // without a completion; an unrelated ended run cannot authorize maintenance.
   const other=await repository.enqueue(fixture.actor.id,randomUUID(),'ERASMUS'),otherRun=await repository.claim(other.runId);await repository.finish(otherRun,'SOURCE_UNAVAILABLE');
   const client=await central.connect();try{await client.query('BEGIN');
    const row=(await client.query("SELECT * FROM async_exec.outbox WHERE envelope->>'executionId'=$1",[other.runId])).rows[0];
    // No immutable envelope is changed: an unpublished outbox is already an
    // operational blocker. A legacy published envelope is a distinct fixture.
    assert((await pendingWork(client,'central')).outbox>0);
    const unknown={...row.envelope,executionId:randomUUID(),idempotencyKey:randomUUID(),payload:{runId:randomUUID()}};
    const validated=require('../../../backend/src/async/envelope').validateEnvelope(unknown,{supports:()=>true});
    await client.query("INSERT INTO async_exec.outbox(outbox_id,organization_id,logical_id,envelope,digest_sha256,state,available_at,queue_id,published_at,lineage_version,delivery_kind,attempt,root_execution_id,previous_execution_id,content_digest,envelope_digest,replay_request_id) VALUES($1,NULL,$2,$3,$4::text,'PUBLISHED',clock_timestamp(),$5,clock_timestamp(),1,'INITIAL',1,$6,NULL,$4::text,$7,NULL)",[randomUUID(),'unknown:'+randomUUID(),validated.envelope,validated.contentDigest,randomUUID(),unknown.executionId,validated.envelopeDigest]);
    const counts=await pendingWork(client,'central');assert(counts.published>0);assert.equal(isQuiescentWork(counts,'central'),false);
   }finally{await client.query('ROLLBACK');client.release();}
   // Complete the second fixture's transport metadata through the same durable
   // projection ports; no real queue transport is claimed by this check.
   await repository.transaction(async client=>{const rows=await outbox.claim(client,{owner:'registered-projection-fixture'});assert.equal(rows.length,1);const row=rows[0];await projection.project({row,envelope:row.envelope,client});assert.equal(await outbox.markPublished(client,{id:row.outbox_id,owner:row.claim_owner,fence:row.fence,queueId:randomUUID()}),true);});
   assert.equal(isQuiescentWork(await pendingWork(central,'central'),'central'),true);
   report.maintenanceWork={realPostgres:true,tenantWithoutExecution:true,terminalFundingHistoricalProjectionIgnored:true,activeOrOrphanExecutionBlocked:true,unknownPublishedBlocked:true,transportFixturesOnly:true};
  });
  const before={central:await snapshot(central,{central:true}),tenant:await snapshot(tenant)};
  report.preservation={centralTables:Object.keys(before.central).length,tenantTables:Object.keys(before.tenant).length,centralDigest:hash(before.central),tenantDigest:hash(before.tenant)};
  await require('./registered-package-migration.cjs').migrateAndVerify({central,tenant,identity,report,check,before,preserved});
  await check('REGISTERED_NORMAL_AUTHORITY_HTTP_PREVIEW_APPROVAL_AND_PAUSE',async()=>{
   const admissionClient=await http.authorityPool.connect();
   try{const admission=await require('../../../backend/src/security/authoritySecurityManifest').assertAuthorityAdmission(admissionClient);assert.equal(admission.currentVersion,report.package.centralTarget);}finally{admissionClient.release();}
   const archived=await stageEu(central,fixture.actor),expected={opportunityId:fixture.legacy.opportunityId,revisionId:fixture.legacy.revisionId,rowVersion:1};
   const prepared=await http.request('POST','/plans',{requestId:randomUUID(),archive:{kind:'FUNDING',runId:archived.runId,externalIdentifier:'CASCADE:11145'},expected});assert.equal(prepared.status,201);
   const detail=await http.request('GET','/plans/'+prepared.data.planId);assert.equal(detail.status,200);assert.deepEqual(detail.data.candidate.snapshot,archived.snapshot);assert.deepEqual(detail.data.accepted.snapshot,fixture.legacy.snapshot);
   const money=detail.data.candidate.snapshot.financing.allocations.value[0].money;assert.equal(money.amount,'120000');assert.equal(money.currency.state,'NOT_FOUND');assert.equal(detail.data.candidate.snapshot.schedule.deadlines.value.length,7);
   const approved=await http.request('POST','/plans/'+prepared.data.planId+'/approve',{requestId:randomUUID(),planDigest:prepared.data.planDigest});assert.equal(approved.status,200);
   const paused=await http.request('POST','/sources/eu/suspend',{requestId:randomUUID(),expectedFence:1});assert.equal(paused.status,200);
   const quiet=await http.request('POST','/sources/eu/quiesce',{requestId:randomUUID(),expectedFence:2});assert.equal(quiet.status,200);
   const resumed=await http.request('POST','/sources/eu/resume',{requestId:randomUUID(),expectedFence:3});assert.equal(resumed.status,200);
   report.preview={amount:money.amount,currencyState:money.currency.state,cutoffs:7,approved:true,accepted:false,sourceResumed:true,sourceFence:resumed.data.fence};
  });
  await check('REGISTERED_REAL_READERS_AND_FROZEN_TENANT_LINKS',async()=>{
   report.readerPrivileges={readableTables:(await central.query("SELECT n.nspname||'.'||c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') AND has_any_column_privilege('c4g_catalog_reader',c.oid,'SELECT') ORDER BY 1")).rows.map(row=>row.name),executableDefiners:(await central.query("SELECT n.nspname||'.'||p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND p.prosecdef AND has_function_privilege('c4g_catalog_reader',p.oid,'EXECUTE') ORDER BY 1")).rows.map(row=>row.name)};
   assert.equal(report.readerPrivileges.executableDefiners.length,0);
   const password=randomBytes(32).toString('hex');await central.query(`CREATE ROLE registered_catalog_reader LOGIN PASSWORD '${password}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
   await central.query('GRANT c4g_catalog_reader TO registered_catalog_reader WITH INHERIT FALSE, SET TRUE');await central.query('GRANT CONNECT ON DATABASE registered_central TO registered_catalog_reader');
   const url=new URL('postgresql://127.0.0.1');url.port=String(connection.port);url.username='registered_catalog_reader';url.password=password;url.pathname='/registered_central';
   reader=require('../../../backend/src/fundingTenders/catalogReader').createCatalogReader({env:{CATALOG_DATABASE_URL:url.toString()}});await reader.ready();
   assert.deepEqual(await reader.revision(fixture.legacy.opportunityId,fixture.legacy.revisionId),fixture.legacy.snapshot);const detail=await reader.get(fixture.legacy.opportunityId);assert.equal(detail.revisionId,fixture.legacy.revisionId);
   const apiPassword=randomBytes(32).toString('hex'),workerPassword=randomBytes(32).toString('hex');
   const provisioner=await require('../../../backend/src/security/localTenantIdentityProvisioner').createLocalTenantIdentityProvisioner(tenant);
   await provisioner.reconcile({apiLogin:'registered_tenant_api',workerLogin:'registered_tenant_worker',apiPassword,workerPassword,apiRoles:['c4g_opportunity_tenant_runtime'],workerRoles:['c4g_import_worker_runtime']});
   await tenant.query('GRANT CONNECT ON DATABASE registered_tenant TO registered_tenant_api,registered_tenant_worker');
   tenantReader=new Pool({...connection,database:'registered_tenant',user:'registered_tenant_api',password:apiPassword});
   await roleTransaction(tenantReader,'c4g_opportunity_tenant_runtime',async client=>{
    const app=(await client.query('SELECT central_snapshot,central_revision_id,source_interest_id FROM opportunity_catalog.application WHERE application_id=$1',[fixture.links.applicationId])).rows[0];assert.deepEqual(app.central_snapshot,fixture.legacy.snapshot);assert.equal(app.central_revision_id,fixture.legacy.revisionId);assert.equal(app.source_interest_id,fixture.links.interestId);
    const interest=(await client.query('SELECT central_snapshot FROM opportunity_catalog.opportunity_interest WHERE interest_id=$1',[fixture.links.interestId])).rows[0];assert.deepEqual(interest.central_snapshot,fixture.legacy.snapshot);
   },fixture.organizationId);
   const hidden=await roleTransaction(tenantReader,'c4g_opportunity_tenant_runtime',client=>client.query('SELECT application_id FROM opportunity_catalog.application WHERE application_id=$1',[fixture.links.applicationId]),randomUUID());assert.equal(hidden.rows.length,0);
   const client=await tenantReader.connect();let evidence;try{await client.query('BEGIN READ ONLY');evidence=await require('../../../backend/src/security/tenantRuntimeMetadata').observeTenantRuntimeMetadata(client,identity);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}assert.equal(evidence.currentVersion,report.package.tenantTarget);
   report.readers={catalogLogin:true,tenantApiLogin:true,legacyRevisionPreserved:true,tenantLinksPreserved:true,tenantRls:true,tenantMetadataVersion:evidence.currentVersion};
  });
  await check('REGISTERED_SESSION_TOUCH_ROTATION_AND_REVOCATION_NO_BYPASS',async()=>{
   const sid=fixture.actor.sessionId,before=(await central.query('SELECT sess,expire::text FROM public.application_session_store WHERE sid=$1',[sid])).rows[0];
   const epoch=()=>central.query('SELECT epoch::text FROM public.authority_scope_epoch WHERE scope_key=$1',[http.coordinator.sessionKey(sid)]).then(result=>result.rows[0].epoch);
   const priorEpoch=await epoch();await http.call('touch',sid,await http.call('get',sid));assert.equal(await epoch(),priorEpoch);
   const after=(await central.query('SELECT sess,expire::text FROM public.application_session_store WHERE sid=$1',[sid])).rows[0];assert.deepEqual(after.sess.auth,before.sess.auth);assert.equal(after.expire,before.expire);
   const nextSid='registered-package-'+randomUUID();await http.registry.rotateSession({previousSid:sid,sid:nextSid,globalUserId:fixture.actor.id,revocationVersion:1,expiresAt:fixture.actor.session.auth.absoluteExpiresAt});
   await http.call('set',nextSid,fixture.actor.session);assert.equal((await http.request('GET','/plans')).status,401);fixture.actor.sessionId=nextSid;assert.equal((await http.request('GET','/plans')).status,200);
   await http.registry.revokeSession(nextSid,'REGISTERED_GATE_REVOCATION');assert.equal((await http.request('GET','/plans')).status,401);
   for(const value of [sid,nextSid]){await http.call('destroy',value);assert.equal((await central.query('SELECT sid FROM public.application_session_store WHERE sid=$1',[value])).rows.length,0);}
   const requests=(await central.query("SELECT count(*)::int AS n FROM public.authority_write_request WHERE state='APPLIED'")).rows[0].n;assert(requests>=3);report.normalAuthority.appliedWrites=requests;
  });
  await check('REGISTERED_FINAL_PREFLIGHT_AND_AUDIT_CHAIN',async()=>{
   const ready=await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(central),tenantReady=await require('../../../backend/src/security/tenantMigrationPreflight').preflightTenant(tenant,identity,undefined,{timeoutMs:30000});
   assert.equal(ready.currentVersion,report.package.centralTarget);assert.equal(tenantReady.currentVersion,report.package.tenantTarget);await preserved(tenant,before.tenant);
   const events=(await central.query("SELECT event_data,event_hash FROM audit.event WHERE organization_id IS NULL AND stream_id='PLATFORM:DATA' ORDER BY sequence")).rows.map(row=>({...row.event_data,eventHash:row.event_hash}));assert(events.length>=5);assert.equal(require('../../../backend/src/audit/verifier').verifyEvents(events).valid,true);
   assert(!JSON.stringify(events).includes(fixture.actor.sessionId));assert(!JSON.stringify(events).includes('@example.invalid'));
   report.final={centralVersion:ready.currentVersion,centralFingerprint:ready.fingerprint,tenantVersion:tenantReady.currentVersion,tenantFingerprint:tenantReady.schemaFingerprint,auditEvents:events.length,auditChainValid:true,accepted:false};
  });
 }finally{await reader?.close();await tenantReader?.end();await http?.close();}
}
module.exports={registeredPackageProof,prefix,snapshot,preserved};
