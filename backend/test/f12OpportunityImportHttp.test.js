'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const multer=require('multer');
const {createPrivateOpportunityImportRouter,httpStatusForImportError}=require('../src/routes/privateOpportunityImportRoutes');

const context={actor:{organizationId:'11111111-1111-4111-8111-111111111111'}};
const organizationMiddleware={requireServerSession(req,res,next){next();},resolveOrganizationContext(req,res,next){next();},requireOrganizationContext(req,res,next){next();}};

async function withServer(workflow,work){
 const app=express();app.use(express.json());app.use('/',createPrivateOpportunityImportRouter({express,multer,workflow,contextPort:{async resolve(){return context;}},authenticate(req,res,next){next();},organizationMiddleware}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{return await work(`http://127.0.0.1:${server.address().port}`);}finally{await new Promise(resolve=>server.close(resolve));}
}
function workflowWithListError(code){return{async list(){const error=new Error(code);error.code=code;throw error;}};}

test('F12 import HTTP classifies F5 denials separately from technical unavailability',()=>{
 assert.equal(httpStatusForImportError('PERMISSION_NOT_GRANTED'),403);
 assert.equal(httpStatusForImportError('SOD_VIOLATION'),403);
 assert.equal(httpStatusForImportError('PERMISSION_UNKNOWN'),503);
 assert.equal(httpStatusForImportError('AUTH_POLICY_UNKNOWN'),503);
 assert.equal(httpStatusForImportError('POLICY_DATA_UNAVAILABLE'),503);
 assert.equal(httpStatusForImportError('AUDIT_CRITICAL_UNAVAILABLE'),503);
});

test('F12 import HTTP returns 403 for F5 denial and preserves 503 for technical failure',async()=>{
 await withServer(workflowWithListError('PERMISSION_NOT_GRANTED'),async base=>{const response=await fetch(`${base}/`);assert.equal(response.status,403);assert.equal((await response.json()).error.code,'PERMISSION_NOT_GRANTED');});
 await withServer(workflowWithListError('POLICY_DATA_UNAVAILABLE'),async base=>{const response=await fetch(`${base}/`);assert.equal(response.status,503);assert.equal((await response.json()).error.code,'POLICY_DATA_UNAVAILABLE');});
});

test('retired private import rejects upload, preview, confirm and create review before workflow',async()=>{
 let calls=0;const workflow={upload:async()=>{calls++;},preview:async()=>{calls++;},confirm:async()=>{calls++;},review:async()=>{calls++;},cancel:async()=>({cancelled:true})};
 await withServer(workflow,async base=>{
  for(const path of ['/xlsx','/abc/preview','/abc/confirm','/abc/possible/1/review']){
   const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sheetName:'Avisos',decision:'CREATE'})});
   assert.equal(response.status,403);assert.equal((await response.json()).error.code,'OPPORTUNITY_C4G_AUTHORING_ONLY');
  }
  const cancelled=await fetch(base+'/abc/cancel',{method:'POST'});assert.equal(cancelled.status,200);assert.equal((await cancelled.json()).cancelled,true);
 });assert.equal(calls,0);
});
