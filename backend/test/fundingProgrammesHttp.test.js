'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createFundingRouters}=require('../src/fundingTenders/http');
const admin='11111111-1111-4111-8111-111111111111',key='22222222-2222-4222-8222-222222222222';
test('HTTP collection selection is closed, current-authority checked and bound to its persisted intention',async t=>{
 const state={admin:true,source:'CORDIS'};
 const pool={connect:async()=>({release(){},async query(sql){
  if(sql.includes('FROM public.global_user'))return {rows:[{id:admin}]};
  if(sql.includes('FROM public.platform_admin_assignment'))return {rows:state.admin?[{id:admin}]:[]};
  if(sql.includes('funding_run WHERE request_id'))return {rows:[{run_id:key,source_code:state.source,requested_by:admin,status:'SUCCESS'}]};
  if(/^(BEGIN|SET LOCAL|SELECT pg_advisory|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};
  throw Error('Unexpected write or query');
 }})};
 const router=createFundingRouters({express,pool,catalogReader:require('../src/fundingTenders/repository').createFundingRepository({pool}),sourceMode:'live-local',sourceApproval:'central-programmes-100',policyVersion:'test',recentMfaRequirement:{mfa:false,maxAgeSeconds:300},
  authenticate(req,res,next){if(req.headers['x-anonymous'])return res.sendStatus(401);req.user={id:admin};req.authContext={evidence:{authTime:Date.now()/1000-(req.headers['x-stale']?400:0),policyVersion:'test'}};next()},
  organizationMiddleware:{requireServerSession:(_q,_s,n)=>n(),resolveOrganizationContext:(_q,_s,n)=>n()},sessionRegistry:{}});
 const app=express();app.use(express.json(),router.admin);const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}));
 const post=(body,headers={})=>fetch('http://127.0.0.1:'+server.address().port+'/funding-tenders',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 const good={source:'CORDIS',requestId:key};const response=await post(good);assert.equal(response.status,202);assert.equal((await response.json()).source,'CORDIS');
 assert.equal((await post({...good,source:'ERASMUS'})).status,409);
 for(const source of ['__proto__','INTERREG',null,{},[]])assert.equal((await post({...good,source})).status,400);
 assert.equal((await post({...good,results:1000})).status,400);assert.equal((await post({...good,requestId:[key]})).status,400);
 assert.equal((await post(good,{'x-stale':'1'})).status,403);assert.equal((await post(good,{'x-anonymous':'1'})).status,401);
 state.admin=false;assert.equal((await post(good)).status,403);
 state.admin=true;state.source='EU_FUNDING_TENDERS';assert.equal((await post({requestId:key})).status,202);
});

test('EU suspension and stale source fence are explicit HTTP conflicts rather than uncertain service failures',async t=>{
 const state={code:'OPPORTUNITY_V2_EU_SUSPENDED'};
 const pool={connect:async()=>({release(){},async query(sql){
  if(sql.includes('FROM public.global_user')||sql.includes('FROM public.platform_admin_assignment'))return {rows:[{id:admin}]};
  if(sql.includes('assert_eu_active_v2'))throw Object.assign(new Error(state.code),{code:'P0001'});
  if(/^(BEGIN|SET LOCAL|ROLLBACK)/.test(sql)||sql==='LOCK TABLE opportunity_catalog.funding_run IN ROW EXCLUSIVE MODE')return {rows:[]};throw Error('Unexpected effect');
 }})};
 const routes=createFundingRouters({express,pool,catalogReader:{list(){},get(){},revision(){}},euSourceControlEnabled:true,sourceMode:'fixture',policyVersion:'test',recentMfaRequirement:{mfa:false,maxAgeSeconds:300},
  authenticate(req,res,next){req.user={id:admin};req.authContext={evidence:{authTime:Date.now()/1000,policyVersion:'test'}};next();},organizationMiddleware:{requireServerSession:(_q,_s,n)=>n(),resolveOrganizationContext:(_q,_s,n)=>n()},sessionRegistry:{}});
 const app=express();app.use(express.json(),routes.admin);const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 for(const code of ['OPPORTUNITY_V2_EU_SUSPENDED','OPPORTUNITY_V2_SOURCE_FENCE_STALE']){state.code=code;const res=await fetch('http://127.0.0.1:'+server.address().port+'/funding-tenders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:key})});assert.equal(res.status,409);assert.equal((await res.json()).error.code,code);}
});

test('missing EU v2 writer is an explicit unavailable API response',async t=>{
 const pool={connect:async()=>({release(){},async query(sql){
  if(sql.includes('FROM public.'))return {rows:[{id:admin}]};
  if(/^(BEGIN|SET LOCAL|ROLLBACK)/.test(sql)||sql==='LOCK TABLE opportunity_catalog.funding_run IN ROW EXCLUSIVE MODE'||sql.includes('assert_eu_active_v2'))return {rows:[]};
  throw Error('Unexpected effect');
 }})};
 const routes=createFundingRouters({express,pool,catalogReader:{list(){},get(){},revision(){}},euSourceControlEnabled:true,sourceMode:'fixture',policyVersion:'test',recentMfaRequirement:{mfa:false,maxAgeSeconds:300},
  authenticate(req,res,next){req.user={id:admin};req.authContext={evidence:{authTime:Date.now()/1000,policyVersion:'test'}};next();},organizationMiddleware:{requireServerSession:(_q,_s,n)=>n(),resolveOrganizationContext:(_q,_s,n)=>n()},sessionRegistry:{}});
 const app=express();app.use(express.json(),routes.admin);const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const res=await fetch('http://127.0.0.1:'+server.address().port+'/funding-tenders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:key})});
 assert.equal(res.status,503);assert.equal((await res.json()).error.code,'FUNDING_EU_V2_WRITER_REQUIRED');
});
