'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createApplicationSliceRouter}=require('../src/routes/applicationSliceRoutes');
async function serve(execute,work){
 const next=(req,res,done)=>done(),app=express();
 app.use('/api/applications',createApplicationSliceRouter({express,authenticate:next,
  organizationMiddleware:{requireServerSession:next,resolveOrganizationContext:next,requireOrganizationContext:next},service:{execute}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const read=async(query='')=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/applications/technician-dashboard${query}`);return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')};};
 try{await work(read);}finally{await new Promise(r=>server.close(r));}
}
const tasks={today:'2026-11-14',items:[],total:0,counts:{},nextCursor:null},alerts={notifications:[],unread_count:0,total:0,truncated:false},reviews={items:[],nextCursor:null};
const refused=(code,extra={})=>Object.assign(new Error('refused'),{code,...extra});

test('one request runs the three existing protected reads in order, one at a time, on the same request',async()=>{
 const calls=[];let running=0,request;
 await serve(async(method,input,id,req)=>{
  assert.equal(++running,1,'reads never overlap');request??=req;assert.equal(req,request);assert.equal(id,null);
  calls.push([method,input]);await new Promise(r=>setTimeout(r,5));running--;
  return {workMine:tasks,alertsList:alerts,reviewMine:reviews}[method];
 },async read=>{
  const answer=await read();
  assert.equal(answer.status,200);assert.equal(answer.cache,'no-store');
  assert.deepEqual(answer.body,{tasks,alerts,reviews});
  assert.deepEqual(calls,[['workMine',{status:'OPEN',period:'all'}],['alertsList',{limit:5}],['reviewMine',{}]]);
 });
});

test('a part that is unavailable or refused is reported in its place; the others are still returned',async()=>{
 await serve(async method=>{
  if(method==='reviewMine')throw refused('SCHEMA_UPGRADE_REQUIRED');
  if(method==='alertsList')throw refused('AUTHORITY_DENIED');
  return tasks;
 },async read=>{
  const answer=await read();
  assert.equal(answer.status,200);
  assert.deepEqual(answer.body,{tasks,alerts:{error:{code:'RESOURCE_NOT_AVAILABLE'}},reviews:{error:{code:'SCHEMA_UPGRADE_REQUIRED'}}});
 });
 await serve(async method=>{if(method==='workMine')throw refused('private internals');return method==='alertsList'?alerts:reviews;},async read=>{
  assert.deepEqual((await read()).body,{tasks:{error:{code:'SERVICE_UNAVAILABLE'}},alerts,reviews});
 });
});

test('an invalid session refuses the whole request and stops the remaining reads',async()=>{
 const calls=[];
 await serve(async method=>{calls.push(method);if(method==='alertsList')throw refused('AUTHORITY_REQUIRED',{authorityFailure:'SESSION_INVALID'});return tasks;},async read=>{
  const answer=await read();
  assert.equal(answer.status,401);assert.equal(answer.body.error.code,'SESSION_REQUIRED');assert.equal(answer.body.tasks,undefined);
  assert.deepEqual(calls,['workMine','alertsList']);
 });
});

test('the request accepts no parameters',async()=>{
 let reads=0;
 await serve(async()=>{reads++;return tasks;},async read=>{
  const answer=await read('?limit=100');assert.equal(answer.status,400);assert.equal(answer.body.error.code,'INVALID_INPUT');assert.equal(reads,0);
 });
});
