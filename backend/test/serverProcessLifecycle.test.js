'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{fork,spawn}=require('node:child_process'),http=require('node:http');
const childFile=path.join(__dirname,'fixtures/apiLifecycleChild.js');
function child(fail=false){
 const processChild=fork(childFile,[],{env:{...process.env,AV01_FAIL:fail?'readiness':''},silent:true,windowsHide:true});
 const messages=[];let outputBytes=0;
 for(const stream of [processChild.stdout,processChild.stderr])stream.on('data',data=>{outputBytes+=data.length;if(outputBytes>65536)processChild.kill('SIGKILL');});
 let announce;const ready=new Promise(resolve=>announce=resolve);processChild.on('message',message=>{messages.push(message);if(message.kind==='READY')announce(message);});
 const closed=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{processChild.kill('SIGKILL');reject(Error('EXCLUSIVE_CHILD_TIMEOUT'));},5000);processChild.once('error',error=>{clearTimeout(timeout);reject(error);});processChild.once('close',(code,signal)=>{clearTimeout(timeout);resolve({code,signal,messages,outputBytes});});});
 return {processChild,ready,closed};
}
test('separate process receives STOP, drains real HTTP and exits after SHUTDOWN',async()=>{
 const c=child();const first=await Promise.race([c.ready,c.closed.then(()=>{throw Error('EXITED_BEFORE_READY');})]);
 const status=await new Promise((resolve,reject)=>{const req=http.get({host:'127.0.0.1',port:first.port,path:'/health/live'},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});req.once('error',reject);});assert.equal(status,200);
 c.processChild.send('STOP');const result=await c.closed;assert.equal(result.code,0);assert.equal(result.signal,null);
 assert.deepEqual(result.messages.at(-1),{kind:'SHUTDOWN',result:{status:'CLOSED'},events:['lifecycle-stop','runtime-close']});
});
test('separate process readiness failure closes resources and exits nonzero',async()=>{
 const result=await child(true).closed;assert.equal(result.code,1);assert.equal(result.signal,null);assert.deepEqual(result.messages,[{kind:'START_FAILED',events:['runtime-close']}]);
});
test('normal product entrypoint rejects invalid runtime configuration before startup',async()=>{
 const c=spawn(process.execPath,[path.join(__dirname,'../src/server.js')],{env:{...process.env,AUTH_MODE:'disabled',NODE_ENV:'test'},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let error='';c.stdout.resume();c.stderr.on('data',chunk=>{error+=chunk;if(error.length>4096)c.kill('SIGKILL');});
 const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{c.kill('SIGKILL');reject(Error('ENTRYPOINT_TIMEOUT'));},5000);c.once('error',reject);c.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});});
 assert.equal(result.code,1);assert.equal(result.signal,null);assert.equal(error.trim(),'C4G_API_CONFIG_INVALID');
});
