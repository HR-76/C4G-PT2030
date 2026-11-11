'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const {fork}=require('node:child_process');

const child=path.resolve(__dirname,'fixtures/documentWorkerLifecycleChild.js');
function run(mode,statePath){return new Promise((resolve,reject)=>{const processChild=fork(child,[],{env:{...process.env,C4G_DOCUMENT_LIFECYCLE_MODE:mode,C4G_DOCUMENT_LIFECYCLE_STATE:statePath},stdio:['ignore','ignore','ignore','ipc']});let signalled=false;const timer=setTimeout(()=>{processChild.kill();reject(new Error(`Lifecycle child timeout: ${mode}`));},5000);processChild.on('message',message=>{if(message.type==='ERROR'){clearTimeout(timer);reject(new Error(message.code));return;}if(!signalled&&((mode==='empty'&&message.type==='READY')||(mode!=='empty'&&message.type==='JOB_STARTED'))){signalled=true;processChild.send({type:'STOP'});}if(message.type==='SHUTDOWN'){clearTimeout(timer);resolve(message);}});processChild.on('error',error=>{clearTimeout(timer);reject(error);});processChild.on('exit',code=>{if(code&&code!==0){clearTimeout(timer);reject(new Error(`Lifecycle child exited ${code}`));}});});}
function crash(statePath){return new Promise((resolve,reject)=>{const processChild=fork(child,[],{env:{...process.env,C4G_DOCUMENT_LIFECYCLE_MODE:'abrupt',C4G_DOCUMENT_LIFECYCLE_STATE:statePath},stdio:['ignore','ignore','ignore','ipc']});const timer=setTimeout(()=>{processChild.kill();reject(new Error('Abrupt lifecycle child timeout'));},5000);processChild.on('message',message=>{if(message.type==='JOB_STARTED')processChild.kill();});processChild.on('error',error=>{clearTimeout(timer);reject(error);});processChild.on('exit',()=>{clearTimeout(timer);resolve(JSON.parse(fs.readFileSync(statePath,'utf8')));});});}

test('document entrypoint process handles empty, graceful, forced and abrupt shutdown then recovers durable state',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'c4g-document-lifecycle-'));
 try{
  const empty=await run('empty',path.join(directory,'empty.json'));assert.equal(empty.state.effects,0);
  const graceful=await run('graceful',path.join(directory,'graceful.json'));assert.equal(graceful.state.inbox,'COMPLETED');assert.equal(graceful.state.effects,1);assert.equal(graceful.state.retries,0);
  const recoveryPath=path.join(directory,'recovery.json');const forced=await run('forced',recoveryPath);assert.equal(forced.state.inbox,'UNCERTAIN');assert.equal(forced.state.effects,0);assert.equal(forced.state.retries,1);
  const recovered=await run('recovery',recoveryPath);assert.equal(recovered.state.inbox,'COMPLETED');assert.equal(recovered.state.effects,1);assert.equal(recovered.state.retries,1);assert.ok(recovered.state.fence>forced.state.fence);
  const abruptPath=path.join(directory,'abrupt.json'),abrupt=await crash(abruptPath);assert.equal(abrupt.inbox,'PROCESSING');assert.equal(abrupt.effects,0);assert.equal(abrupt.retries,0);
  const afterCrash=await run('recovery',abruptPath);assert.equal(afterCrash.state.inbox,'COMPLETED');assert.equal(afterCrash.state.effects,1);assert.ok(afterCrash.state.fence>abrupt.fence);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
