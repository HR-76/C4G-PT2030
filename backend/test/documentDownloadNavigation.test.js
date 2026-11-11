'use strict';
const {waitForSignal,bounded,deferCleanup,trackServer,listening}=require('./support/networkWait');
const test=require('./support/networkWait').test,assert=require('node:assert/strict');
const express=require('express');
const {createApplicationSliceRouter}=require('../src/routes/applicationSliceRoutes');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('download route authorizes before verified attachment and never redirects',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'c4g-route-')),file=path.join(directory,'synthetic');deferCleanup(()=>fs.rmSync(directory,{recursive:true,force:true}));fs.writeFileSync(file,'document');
 let denied=false,capabilities=0;const app=express(),next=(req,res,done)=>done();
 app.use(createApplicationSliceRouter({express,authenticate:next,organizationMiddleware:{requireServerSession:next,resolveOrganizationContext:next,requireOrganizationContext:next},
 service:{async execute(){if(denied)throw Object.assign(Error(),{code:'NOT_AUTHORIZED'});return{organizationId:'synthetic-org',versionId:'synthetic-version',filename:'synthetic.pdf'};}},
 documentAccessPort:{async download({revalidate}){capabilities++;await revalidate();return{open:()=>fs.createReadStream(file),dispose:async()=>{},headers:{'Content-Length':'8','Content-Disposition':'attachment; filename="synthetic.pdf"','Cache-Control':'no-store'}};}}}));
 const server=trackServer(app.listen(0,'127.0.0.1'));await listening(server);
 try{const url=`http://127.0.0.1:${server.address().port}/a/documents/versions/b/download`;
 const good=await fetch(url,{redirect:'manual'});assert.equal(good.status,200);assert.equal(good.headers.get('location'),null);assert.equal(await good.text(),'document');assert.equal(good.headers.get('referrer-policy'),'no-referrer');assert.equal(good.headers.get('cache-control'),'no-store');assert.match(good.headers.get('content-disposition'),/^attachment/);assert.equal(capabilities,1);
 denied=true;const bad=await fetch(url,{redirect:'manual'});assert.equal(bad.status,403);assert.equal(bad.headers.get('location'),null);assert.equal((await bad.json()).error.code,'NOT_AUTHORIZED');assert.equal(capabilities,1);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});}
});
test('disconnect during preparation cancels provider work; errors after headers never produce a second response',async()=>{
 const http=require('node:http');let started,stopped;
 const began=new Promise(r=>started=r),cancelled=new Promise(r=>stopped=r);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'c4g-route-error-')),file=path.join(directory,'synthetic');deferCleanup(()=>fs.rmSync(directory,{recursive:true,force:true}));fs.writeFileSync(file,Buffer.alloc(1024*1024));
 let mode='prepare',disposed=0;const app=express(),next=(req,res,n)=>n();
 app.use(createApplicationSliceRouter({express,authenticate:next,organizationMiddleware:{requireServerSession:next,resolveOrganizationContext:next,requireOrganizationContext:next},service:{execute:async()=>({organizationId:'A',versionId:'v'})},documentAccessPort:{download:async({signal})=>{
  if(mode==='prepare'){started();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{stopped();reject(signal.reason)},{once:true}));}
  return {open:()=>{const stream=fs.createReadStream(file,{highWaterMark:1024});stream.once('data',()=>setImmediate(()=>stream.destroy(Error('SYNTHETIC_READ_FAILURE'))));return stream},dispose:async()=>{disposed++},headers:{'Content-Length':String(1024*1024),'Content-Disposition':'attachment; filename="test.bin"'}};
 }}}));
 const server=trackServer(app.listen(0,'127.0.0.1'));await listening(server);const url=`http://127.0.0.1:${server.address().port}/a/documents/versions/v/download`;
 try{
  const req=http.get(url);deferCleanup(()=>req.destroy());const outcome=new Promise((resolve,reject)=>{req.once('error',reject);req.once('response',()=>resolve())});await waitForSignal(began,outcome,'download preparation');req.destroy();await bounded(cancelled,'download cancellation');
  mode='delivery';await assert.rejects(async()=>{const response=await fetch(url);await response.arrayBuffer()});
  // Give the route's finally block a turn after the socket closes.
  await new Promise(r=>setImmediate(r));assert.equal(disposed,1);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});}
});
