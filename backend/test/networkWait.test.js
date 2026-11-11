'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {waitForSignal,runScope,deferCleanup}=require('./support/networkWait');
const never=()=>new Promise(()=>{});
test('network wait propagates refused and denied connections with phase and cause',async()=>{
 for(const code of ['ECONNREFUSED','EACCES']){
  const cause=Object.assign(Error('connection failed'),{code});
  await assert.rejects(waitForSignal(never(),Promise.reject(cause),'handler entry'),e=>e.code===code&&e.cause===cause&&e.message.includes('handler entry'));
 }
});
test('missing signal and premature completion fail within a bounded wait',async()=>{
 await assert.rejects(waitForSignal(never(),never(),'missing',{timeoutMs:20}),{code:'TEST_WAIT_TIMEOUT'});
 await assert.rejects(waitForSignal(never(),Promise.resolve(200),'entry'),{code:'TEST_OPERATION_ENDED'});
});
test('signal wins normally and later operation rejection is observed',async()=>{
 let reject;const operation=new Promise((_,r)=>reject=r);
 assert.equal(await waitForSignal(Promise.resolve('entered'),operation,'entry'),'entered');
 reject(Error('later failure'));await new Promise(r=>setImmediate(r));
});
test('scope cleans every resource and preserves primary error plus cleanup failures',async()=>{
 const calls=[],primary=Error('primary');
 await assert.rejects(runScope(async()=>{
  deferCleanup(()=>calls.push('last'));
  deferCleanup(()=>{calls.push('first');throw Error('cleanup')});
  throw primary;
 }),e=>e.cause===primary&&e.errors.includes(primary)&&e.errors.length===2);
 assert.deepEqual(calls,['first','last']);
});
test('cleanup timeout does not prevent remaining cleanup',async()=>{
 let cleaned=false;
 await assert.rejects(runScope(async()=>{deferCleanup(()=>{cleaned=true});deferCleanup(never,20)}),{code:'TEST_WAIT_TIMEOUT'});
 assert(cleaned);
});

test('aborting a wait reports cancellation rather than waiting for the deadline',async()=>{
 const controller=new AbortController();
 const result=waitForSignal(never(),never(),'cancelled',{signal:controller.signal});
 controller.abort(Error('test cancelled'));
 await assert.rejects(result,{code:'TEST_WAIT_ABORTED'});
});
test('refused requests fail child tests and release listening servers without forced exit',()=>{
 const {spawnSync}=require('node:child_process');
 for(const code of ['ECONNREFUSED','EACCES']){
  const source=`
   const {test,waitForSignal,trackServer,listening,deferCleanup}=require('./test/support/networkWait');
   const http=require('node:http'),net=require('node:net');
   test('refused request cleans server',async()=>{
    let entered;const entry=new Promise(r=>entered=r);
    const server=trackServer(http.createServer((q,r)=>{entered();r.end('ok')}));
    server.listen(0,'127.0.0.1');await listening(server);
    const agent=new http.Agent();deferCleanup(()=>agent.destroy());
    agent.createConnection=()=>{const socket=new net.Socket();process.nextTick(()=>socket.destroy(Object.assign(Error('synthetic refusal'),{code:'${code}'})));return socket;};
    const request=http.get({host:'127.0.0.1',port:server.address().port,agent});
    deferCleanup(()=>request.destroy());
    const outcome=new Promise((resolve,reject)=>{request.once('error',reject);request.once('response',resolve)});
    await waitForSignal(entry,outcome,'handler entry');
   });
  `;
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const child=spawnSync(process.execPath,['--test-reporter=tap','-e',source],{env,cwd:require('node:path').resolve(__dirname,'..'),encoding:'utf8',timeout:8000});
  assert.ifError(child.error);assert.equal(child.signal,null);assert.equal(child.status,1);
  assert.match(child.stdout+child.stderr,new RegExp('handler entry: '+code));
 }
});
