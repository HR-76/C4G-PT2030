'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),https=require('node:https'),fs=require('node:fs'),crypto=require('node:crypto');
const {readDownload,ERROR_LIMIT}=require('./download-response');
test('bounded download diagnostics preserve metadata before body and never expose raw errors',async t=>{
 const body=Buffer.from('exact synthetic document'),digest=crypto.createHash('sha256').update(body).digest('hex');let mode='valid';
 const server=https.createServer({cert:fs.readFileSync('.tmp/f2-integration/localhost.crt'),key:fs.readFileSync('.tmp/f2-integration/localhost.key')},(req,res)=>{
  res.setHeader('x-amz-request-id','synthetic-request-1');
  if(['large-error','limit-error','precondition'].includes(mode)){const content=`<Error><Code>${mode==='precondition'?'PreconditionFailed':'SignatureDoesNotMatch'}</Code><Message>secret-fixture-do-not-log</Message><Padding>${'x'.repeat(mode==='limit-error'?6000:1000)}</Padding></Error>`;res.writeHead(mode==='precondition'?412:403,{'Content-Type':'application/xml','Content-Length':Buffer.byteLength(content)});res.end(content);return;}
  if(mode==='wrong-media'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');return;}
  res.setHeader('Content-Type','application/octet-stream');
  if(mode!=='no-length'&&mode!=='short')res.setHeader('Content-Length',mode==='wrong-length'?body.length+1:body.length);
  if(mode==='interrupted'){res.write(body.subarray(0,3));setTimeout(()=>res.destroy(),20);return;}
  if(mode==='short'){res.write(body.subarray(0,3));res.end();return;}
  res.write(body);res.end();
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`https://localhost:${server.address().port}/object`;
 const run=async(value,expectedCode)=>{mode=value;const events=[];let result,error;try{result=await readDownload(url,{expectedBytes:body.length,expectedSha256:digest,record:e=>events.push(e)});}catch(e){error=e;}
  assert.equal(events[0].kind,'DOWNLOAD_HTTP_HEADERS');assert.equal(events[0].observedBytes,0);assert.equal(events[0].requestIds['x-amz-request-id'],'synthetic-request-1');assert(!JSON.stringify(events).includes('secret-fixture'));assert(!JSON.stringify(events).includes(url));
  if(expectedCode)assert.equal(error?.code,expectedCode);else{assert.ifError(error);assert.deepEqual(result.body,body);}return{events,result,error};};
 try{
  await t.test('valid exact bytes and SHA256',()=>run('valid'));
  await t.test('absent Content-Length still requires exact final bytes',async()=>{const r=await run('no-length');assert.equal(r.result.diagnostic.contentLength,null);assert.equal(r.result.diagnostic.totalBytes,body.length);});
  await t.test('error larger than document retains safe code and HTTP status',async()=>{const r=await run('large-error','DOWNLOAD_HTTP_REJECTED');assert.equal(r.error.diagnostic.status,403);assert.equal(r.error.diagnostic.provider.code,'SignatureDoesNotMatch');assert(r.error.diagnostic.totalBytes>body.length);});
  await t.test('error diagnostic limit preserves observed bytes but total stays unknown',async()=>{const r=await run('limit-error','DOWNLOAD_DIAGNOSTIC_LIMIT');assert.equal(r.error.diagnostic.diagnosticBytes,ERROR_LIMIT);assert.equal(r.error.diagnostic.totalBytes,null);assert.equal(r.error.diagnostic.bodyComplete,false);assert.equal(r.error.diagnostic.status,403);});
  await t.test('precondition failure distinguished',async()=>{const r=await run('precondition','DOWNLOAD_HTTP_REJECTED');assert.equal(r.error.diagnostic.status,412);assert.equal(r.error.diagnostic.provider.code,'PreconditionFailed');});
  await t.test('wrong declared length rejected before consuming body',()=>run('wrong-length','DOWNLOAD_DECLARED_LENGTH_MISMATCH'));
  await t.test('interrupted stream has unknown total',async()=>{const r=await run('interrupted','DOWNLOAD_BODY_INTERRUPTED');assert.equal(r.error.diagnostic.observedBytes,3);assert.equal(r.error.diagnostic.totalBytes,null);});
  await t.test('complete but short stream rejected',()=>run('short','DOWNLOAD_LENGTH_MISMATCH'));
  await t.test('error JSON with200 is never a document',()=>run('wrong-media','DOWNLOAD_ERROR_MEDIA'));
  await t.test('digest mismatch rejected',async()=>{mode='valid';await assert.rejects(readDownload(url,{expectedBytes:body.length,expectedSha256:'0'.repeat(64)}),{code:'DOWNLOAD_DIGEST_MISMATCH'});});
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
