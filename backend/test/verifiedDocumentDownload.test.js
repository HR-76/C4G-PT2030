'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Readable}=require('node:stream');
const {createDownloadStaging}=require('../src/documents/downloadStaging');
const {createApplicationDocumentTransport}=require('../src/documents/applicationTransport');
const {createApplicationSliceRouter}=require('../src/routes/applicationSliceRoutes');
const express=require('express');
const bytes=Buffer.from('synthetic verified document'),sha=crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t,options={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'c4g-download-test-')),stage=createDownloadStaging({directory,...options});
 t.after(()=>{stage.close();fs.rmSync(directory,{recursive:true,force:true})});
 return {directory,stage};
}
const request=(storage,signal)=>({storage,objectId:'object',storageClass:'QUARANTINE',size:bytes.length,sha256:sha,signal});
const storage=()=>({head:async()=>({size:bytes.length,etag:'opaque'}),readRange:async({etag})=>{assert.equal(etag,'opaque');return Readable.from([bytes])}});
test('restart recovers only owned residual files after abrupt process exit',async t=>{
 const {spawn}=require('node:child_process'),{once}=require('node:events');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'c4g-download-crash-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const script=`const {createDownloadStaging}=require(${JSON.stringify(require.resolve('../src/documents/downloadStaging'))});const {Readable}=require('node:stream');const b=Buffer.from('x');const s=createDownloadStaging({directory:process.env.PROOF_DIR});s.prepare({storage:{head:async()=>({size:1,etag:'e'}),readRange:async()=>Readable.from([b])},objectId:'o',size:1,sha256:require('node:crypto').createHash('sha256').update(b).digest('hex')}).then(()=>process.exit(17));`;
 const child=spawn(process.execPath,['-e',script],{env:{...process.env,PROOF_DIR:directory},stdio:'ignore',windowsHide:true});
 assert.equal((await once(child,'close'))[0],17);
 assert.equal(fs.readdirSync(directory).filter(x=>x.endsWith('.part')).length,1);
 fs.writeFileSync(path.join(directory,'unrelated.txt'),'preserve');
 const stage=createDownloadStaging({directory});const value=await stage.prepare(request(storage()));await value.dispose();stage.close();
 assert.deepEqual(fs.readdirSync(directory),['unrelated.txt']);
});
test('staging validates exact bytes, bounds resources and cleans failures',async t=>{
 const {directory,stage}=fixture(t,{maxConcurrent:1,maxBytes:bytes.length});
 const good=await stage.prepare(request(storage()));assert.equal(fs.readdirSync(directory).filter(x=>x.endsWith('.part')).length,1);
 assert.equal(fs.statSync(path.join(directory,fs.readdirSync(directory).find(x=>x.endsWith('.part')))).size,bytes.length);
 await assert.rejects(stage.prepare(request(storage())));await good.dispose();assert.deepEqual(stage.snapshot(),{active:0,reserved:0});
 for(const variant of [
  {...storage(),readRange:async()=>{throw Error('PRECONDITION_FAILED')}},
  {...storage(),readRange:async()=>Readable.from([Buffer.alloc(bytes.length)])},
  {...storage(),readRange:async()=>Readable.from([bytes.subarray(1)])},
  {...storage(),readRange:async()=>Readable.from([Buffer.concat([bytes,bytes])])},
  {...storage(),head:async()=>({size:1,etag:'opaque'})}
 ]){await assert.rejects(stage.prepare(request(variant)));assert.deepEqual(stage.snapshot(),{active:0,reserved:0});}
 assert.equal(fs.readdirSync(directory).filter(x=>x.endsWith('.part')).length,0);
 await assert.rejects(stage.prepare({...request(storage()),size:101*1024*1024}));
});
test('capacity and physical free space fail closed',async t=>{
 const {stage}=fixture(t,{freeBytes:()=>0});await assert.rejects(stage.prepare(request(storage())));assert.equal(stage.snapshot().active,0);
 const other=fixture(t,{maxBytes:bytes.length-1});await assert.rejects(other.stage.prepare(request(storage())));
});
test('abort destroys the in-flight source and leaves no staged bytes',async t=>{
 const {stage,directory}=fixture(t),controller=new AbortController();let destroyed=false,started;
 const ready=new Promise(r=>started=r);
 const pending=stage.prepare(request({...storage(),readRange:async()=>{const source=new Readable({read(){started()},destroy(e,cb){destroyed=true;cb(e)}});return source}},controller.signal));
 await ready;controller.abort();await assert.rejects(pending);assert.equal(destroyed,true);assert.equal(stage.snapshot().active,0);assert.equal(fs.readdirSync(directory).filter(x=>x.endsWith('.part')).length,0);
});
test('real transport and HTTP route withhold success until verification and final authorization',async t=>{
 const {stage}=fixture(t);let mode='good',lookups=0,reads=0,authorizations=0,disposed=0;
 const row={state:'AVAILABLE',scan_state:'CLEAN',confirmed_at:new Date(),object_id:'object',observed_size:bytes.length,sha256:sha,display_filename:'../../evil\r\n".pdf'};
 const source={head:async()=>({size:bytes.length,etag:'opaque'}),readRange:async()=>{reads++;if(mode==='precondition')throw Error('PRECONDITION_FAILED');return Readable.from([mode==='digest'?Buffer.alloc(bytes.length):bytes])}};
 const audit=require('../src/documents/audit').createDocumentAuditPort({accept:async event=>{assert.equal(event.eventCode,'DOCUMENT_ALLOWED');return{status:'ACCEPTED'}}});
 const transport=createApplicationDocumentTransport({accessPort:{},repositoryFactory:()=>({findVersion:async()=>{lookups++;return mode==='unavailable'&&lookups>1?{...row,state:'QUARANTINED'}:row}}),storageFactory:()=>source,auditFactory:()=>audit,reconciliationFactory:()=>({}),jobs:{},clock:()=>new Date(),downloadStaging:stage});
 const next=(req,res,done)=>done(),app=express();
 app.use(createApplicationSliceRouter({express,authenticate:next,organizationMiddleware:{requireServerSession:next,resolveOrganizationContext:next,requireOrganizationContext:next},service:{execute:async()=>{
  authorizations++;if(mode==='foreign'||mode==='revoked'&&authorizations>=3)throw Object.assign(Error(),{code:'NOT_AUTHORIZED'});
  return {organizationId:'A',versionId:'v'};
 }},documentAccessPort:{download:async input=>{const value=await transport.download(input);return {...value,dispose:async()=>{disposed++;await value.dispose()}}}}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r))});
 const url=`http://127.0.0.1:${server.address().port}/a/documents/versions/v/download`;
 const good=await fetch(url);assert.equal(good.status,200);assert.equal(good.headers.get('location'),null);assert.equal(good.headers.get('accept-ranges'),'none');assert.match(good.headers.get('content-disposition'),/^attachment/);assert(!/[\r\n]/.test(good.headers.get('content-disposition')));assert.deepEqual(Buffer.from(await good.arrayBuffer()),bytes);
 for(mode of ['digest','precondition','revoked','unavailable','foreign']){
  lookups=0;reads=0;authorizations=0;const response=await fetch(url);assert(response.status>=400);assert.equal(response.headers.get('content-disposition'),null);const body=await response.text();assert(!body.includes(bytes.toString()));
  if(mode==='foreign'){assert.equal(lookups,0);assert.equal(reads,0)}
 }
 mode='good';assert.equal((await fetch(url,{headers:{Range:'bytes=0-1'}})).status,416);
 assert.equal(stage.snapshot().active,0);assert(disposed>=1);
});
