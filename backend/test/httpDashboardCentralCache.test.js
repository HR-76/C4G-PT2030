'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createOrganizationDashboardRouter,emptyMetrics}=require('../src/routes/organizationDashboardRoutes');
const {id}=require('./support/httpSqlFixture');
const report=()=>({organizationId:id(1),today:'2026-10-26',metrics:emptyMetrics(),states:{},unitMetrics:[],unitsAvailable:false,units:[],items:[],deadlines:[],deadlineTotal:0});
const summary=total=>({total,open:total,closing_soon:0,sources:[],recent:[]});
async function serve(options,work){
 const pass=(req,res,next)=>next(),app=express(),state={central:0,tenant:0,fail:false,day:'2026-06-01',elapsed:0,hold:null};
 app.use('/organizations',createOrganizationDashboardRouter({express,clock:()=>new Date(`${state.day}T12:00:00Z`),authenticate:pass,
  organizationMiddleware:{requireServerSession:pass,resolveOrganizationContext(req,res,next){req.organizationContext={organization:{id:id(1)}};next();},requireOrganizationContext:pass},
  applications:{async execute(){state.tenant++;return {report:report(),privateSummary:summary(0)};}},
  central:{async dashboardSummary(){const n=++state.central;if(state.hold)await state.hold;if(state.fail)throw Error('central unavailable');return summary(n);}},
  centralSummaryNow:()=>state.elapsed,...options}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const read=async()=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/organizations/${id(1)}/dashboard/summary`);return {status:r.status,body:await r.json()};};
 try{await work(state,read);}finally{await new Promise(r=>server.close(r));}
}
test('without a reuse period every dashboard reads the central catalogue',async()=>{
 await serve({},async(state,read)=>{await read();await read();assert.equal(state.central,2);});
});
test('the central catalogue summary is reused for the period and read again after it or on a new day',async()=>{
 await serve({centralSummaryReuseMs:30000},async(state,read)=>{
  assert.equal((await read()).body.catalogIndicators.total,1);
  state.elapsed=29999;assert.equal((await read()).body.catalogIndicators.total,1);
  assert.equal(state.central,1);assert.equal(state.tenant,2,'the organization data is read on every request');
  state.elapsed=30000;assert.equal((await read()).body.catalogIndicators.total,2);
  state.day='2026-06-02';assert.equal((await read()).body.catalogIndicators.total,3);
 });
});
test('simultaneous dashboards share one central read',async()=>{
 await serve({centralSummaryReuseMs:30000},async(state,read)=>{
  let release;state.hold=new Promise(r=>{release=r;});
  const answers=Promise.all([read(),read(),read()]);
  await new Promise(r=>setTimeout(r,100));release();
  for(const answer of await answers)assert.equal(answer.status,200);
  assert.equal(state.central,1);assert.equal(state.tenant,3);
 });
});
test('a failed central read is never reused',async()=>{
 await serve({centralSummaryReuseMs:30000},async(state,read)=>{
  state.fail=true;assert.equal((await read()).status,503);assert.equal(state.tenant,0);
  state.fail=false;const answer=await read();assert.equal(answer.status,200);assert.equal(answer.body.catalogIndicators.total,2);
 });
});
