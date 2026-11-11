'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),multer=require('multer');
const {randomUUID}=require('node:crypto');
const {createCentralImportRouter}=require('../src/portugal2030/uploadHttp');
const {MIME}=require('../src/portugal2030/planXlsxV2');
async function fixture(t){
 const calls=[],userId=randomUUID(),requestId=randomUUID();let allowed=true;
 const runtime={availability:async()=>({available:true,mode:'PREVIEW_ONLY'}),upload:async input=>{calls.push(input);return {requestId:input.requestId,sheets:['Avisos']}},get:async input=>input,preview:async input=>{calls.push(input);return {totalRows:1}}};
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:userId};next()});app.use(createCentralImportRouter({express,multer,runtime,authorize:async()=>{if(!allowed)throw Object.assign(Error(),{code:'C4G_ADMIN_REQUIRED'})}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}));
 return {url:`http://127.0.0.1:${server.address().port}`,calls,userId,requestId,revoke:()=>allowed=false};
}
test('central routes authorize before upload, bind actor and expose preview but no publication',async t=>{
 const f=await fixture(t),body=new FormData();body.append('requestId',f.requestId);body.append('file',new Blob(['PKxx'],{type:MIME}),'Plano.xlsx');
 const response=await fetch(f.url+'/xlsx',{method:'POST',body});assert.equal(response.status,201);assert.equal(f.calls[0].userId,f.userId);assert.equal(f.calls[0].file.buffer.toString(),'PKxx');
 const preview=await fetch(f.url+'/'+f.requestId+'/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sheetName:'Avisos',requestId:randomUUID()})});assert.equal(preview.status,200);
 assert.equal((await fetch(f.url+'/'+f.requestId+'/confirm',{method:'POST'})).status,405);
 f.revoke();assert.equal((await fetch(f.url+'/xlsx',{method:'POST',body})).status,403);assert.equal(f.calls.length,2);
});
test('central routes refuse forged authority and sanitize provider failures',async t=>{
 const f=await fixture(t);const response=await fetch(f.url+'/'+f.requestId+'/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sheetName:'Avisos',requestId:randomUUID(),userId:randomUUID()})});assert.equal(response.status,400);assert.equal(f.calls.length,0);
});
