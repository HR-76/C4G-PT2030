'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createFundingWorker}=require('../../../backend/src/fundingTenders/worker');
const {createSource}=require('../../../backend/src/fundingTenders/source');
const {createPgBossQueueAdapter}=require('../../../backend/src/async/adapters/pgBossQueueAdapter');
async function run({central,tenants,base,http,actor,userA,userB,failures}) {
 const admin=await actor(tenants[0].org,[]);
 await central.pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),admin.id]);
 const stored=(await central.coordinator.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[admin.sid])).rows[0].sess;
 stored.auth.user.platformRoles=['C4G_ADMIN'];stored.auth.user.name='Platform fixture';
 await central.coordinator.write([central.coordinator.sessionKey(admin.sid)],()=>central.coordinator.pool.query('INSERT INTO "public"."application_session_store" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid',[stored,stored.auth.absoluteExpiresAt/1000,admin.sid]));
 assert.equal((await http(userA,'/api/admin/integrations/funding-tenders','POST',{requestId:randomUUID()})).status,403);
 assert.equal((await http(userB,'/api/admin/integrations/funding-tenders')).status,403);
 const {PgBoss}=await import('../../../backend/node_modules/pg-boss/dist/index.js');
 const installer=new PgBoss({connectionString:central.connectionString,supervise:false,schedule:false});await installer.start();await installer.createQueue('funding-tenders-refresh',{retryLimit:0});await installer.stop();
 const queue=await createPgBossQueueAdapter({connectionString:central.connectionString,queueMap:{'funding_tenders.refresh':'funding-tenders-refresh'},inspectSchema:async()=>({schema:'pgboss',schemaVersion:Number((await central.pool.query('SELECT version FROM pgboss.version')).rows[0].version)})});
 const source=createSource({fetchImpl:async()=>new Response(JSON.stringify({results:[{content:'Funding fixture shared A/B',url:'https://example.invalid/shared',metadata:{identifier:['SHARED-SYNTHETIC-001'],frameworkProgramme:['43108390'],deadlineDate:['2027-12-31']}}]}))});
 const worker=createFundingWorker({pool:central.pool,queue,source});
 try {
  const requestId=randomUUID();const requested=await http(admin,'/api/admin/integrations/funding-tenders','POST',{requestId});assert.equal(requested.status,202,JSON.stringify(requested));
  assert.equal((await http(admin,'/api/admin/integrations/funding-tenders','POST',{requestId:randomUUID()})).data.runId,requested.data.runId);
  await worker.runOnce();assert.equal((await http(admin,'/api/admin/integrations/funding-tenders')).data.lastRun.status,'SUCCESS');
  const a=await http(userA,'/api/central-opportunities'),b=await http(userB,'/api/central-opportunities');assert.equal(a.status,200,JSON.stringify(a));assert.deepEqual(a.data,b.data);
  const opportunityId=a.data.items[0].opportunityId,detail=await http(userA,`/api/central-opportunities/${opportunityId}`);
  assert.equal(a.data.sourceMode,'fixture');
  for(const query of ['q=funding','q=SHARED-SYNTHETIC','programme=Horizon','closingFrom=2027-12-31&closingTo=2027-12-31']) {
    const filtered=await http(userA,`/api/central-opportunities?${query}`);assert.equal(filtered.status,200);assert.equal(filtered.data.items.length,1,query);
  }
  for(const query of ['q=absent','q=%25','q=%27','closingFrom=2028-01-01','closingTo=2027-12-30']) assert.equal((await http(userA,`/api/central-opportunities?${query}`)).data.items.length,0,query);
  for(const query of ['q[a]=x','closingFrom=2027-02-29','closingFrom=2028-01-01&closingTo=2027-01-01','cursor=bad']) assert.equal((await http(userA,`/api/central-opportunities?${query}`)).status,400,query);
  assert.equal(detail.status,200);assert.equal(detail.data.origin,'CENTRAL');
  const input={origin:'CENTRAL',centralRevisionId:detail.data.revisionId,opportunityId,evaluationId:null,title:'Private funding application A',responsibleMembershipId:userA.membershipId,deadline:'2027-11-30',idempotencyKey:randomUUID()};
  const created=await http(userA,'/api/applications','POST',input);assert.equal(created.status,201,JSON.stringify({created,failures:failures.slice(-3)}));
  assert.equal(created.data.origin,'CENTRAL');assert.deepEqual((await http(userA,'/api/applications','POST',input)).data,created.data);
  assert.equal((await http(userB,`/api/applications/${created.data.applicationId}`)).status,404);
  assert.equal((await http(userB,'/api/applications')).data.items.length,0);
  assert.equal((await http(userA,`/api/applications/${created.data.applicationId}`)).data.opportunityTitle,'Funding fixture shared A/B');
  assert.equal((await central.pool.query("SELECT to_regclass('opportunity_catalog.application') AS table_name")).rows[0].table_name,null);
  await require('./browser').run({base,admin,userA,userB,opportunityId,worker});
  await central.pool.query("UPDATE public.platform_admin_assignment SET status='REVOKED',revoked_at=clock_timestamp() WHERE global_user_id=$1",[admin.id]);
  assert.equal((await http(admin,'/api/admin/integrations/funding-tenders','POST',{requestId:randomUUID()})).status,403);
  console.log('FUNDING_HTTP_BROWSER_AB_PASS');
 } finally {await worker.shutdown()}
}
module.exports={run};
