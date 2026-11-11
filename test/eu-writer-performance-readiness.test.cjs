'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {seedSpecDefault,seedPlan,validateFixtureInput,quiesceFixtureSource,operationalIdentityDigest}=require('./integration/eu-writer-performance/fixture.cjs');
const {runReadiness,functionalSummary}=require('./integration/eu-writer-performance/readiness.cjs');

test('performance seed fixes identities, business dates and declared volumes',()=>{
 const a=seedPlan(),b=seedPlan({...seedSpecDefault});
 assert.deepEqual(a,b);assert.match(a.digest,/^[a-f0-9]{64}$/);
 assert.equal(a.tenants.length,2);assert.equal(a.tenants[0].applications.length,1000);
 assert.equal(a.tenants[0].people.length,249); // The provisioned owner is the 250th person.
 assert.notEqual(a.tenants[0].organizationId,a.tenants[1].organizationId);
 assert.equal(new Set(a.tenants.flatMap(t=>t.applications.map(x=>x.id))).size,2000);
 assert.equal(a.spec.instant,'2026-10-31T00:00:00.000Z');
 assert.notEqual(seedPlan({...seedSpecDefault,id:'eu-writer-performance-seed-v2'}).digest,a.digest);
});
test('fixture refuses remote/admin-default targets and malformed seed before opening pools',()=>{
 const valid={adminUrl:'postgresql://proof_admin:synthetic@127.0.0.1:65432/postgres',keycloakBase:'https://localhost:65433',keycloakPassword:'synthetic-password',runId:'a'.repeat(32),centralRevision:'043'};
 assert.equal(validateFixtureInput(valid).centralRevision,'043');
 for(const change of [{adminUrl:valid.adminUrl.replace('127.0.0.1','example.com')},{adminUrl:valid.adminUrl.replace('65432','5432')},{adminUrl:valid.adminUrl.replace('/postgres','/habitual')},{keycloakBase:'https://example.com:65433'},{centralRevision:'035'},{runId:'../outside'}])assert.throws(()=>validateFixtureInput({...valid,...change}));
 for(const spec of [{...seedSpecDefault,tenants:3},{...seedSpecDefault,applicationsPerTenant:1001},{...seedSpecDefault,instant:'today'},{...seedSpecDefault,extra:'unrecorded'}])assert.throws(()=>seedPlan(spec));
});
test('real identity-provider subjects bind to fixed business actors without changing the business seed',()=>{
 const seed=seedPlan(),before=JSON.stringify(seed),users=seed.tenants.map((t,index)=>({username:t.username,subject:index?'22222222-2222-4222-8222-222222222222':'11111111-1111-4111-8111-111111111111'}));
 assert(seed.tenants.every(t=>!Object.hasOwn(t,'subject')));
 const binding=operationalIdentityDigest(seed,'https://localhost:65433/realms/synthetic',users);
 assert.match(binding,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(seed),before);assert.equal(seedPlan().digest,seed.digest);
 assert.notEqual(operationalIdentityDigest(seed,'https://localhost:65434/realms/synthetic',users),binding);
 const changed=users.map(u=>({...u}));changed[0].subject='33333333-3333-4333-8333-333333333333';assert.notEqual(operationalIdentityDigest(seed,'https://localhost:65433/realms/synthetic',changed),binding);assert.equal(seedPlan().digest,seed.digest);
 changed[0].subject='not-a-subject';assert.throws(()=>operationalIdentityDigest(seed,'https://localhost:65433/realms/synthetic',changed));
});
test('source fixture respects ACTIVE to SUSPEND_REQUESTED to QUIESCED fences and rolls back refusal',async()=>{
 const actor=seedPlan().tenants[0].userId;
 for(const failSecond of [false,true]){
  let state='ACTIVE',fence=1;const events=[];
  const client={async query(sql,values){events.push(sql.split(' ')[0]);if(!sql.startsWith('UPDATE'))return {rows:[]};assert.equal(values[1],actor);assert.equal(values[2],state);assert.equal(values[3],fence);assert.equal(values[0],state==='ACTIVE'?'SUSPEND_REQUESTED':'QUIESCED');assert.match(sql,/changed_at=clock_timestamp\(\)/);if(failSecond&&fence===2)throw Error('LEASE_STILL_ACTIVE');state=values[0];fence++;return {rowCount:1,rows:[{state,fence}]};},release(){events.push('release');}};
  const action=quiesceFixtureSource({connect:async()=>client},actor);
  if(failSecond){await assert.rejects(action,/LEASE_STILL_ACTIVE/);assert.deepEqual(events,['BEGIN','UPDATE','UPDATE','ROLLBACK','release']);}
  else{await action;assert.equal(state,'QUIESCED');assert.equal(fence,3);assert.deepEqual(events,['BEGIN','UPDATE','UPDATE','COMMIT','release']);}
 }
});
function readinessFixture(){
 const plan=seedPlan(),calls=[];
 const tenants=plan.tenants.map(t=>({...t,owner:{id:t.userId},opportunityId:t.privateOpportunityId,expected:{applications:1000,people:250,privateOpportunities:1}}));
 const fixture={centralRevision:'043',tenants,seed:plan,writerState:{state:'QUIESCED',pending:0,runtimeEnabled:false},verifyDatabaseIsolation:async()=>({verified:true}),assertSchemas:async()=>({central:'043_opportunity_eu_writer_v2',tenants:['034_application_snapshot_v2','034_application_snapshot_v2']}),assertWriterIdle:async()=>({state:'QUIESCED',pending:0,runtimeEnabled:false}),runtime:{poolManager:{snapshot:()=>({active:0,queued:0})}}};
 const metrics=()=>({queryCount:1,pendingQueries:0,queryEvents:[{startMs:0,endMs:1}],checkouts:[{waitMs:0,holdMs:1}],spans:[{startMs:0,endMs:1}],sqlErrors:[],failures:[]});
 const money={totalBudget:{total:'100010.00'},organizationBudget:{total:'50010.00'}};
 const token=(i,offset)=>'key.'+Buffer.from(JSON.stringify({position:{offset,digest:'report-digest'},context:{organizationId:tenants[i].organizationId,subjectId:tenants[i].owner.id,route:'application-report-v2'},exp:123456789})).toString('base64url')+'.signature';
 function page(i,n){return {organizationId:tenants[i].organizationId,total:1000,metrics:{total:1000,...money},digest:'report-digest',items:tenants[i].applications.slice((n-1)*25,n*25).map(x=>({applicationId:x.id})),page:n,pageSize:25,nextCursor:token(i,n*25),previousCursor:n===1?null:token(i,(n-2)*25)};}
 const http={async request(i,kind,opts={}){calls.push({i,kind,opts});if(opts.expectedOrganization)return {status:404,data:{error:{code:'RESOURCE_NOT_AVAILABLE'}}};if(kind.startsWith('/api/opportunities/'))return {status:404,data:{error:{code:'OPPORTUNITY_NOT_FOUND'}}};if(kind.startsWith('/api/applications/report?cursor=')){const cursor=decodeURIComponent(kind.split('=')[1]);return cursor.endsWith('.signature')?{status:200,data:page(i,2),metrics:metrics()}:{status:400,data:{error:{code:'INVALID_CURSOR'}}};}if(kind==='report')return {status:200,data:page(i,1),metrics:metrics()};if(kind==='dashboard')return {status:200,data:{report:{organizationId:tenants[i].organizationId,total:1000},applications:{total:1000,...money},opportunities:{total:1},recent_opportunities:[{id:'/oportunidades:'+tenants[i].opportunityId,href:'/oportunidades/'+tenants[i].opportunityId}]},metrics:metrics()};return {status:200,data:{items:[{opportunityId:tenants[i].opportunityId}],nextCursor:null},metrics:metrics()};},async anonymousRequest(){calls.push({anonymous:true});return {status:401,data:{error:{code:'AUTHENTICATION_REQUIRED'}}};},async drain(){return 0;}};
 return {fixture,http,calls};
}
test('readiness executes finite sequential functional requests, checks both tenants and denies cross access',async()=>{
 const x=readinessFixture(),report={};await runReadiness({...x,report,check:async(_name,work)=>work()});
 assert.equal(report.httpReadiness.status,'PASS');assert.equal(report.httpReadiness.performanceMeasurement,false);
 assert.equal(report.httpReadiness.responses.length,8);assert.equal(report.httpReadiness.refusals.length,9);
 assert.equal(x.calls.length,17);assert.equal(x.calls.filter(x=>x.anonymous).length,3);
 assert.match(report.httpReadiness.responses[0].responseDigest,/^[a-f0-9]{64}$/);
 assert(!JSON.stringify(report.httpReadiness).includes('synthetic-password'));
});
test('dashboard readiness requires the exact private identifier and href, rejecting raw, catalog and foreign identities',async()=>{
 const x=readinessFixture(),tenant=x.fixture.tenants[0],data=(await x.http.request(0,'dashboard')).data;
 assert.equal(functionalSummary('dashboard',data,tenant).opportunities,1);
 for(const delta of [{id:tenant.opportunityId},{id:'/catalogo:'+tenant.opportunityId},{id:'/oportunidades:'+x.fixture.tenants[1].opportunityId},{href:'/catalogo/'+tenant.opportunityId},{href:'/oportunidades/'+x.fixture.tenants[1].opportunityId}]){
  const invalid=structuredClone(data);Object.assign(invalid.recent_opportunities[0],delta);assert.throws(()=>functionalSummary('dashboard',invalid,tenant));
 }
});
test('readiness never accepts missing data, HTTP503, cross-tenant success, busy worker or active leases',async()=>{
 for(const kind of ['wrong-count','503','cross-success','writer','drain','missing-metrics']){
  const x=readinessFixture();const original=x.http.request;
  if(kind==='writer')x.fixture.assertWriterIdle=async()=>({state:'ACTIVE',pending:1,runtimeEnabled:true});
  else if(kind==='drain')x.fixture.runtime.poolManager.snapshot=()=>({active:1,queued:0});
  else x.http.request=async(i,route,opts)=>kind==='missing-metrics'?{...(await original(i,route,opts)),metrics:null}:kind==='503'?{status:503,data:{}}:kind==='cross-success'&&opts?.expectedOrganization?{status:200,data:{}}:kind==='wrong-count'&&route==='report'?{status:200,data:{organizationId:x.fixture.tenants[i].organizationId,total:999}}:original(i,route,opts);
  await assert.rejects(runReadiness({...x,report:{},check:async(_name,work)=>work(),drainTimeoutMs:1}));
 }
});
