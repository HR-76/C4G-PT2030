'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {main}=require('../../src/documentWorker');
const control=path.resolve(String(process.env.DOCUMENT_WORKER_TEST_CONTROL_PATH||''));
function installShutdownControl({runtime,controlPath=control,writer=value=>process.stdout.write(value),fsPort=fs,scheduler={setInterval,clearInterval},intervalMs=25}){
 let stopping=false,timer;
 timer=scheduler.setInterval(async()=>{if(stopping||!fsPort.existsSync(controlPath))return;const command=fsPort.readFileSync(controlPath,'utf8').trim();if(command!=='STOP')return;stopping=true;try{const result=await runtime.shutdown();writer(`${JSON.stringify({type:'SHUTDOWN',result})}\n`);process.exitCode=result?.errorCode?1:0;}catch(error){process.stderr.write(`${JSON.stringify({type:'ERROR',code:error?.code||error?.message||'SHUTDOWN_FAILURE'})}\n`);process.exitCode=1;}finally{scheduler.clearInterval(timer);}},intervalMs);
 return timer;
}
if(require.main===module){
 if(process.env.NODE_ENV!=='test'||!path.isAbsolute(control))throw new Error('DOCUMENT_WORKER_TEST_CONTROL_INVALID');
 let readiness;
 main({onReady:value=>{readiness=value;}}).then(runtime=>{installShutdownControl({runtime});process.stdout.write(`${JSON.stringify({type:'READY',readiness})}\n`);}).catch(error=>{process.stderr.write(`${JSON.stringify({type:'ERROR',code:error?.code||error?.message,internalCode:error?.internalCode||null,stack:error?.stack?.split('\n').slice(0,8)})}\n`);process.exitCode=1;});
}
module.exports=Object.freeze({installShutdownControl});
