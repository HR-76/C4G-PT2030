'use strict';
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {StringDecoder}=require('node:string_decoder');

const DEFAULT_CAPTURE_BYTES=64*1024;
const DEFAULT_STREAM_BYTES=8*1024*1024;

class ChildProcessFailure extends Error{
 constructor(code,message,details={}){super(message);this.name='ChildProcessFailure';this.code=code;this.details=Object.freeze({...details});}
}

function appendTail(current,chunk,limit){
 const combined=Buffer.concat([Buffer.from(current),Buffer.from(chunk)]);
 return combined.subarray(Math.max(0,combined.length-limit)).toString('utf8');
}

function createManagedChild({label,file,args=[],env,controlPath,spawnProcess=spawn,stopWriter,readyTimeoutMs=15000,shutdownTimeoutMs=10000,maxCaptureBytes=DEFAULT_CAPTURE_BYTES,maxStreamBytes=DEFAULT_STREAM_BYTES,maxLineBytes=DEFAULT_CAPTURE_BYTES}){
 let proc;
 try{
  proc=spawnProcess(process.execPath,[file,...args],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 }catch(error){
  throw new ChildProcessFailure('CHILD_SPAWN_ERROR',`${label} could not be spawned.`,{cause:error?.code||error?.message||String(error)});
 }
 let phase='WAITING_READY',readySettled=false,readyResolve,readyReject,shutdownReceived=false,shutdown=null,stderrTail='',stdoutTail='',pending='',exitCode=null,exitSignal=null,spawnError=null,terminalFailure=null,stdoutBytes=0,stderrBytes=0,closed=false;
 const decoder=new StringDecoder('utf8');
 const diagnostic=()=>Object.freeze({label,pid:proc.pid||null,phase,exitCode,signal:exitSignal,killed:Boolean(proc.killed),stdoutBytes,stderrBytes,stderr:stderrTail.slice(-2000)});
 const terminateFor=(failure)=>{if(terminalFailure)return;terminalFailure=failure;phase=failure.code;try{proc.kill();}catch{}}
 const processLine=(line)=>{
  if(!line)return;
  stdoutTail=appendTail(stdoutTail,`${line}\n`,maxCaptureBytes);
  let message;try{message=JSON.parse(line);}catch{return;}
  if(message.type==='READY'&&!readySettled){readySettled=true;phase='READY';clearTimeout(readyTimer);readyResolve(message.readiness);}
  else if(message.type==='SHUTDOWN'){shutdownReceived=true;shutdown=message.result;}
 };
 const processPending=(final=false)=>{
  for(let newline;(newline=pending.indexOf('\n'))!==-1;){const line=pending.slice(0,newline).replace(/\r$/,'');pending=pending.slice(newline+1);processLine(line);}
  if(Buffer.byteLength(pending)>maxLineBytes)terminateFor(new ChildProcessFailure('CHILD_OUTPUT_LIMIT',`${label} stdout line exceeded ${maxLineBytes} bytes.`,diagnostic()));
  if(final&&pending){processLine(pending.replace(/\r$/,''));pending='';}
 };
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const readyTimer=setTimeout(()=>terminateFor(new ChildProcessFailure('CHILD_READY_TIMEOUT',`${label} readiness timed out.`,diagnostic())),readyTimeoutMs);
 proc.stdout.on('data',chunk=>{stdoutBytes+=chunk.length;pending+=decoder.write(chunk);if(stdoutBytes>maxStreamBytes)terminateFor(new ChildProcessFailure('CHILD_OUTPUT_LIMIT',`${label} stdout exceeded ${maxStreamBytes} bytes.`,diagnostic()));processPending();});
 proc.stderr.on('data',chunk=>{stderrBytes+=chunk.length;stderrTail=appendTail(stderrTail,chunk,maxCaptureBytes);if(stderrBytes>maxStreamBytes)terminateFor(new ChildProcessFailure('CHILD_OUTPUT_LIMIT',`${label} stderr exceeded ${maxStreamBytes} bytes.`,diagnostic()));});
 proc.once('error',error=>{spawnError=error;terminateFor(new ChildProcessFailure('CHILD_SPAWN_ERROR',`${label} spawn failed.`,{...diagnostic(),cause:error?.code||error?.message||String(error)}));});
 proc.once('exit',(code,signal)=>{exitCode=code;exitSignal=signal;});
 let closeResolve;
 const closePromise=new Promise(resolve=>{closeResolve=resolve;});
 proc.once('close',(code,signal)=>{
  clearTimeout(readyTimer);exitCode=code;exitSignal=signal;pending+=decoder.end();processPending(true);closed=true;const closePhase=phase;phase='CLOSED';
  const result=Object.freeze({code:exitCode,signal:exitSignal,shutdownReceived,shutdown,phase:closePhase,pid:proc.pid||null,stdoutBytes,stderrBytes,stdout:stdoutTail,stderr:stderrTail});
  if(!readySettled){readySettled=true;readyReject(terminalFailure||new ChildProcessFailure(spawnError?'CHILD_SPAWN_ERROR':'CHILD_READY_MISSING',`${label} closed before readiness.`,result));}
  closeResolve(result);
 });
 async function awaitClose(timeoutMs,timeoutCode){
  if(closed)return closePromise;
  let timer;
  const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve('TIMEOUT'),timeoutMs);});
  const outcome=await Promise.race([closePromise,timeout]);
  if(outcome!=='TIMEOUT'){clearTimeout(timer);return outcome;}
  const failure=new ChildProcessFailure(timeoutCode,`${label} did not close within ${timeoutMs}ms.`,diagnostic());terminateFor(failure);
  const result=await closePromise;throw new ChildProcessFailure(timeoutCode,failure.message,result);
 }
 function validateGraceful(result){
  if(terminalFailure)throw new ChildProcessFailure(terminalFailure.code,terminalFailure.message,result);
  if(spawnError)throw new ChildProcessFailure('CHILD_SPAWN_ERROR',`${label} spawn failed.`,result);
  if(result.signal!==null)throw new ChildProcessFailure('CHILD_SIGNAL',`${label} terminated by signal ${result.signal}.`,result);
  if(result.code===null)throw new ChildProcessFailure('CHILD_EXIT_UNKNOWN',`${label} closed without an exit code.`,result);
  if(result.code!==0)throw new ChildProcessFailure('CHILD_NONZERO_EXIT',`${label} exited with code ${result.code}.`,result);
  if(!result.shutdownReceived)throw new ChildProcessFailure('CHILD_SHUTDOWN_MISSING',`${label} closed without a SHUTDOWN message.`,result);
  return result;
 }
 return Object.freeze({proc,ready,errors:()=>stderrTail,snapshot:diagnostic,
  async stop(){phase='GRACEFUL_STOP_REQUESTED';try{(stopWriter||(()=>fs.writeFileSync(controlPath,'STOP\n',{flag:'wx'})))();}catch(error){throw new ChildProcessFailure('CHILD_STOP_REQUEST_ERROR',`${label} stop request failed.`,{...diagnostic(),cause:error?.code||error?.message||String(error)});}return validateGraceful(await awaitClose(shutdownTimeoutMs,'CHILD_SHUTDOWN_TIMEOUT'));},
  async crash(){phase='ABRUPT_TERMINATION_REQUESTED';let delivered=false;try{delivered=proc.kill();}catch(error){throw new ChildProcessFailure('CHILD_SIGNAL_ERROR',`${label} abrupt termination failed.`,{...diagnostic(),cause:error?.code||error?.message||String(error)});}if(!delivered)throw new ChildProcessFailure('CHILD_SIGNAL_ERROR',`${label} abrupt termination was not delivered.`,diagnostic());const result=await awaitClose(shutdownTimeoutMs,'CHILD_ABRUPT_TIMEOUT');if(result.signal===null&&result.code===0)throw new ChildProcessFailure('CHILD_ABRUPT_NOT_OBSERVED',`${label} ended normally after an abrupt termination request.`,result);return result;}
 });
}

module.exports=Object.freeze({ChildProcessFailure,createManagedChild});
