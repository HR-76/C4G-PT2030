'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('../../../backend/node_modules/pg');
async function verify({central,admin,reader,http,p,select,a,b,ar,br,aCredentials,bCredentials,call,report}){
 const ownerUrl=new URL(process.env.F13_S2_ADMIN_URL);ownerUrl.pathname='/'+aCredentials.database;const pool=new Pool({connectionString:ownerUrl.toString()});
 try{
  const identityFactory=require('../../../backend/src/opportunities/identity').createIdentityFactory();
  const repository=new(require('../../../backend/src/opportunities/tenantRepository').TenantOpportunityRepository)({pool,organizationId:a.organizationId,identityFactory});
  const data=title=>({schemaVersion:1,requestId:randomUUID(),snapshot:{schemaVersion:1,title,funderName:'Isolated funder',provenanceId:randomUUID(),lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1',summary:'Isolated integration data',fundingAmountMin:'0',fundingAmountMax:'100',currencyCode:'EUR'},provenance:{schemaVersion:1,sourceType:'ORGANIZATION_MANUAL',sourceNamespace:'ISOLATED_ONBOARDING',observedAt:new Date().toISOString()}});
  const opportunity=await repository.create(data('Oportunidade privada A'),{actor:{type:'HUMAN',reference:ar.globalUserId}});
  await select(a.organizationId);
  const created=await http(p,'/api/applications','POST',{opportunityId:opportunity.opportunityId,evaluationId:null,title:'Candidatura preservada A',responsibleMembershipId:ar.membershipId,deadline:'2027-12-31',idempotencyKey:randomUUID()});assert.equal(created.status,201,JSON.stringify(created.data));
  const applicationId=created.data.applicationId,work=await http(p,'/api/applications/'+applicationId+'/work');assert.equal(work.status,200);
  const task=await http(p,'/api/applications/'+applicationId+'/work/tasks','POST',{title:'Tarefa preservada',responsibleMembershipId:ar.membershipId,deadline:'2027-11-30',expectedRevision:work.data.revision,idempotencyKey:randomUUID()});assert.equal(task.status,200,JSON.stringify(task.data));
  const preserved=(await pool.query('SELECT to_jsonb(t) row FROM opportunity_catalog.application_task t ORDER BY task_id')).rows;
  const applicationBefore=await http(p,'/api/applications/'+applicationId);assert.equal(applicationBefore.status,200);
  // Seed a synthetic source record through the actual catalog import repository;
  // no external collection is started, and the usual databases are not involved.
  const funding=require('../../../backend/src/fundingTenders/repository').createFundingRepository({pool:central.pool});
  const actor=(await central.pool.query("SELECT global_user_id FROM public.platform_admin_assignment WHERE status='ACTIVE'")).rows[0].global_user_id;
  const queued=await funding.enqueue(actor,randomUUID()),run=await funding.claim(queued.runId);
  await funding.stage(run,{records:[{externalIdentifier:'ISOLATED-ONBOARDING-CATALOG',fields:{title:'Oportunidade central partilhada',funderName:'Isolated funder',programmeName:'Isolated programme',callReference:'ISOLATED-ONBOARDING-CATALOG',summary:'Synthetic integration record'}}],observedAt:new Date().toISOString(),received:1,failed:0,limited:false});
  for(const item of await funding.pending(run))await funding.apply(run,item);
  await funding.finish(run);const catalogItem=(await funding.list()).items[0];assert(catalogItem);
  const catalogA=await http(p,'/api/central-opportunities');assert.equal(catalogA.status,200,JSON.stringify(catalogA.data));
  await select(b.organizationId);
  assert.equal((await http(p,'/api/applications/'+applicationId)).status,404);
  assert.equal((await http(p,'/api/opportunities/'+opportunity.opportunityId)).status,404);
  const catalogB=await http(p,'/api/central-opportunities');assert.equal(catalogB.status,200);assert.deepEqual(catalogA.data.items,catalogB.data.items);assert(catalogB.data.items.some(i=>(i.opportunityId||i.id)===catalogItem.opportunityId));
  // Reconcile an already used tenant: migration/projection retry must preserve
  // the application, its history and the task created through the normal API.
  await call('tenant',ar);await call('projection',ar);
  assert.deepEqual((await pool.query('SELECT to_jsonb(t) row FROM opportunity_catalog.application_task t ORDER BY task_id')).rows,preserved);
  await select(a.organizationId);assert.deepEqual((await http(p,'/api/applications/'+applicationId)).data,applicationBefore.data);await select(b.organizationId);
  for(const [record,own,other] of [[ar,aCredentials,bCredentials],[br,bCredentials,aCredentials]]){
   for(const workload of ['API','WORKER']){
    const m=workload==='API'?own:await call('workerCredentials',record);
    const connection={host:m.host,port:m.port,user:m.login,password:m.password,database:m.database};
    const correct=new Pool(connection),foreign=new Pool({...connection,database:other.database});
    try{assert.equal((await correct.query('SELECT current_database() name')).rows[0].name,own.database);await assert.rejects(()=>foreign.query('SELECT 1'),e=>e.code==='42501');}finally{await correct.end();await foreign.end();}
   }
  }
  const rights=(await reader.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=session_user')).rows[0];assert.deepEqual(rights,{rolsuper:false,rolcreatedb:false,rolcreaterole:false});
  await assert.rejects(()=>reader.query('CREATE DATABASE forbidden_onboarding_api'),e=>e.code==='42501');
  assert.equal((await pool.query('SELECT count(*)::int n FROM organizational_scope.person_profile WHERE membership_id=$1',[ar.membershipId])).rows[0].n,1);
  assert.equal((await central.pool.query("SELECT count(*)::int n FROM public.organization_membership m JOIN public.platform_admin_assignment p ON p.global_user_id=m.global_user_id WHERE p.status='ACTIVE'")).rows[0].n,0);
  report.domain={privateApplicationHidden:true,taskPreserved:true,sharedCatalogRecord:true,apiWorkerCrossConnectDenied:true,apiCannotCreateDatabase:true,personProjectionLinked:true};
 }finally{await pool.end();}
}
module.exports={verify};
