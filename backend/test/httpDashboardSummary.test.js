'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createOrganizationDashboardRouter,dashboardProjection,emptyMetrics}=require('../src/routes/organizationDashboardRoutes');
const {id}=require('./support/httpSqlFixture');
function data(){const metrics=emptyMetrics();metrics.total=57;return {organizationId:id(1),today:'2026-10-26',metrics,states:{IDENTIFIED:metrics},unitMetrics:[],unitsAvailable:false,units:[],items:[],deadlines:[],deadlineTotal:0};}
const opportunities={total:20,open:10,closing_soon:5,sources:[],recent:[]};
test('summary projections consume server aggregates rather than partial detail counts',()=>{
 const result=dashboardProjection(data(),opportunities,opportunities);assert.equal(result.applications.total,57);assert.equal(result.opportunities.total,40);assert.equal(result.unit_totals,null);
});
test('dashboard HTTP binds organization and final authority; source errors cannot return partial totals',async()=>{
 let denied=false,sourceFailed=false,reads=0;const pass=(req,res,next)=>next(),app=express();
 app.use('/organizations',createOrganizationDashboardRouter({express,clock:()=>new Date('2026-06-01T23:30:00Z'),authenticate:pass,organizationMiddleware:{requireServerSession:pass,resolveOrganizationContext(req,res,next){req.organizationContext={organization:{id:id(1)}};next();},requireOrganizationContext:pass},
  applications:{async execute(method,input){reads++;assert.equal(method,'dashboard');assert.deepEqual(input,{today:'2026-06-01',asOf:'2026-06-01T23:30:00.000Z'});if(denied)throw Object.assign(Error(),{code:'NOT_AUTHORIZED'});return {report:data(),privateSummary:opportunities};}},
  central:{dashboardSummary:async(today,asOf)=>{assert.equal(today,'2026-06-01');assert.equal(asOf,'2026-06-01T23:30:00.000Z');if(sourceFailed)throw Error('private internals');return opportunities;}},opportunities:{dashboardSummary:async(today,_request,asOf)=>{assert.equal(today,'2026-06-01');assert.equal(asOf,'2026-06-01T23:30:00.000Z');return opportunities;}}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const url=`http://127.0.0.1:${server.address().port}/organizations/`;
  let r=await fetch(url+id(2)+'/dashboard/summary');assert.equal(r.status,404);assert.equal(reads,0);
  r=await fetch(url+id(1)+'/dashboard/summary');assert.equal(r.status,200);assert.equal((await r.json()).applications.total,57);assert.equal(reads,1);
  denied=true;r=await fetch(url+id(1)+'/dashboard/summary');assert.equal(r.status,403);
  denied=false;sourceFailed=true;r=await fetch(url+id(1)+'/dashboard/summary');assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:{code:'SERVICE_UNAVAILABLE'}});
 }finally{await new Promise(r=>server.close(r));}
});
