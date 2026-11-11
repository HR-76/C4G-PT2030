'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const digest=data=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
function functionalSummary(kind,data,tenant){
 if(kind==='report'){
  assert.equal(data?.organizationId,tenant.organizationId,'REPORT_ORGANIZATION_MISMATCH');assert.equal(data.total,tenant.expected.applications,'REPORT_TOTAL_MISMATCH');
  assert.equal(data.metrics?.totalBudget?.total,'100010.00');assert.equal(data.metrics?.organizationBudget?.total,'50010.00');
  assert.equal(data.pageSize,25);assert.equal(data.items?.length,25);
  return {organizationId:data.organizationId,applications:data.total};
 }
 if(kind==='private'){
  assert(Array.isArray(data?.items),'PRIVATE_CATALOG_MISSING');assert.equal(data.items.length,tenant.expected.privateOpportunities);assert.equal(data.nextCursor,null);assert.deepEqual(data.items.map(x=>x.opportunityId),[tenant.opportunityId]);
  return {privateOpportunities:data.items.length,opportunityIds:data.items.map(x=>x.opportunityId)};
 }
 assert.equal(kind,'dashboard');assert.equal(data?.report?.organizationId,tenant.organizationId,'DASHBOARD_ORGANIZATION_MISMATCH');assert.equal(data.report.total,tenant.expected.applications);assert.equal(data.applications?.total,tenant.expected.applications);assert.equal(data.opportunities?.total,tenant.expected.privateOpportunities);
 assert.equal(data.applications.totalBudget?.total,'100010.00');assert.equal(data.applications.organizationBudget?.total,'50010.00');
 assert(Array.isArray(data.recent_opportunities));assert.deepEqual(data.recent_opportunities.map(x=>({id:x.id,href:x.href})),[{id:'/oportunidades:'+tenant.opportunityId,href:'/oportunidades/'+tenant.opportunityId}]);
 return {organizationId:data.report.organizationId,applications:data.applications.total,opportunities:data.opportunities.total};
}
function assertMetrics(metrics){
 assert(metrics&&Number.isSafeInteger(metrics.queryCount)&&metrics.queryCount>0,'HTTP_METRICS_MISSING');
 assert.equal(metrics.pendingQueries,0);assert.equal(metrics.queryEvents?.length,metrics.queryCount);
 assert(metrics.queryEvents.every(q=>Number.isFinite(q.startMs)&&Number.isFinite(q.endMs)&&q.endMs>=q.startMs),'HTTP_QUERY_INTERVAL_INCOMPLETE');
 assert(Array.isArray(metrics.checkouts)&&metrics.checkouts.length>0&&metrics.checkouts.every(c=>!c.error&&Number.isFinite(c.waitMs)&&Number.isFinite(c.holdMs)),'HTTP_CHECKOUT_INCOMPLETE');
 assert(Array.isArray(metrics.spans)&&metrics.spans.every(s=>Number.isFinite(s.startMs)&&Number.isFinite(s.endMs)),'HTTP_CHECKPOINT_INCOMPLETE');
 assert.deepEqual(metrics.sqlErrors,[]);assert.deepEqual(metrics.failures,[]);
}
function cursorPayload(value){
 assert(typeof value==='string'&&value.length<=4096);const parts=value.split('.');assert.equal(parts.length,3);const payload=JSON.parse(Buffer.from(parts[1],'base64url').toString());assert(payload.position&&payload.context&&Number.isSafeInteger(payload.exp));return payload;
}
async function runReadiness({fixture,http,report={},check=(_name,work)=>work(),drainTimeoutMs=30000}){
 assert(fixture&&http&&typeof http.drain==='function');assert.equal(fixture.centralRevision,'043','HTTP_READINESS_REQUIRES_043');assert.equal(fixture.tenants.length,2);assert(Number.isSafeInteger(drainTimeoutMs)&&drainTimeoutMs>0&&drainTimeoutMs<=30000);
 const result={status:'RUNNING',performanceMeasurement:false,seedDigest:fixture.seed.digest,responses:[],refusals:[],limitations:['Finite sequential functional checks; no load matrix, latency SLO or capacity claim.','Fixture uses real OIDC/PKCE with synthetic principals and existing scoped runtime roles.']};report.httpReadiness=result;
 const firstPages=[];
 try{
  await check('HTTP_READY_SCHEMAS_AND_WRITER_IDLE',async()=>{
   result.schemas=await fixture.assertSchemas();assert.equal(result.schemas.central,'043_opportunity_eu_writer_v2');assert.deepEqual(result.schemas.tenants,['034_application_snapshot_v2','034_application_snapshot_v2']);
   result.writer=await fixture.assertWriterIdle();assert.equal(result.writer.state,'QUIESCED');assert.equal(result.writer.pending,0);assert.equal(result.writer.runtimeEnabled,false);
  });
  await check('HTTP_READY_DATABASE_ROLES_AND_RLS',async()=>{result.databaseIsolation=await fixture.verifyDatabaseIsolation();assert.equal(result.databaseIsolation.verified,true);});
  for(let index=0;index<2;index++)for(const kind of ['report','private','dashboard'])await check(`HTTP_READY_TENANT_${index}_${kind.toUpperCase()}`,async()=>{
   const response=await http.request(index,kind);assert.equal(response.status,200,'HTTP_FUNCTIONAL_'+kind.toUpperCase()+'_FAILED');const summary=functionalSummary(kind,response.data,fixture.tenants[index]);
   await http.drain(drainTimeoutMs);assertMetrics(response.metrics);
   if(kind==='report'){assert.equal(response.data.page,1);assert.equal(response.data.previousCursor,null);firstPages[index]=response.data;}
   result.responses.push({tenant:index,kind,status:response.status,summary,responseDigest:digest(require('./http.cjs').normalizeResponse(response.data)),metricsComplete:true});
  });
  for(let index=0;index<2;index++)await check(`HTTP_READY_TENANT_${index}_SIGNED_REPORT_CURSOR`,async()=>{
   const first=firstPages[index],payload=cursorPayload(first.nextCursor),tenant=fixture.tenants[index];
   assert.equal(payload.position.offset,25);assert.equal(payload.position.digest,first.digest);assert.equal(payload.context.organizationId,tenant.organizationId);assert.equal(payload.context.subjectId,tenant.owner.id);assert.equal(payload.context.route,'application-report-v2');
   const page=await http.request(index,'/api/applications/report?cursor='+encodeURIComponent(first.nextCursor));assert.equal(page.status,200);functionalSummary('report',page.data,tenant);assert.equal(page.data.page,2);assert.equal(page.data.digest,first.digest);
   assert(page.data.items.every(item=>!first.items.some(before=>before.applicationId===item.applicationId)),'REPORT_PAGES_OVERLAP');
   assert.equal(cursorPayload(page.data.nextCursor).position.offset,50);assert.equal(cursorPayload(page.data.previousCursor).position.offset,0);
   await http.drain(drainTimeoutMs);assertMetrics(page.metrics);
   result.responses.push({tenant:index,kind:'report-page-2',status:200,summary:{page:2,pageSize:25,total:page.data.total,signedCursorAccepted:true},responseDigest:digest(require('./http.cjs').normalizeResponse(page.data)),metricsComplete:true});
   const parts=first.nextCursor.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
   const denied=await http.request(index,'/api/applications/report?cursor='+encodeURIComponent(parts.join('.')));assert.equal(denied.status,400);assert.equal(denied.data?.error?.code,'INVALID_CURSOR');result.refusals.push({tenant:index,kind:'tampered-report-cursor',status:denied.status,code:denied.data.error.code});
  });
  for(let index=0;index<2;index++){
   const foreign=fixture.tenants[1-index];
   for(const [kind,opts] of [['dashboard',{expectedOrganization:foreign.organizationId}],['/api/opportunities/'+foreign.opportunityId,{}]])await check(`HTTP_READY_TENANT_${index}_CROSS_${kind==='dashboard'?'DASHBOARD':'PRIVATE'}_DENIED`,async()=>{
    const response=await http.request(index,kind,opts);assert([403,404].includes(response.status),'CROSS_TENANT_ACCESS_NOT_DENIED');result.refusals.push({tenant:index,kind:kind==='dashboard'?'cross-dashboard':'cross-private',status:response.status,code:response.data?.error?.code||null});
   });
  }
  for(const kind of ['report','private','/api/organizations/'+fixture.tenants[0].organizationId+'/dashboard/summary'])await check('HTTP_READY_ANONYMOUS_'+(kind.startsWith('/')?'DASHBOARD':kind.toUpperCase())+'_DENIED',async()=>{
   const response=await http.anonymousRequest(kind);assert.equal(response.status,401,'ANONYMOUS_ACCESS_NOT_DENIED');result.refusals.push({kind:kind.startsWith('/')?'anonymous-dashboard':'anonymous-'+kind,status:response.status,code:response.data?.error?.code||null});
  });
  await check('HTTP_READY_DRAIN_AND_FINAL_SCHEMAS',async()=>{
   await http.drain(drainTimeoutMs);
   const deadline=performance.now()+drainTimeoutMs;let state;
   while((state=fixture.runtime.poolManager.snapshot()).active||state.queued){assert(performance.now()<deadline,'HTTP_READINESS_DRAIN_TIMEOUT');await new Promise(r=>setTimeout(r,Math.min(25,drainTimeoutMs)));}
   result.drained={active:state.active,queued:state.queued};assert.deepEqual(await fixture.assertSchemas(),result.schemas);assert.deepEqual(await fixture.assertWriterIdle(),result.writer);
  });
  result.status='PASS';return result;
 }catch(error){result.status='FAIL';throw error;}
}
module.exports={runReadiness,functionalSummary,assertMetrics,cursorPayload};
