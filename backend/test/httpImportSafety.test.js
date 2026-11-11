'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Writable}=require('node:stream');
const express=require('express'),multer=require('multer');
const {createPrivateOpportunityImportRouter,ReadableResponse,failure}=require('../src/routes/privateOpportunityImportRoutes');
async function server(workflow,work){
 const next=(req,res,done)=>done(),app=express();app.use(express.json());
 const observed=[];
 app.use('/api/imports',createPrivateOpportunityImportRouter({express,multer,workflow,contextPort:{resolve:async()=>({})},authenticate:next,
  organizationMiddleware:{requireServerSession:next,resolveOrganizationContext:next,requireOrganizationContext:next},onFailure:e=>observed.push(e)}));
 app.use(require('../src/app').createErrorHandler({nodeEnv:'development'}));
 const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));
 try{await work(`http://127.0.0.1:${s.address().port}/api/imports`,observed);}finally{await new Promise(r=>s.close(r));}
}
test('retired private review denies valid and malformed decisions before handler',async()=>{
 let calls=0;await server({review:async()=>{calls++;}},async base=>{
  for(const body of [undefined,'null','[]','{}','{"decision":"CREATE"}','{"decision":"BAD"}','{"decision":"CREATE","sql":"x"}']){
   const r=await fetch(base+'/id/possible/1/review',{method:'POST',...(body?{headers:{'Content-Type':'application/json'},body}:{})});
   // express.json rejects a JSON primitive before the router; all parsed bodies are forbidden.
   assert.equal(r.status,body==='null'?400:403);
   assert.equal((await r.json()).error.code,body==='null'?'INVALID_INPUT':'OPPORTUNITY_C4G_AUTHORING_ONLY');
  }
 });assert.equal(calls,0);
});
test('unexpected errors expose a stable code and emit a safe diagnostic',async()=>{
 await server({list:async()=>{throw Object.assign(new Error('SELECT password FROM secret'),{code:'SQL_SECRET'});}},async(base,observed)=>{
  const r=await fetch(base),body=await r.text();assert.equal(r.status,503);assert(!body.includes('SELECT'));assert(!body.includes('SQL_SECRET'));
  assert.equal(JSON.parse(body).error.code,'IMPORT_UNAVAILABLE');assert.equal(observed.length,1);assert(!JSON.stringify(observed).includes('secret'));
 });
});
test('streaming waits for backpressure and closes after all bytes',async()=>{
 let produced=0,release;const chunks=[];
 const sink=new Writable({highWaterMark:1,write(chunk,encoding,done){chunks.push(chunk.toString());release=done;}});
 const work=ReadableResponse((async function*(){produced++;yield 'a';produced++;yield 'b';})(),sink);
 await new Promise(r=>setImmediate(r));assert.equal(produced,1);release();
 await new Promise(r=>setImmediate(r));assert.equal(produced,2);release();await work;assert.deepEqual(chunks,['a','b']);
});
test('stream failure after first chunk terminates response and never sends JSON',async()=>{
 let destroyed=false;const res={headersSent:true,destroy(){destroyed=true;},status(){assert.fail('JSON after streaming');}};
 failure(new Error('internal'),res,()=>{});assert(destroyed);
 await server({downloadReport:async()=> (async function*(){yield 'header\n';await new Promise(r=>setTimeout(r,10));throw Error('internal');})()},async base=>{
  await assert.rejects(async()=>{const r=await fetch(base+'/id/report');assert.match(r.headers.get('content-type'),/text\/csv/);await r.text();});
 });
});
test('disconnect releases a streaming backpressure wait',async()=>{
 const sink=new Writable({highWaterMark:1,write(){}});
 const work=ReadableResponse((async function*(){yield 'a';yield 'b';})(),sink);
 await new Promise(r=>setImmediate(r));sink.destroy();await assert.rejects(work,{code:'IMPORT_UNAVAILABLE'});
});
test('a report failure before its first byte returns JSON with a safe content type',async()=>{
 await server({downloadReport:async()=> (async function*(){throw Error('secret query');})()},async base=>{
  const r=await fetch(base+'/id/report');assert.equal(r.status,503);assert.match(r.headers.get('content-type'),/application\/json/);
  assert.equal(r.headers.get('content-disposition'),null);assert.equal((await r.json()).error.code,'IMPORT_UNAVAILABLE');
 });
});
