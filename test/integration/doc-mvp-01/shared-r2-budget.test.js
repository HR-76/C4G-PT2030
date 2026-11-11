'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {spawn}=require('node:child_process');
const {startCoordinator,createBudgetClient,replay,KEYS}=require('./shared-r2-budget');
const {instrumentBudgetClient,budgetFetch}=require('./shared-budget-transport');
const zero=Object.fromEntries(KEYS.map(key=>[key,0]));
async function fixture(t,changes={},persist){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'c4g-budget-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const options={journalPath:path.join(root,'synthetic.jsonl'),port:0,tokens:{functional:crypto.randomBytes(32).toString('hex'),cleanup:crypto.randomBytes(32).toString('hex')},baseline:zero,
    limits:{...zero,functionalRequests:10,cleanupRequests:3,applicationBytes:100,objectIntentions:1,completedObjects:1,...changes},source:'SYNTHETIC_TEST_ONLY',persist};
  let server=await startCoordinator(options);t.after(async()=>{if(server)await server.close();});
  const client=phase=>createBudgetClient({port:server.port,token:options.tokens[phase]});
  return {options,client,get server(){return server;},async restart(){const port=server.port;await server.close();server=null;server=await startCoordinator({...options,port});},async stop(){await server.close();server=null;}};
}
function child(f,mode='normal'){return new Promise(resolve=>execFile(process.execPath,[path.join(__dirname,'shared-budget-consumer.js')],{env:{...process.env,PROOF_BUDGET_PORT:String(f.server.port),PROOF_BUDGET_TOKEN:f.options.tokens.functional,PROOF_MODE:mode},timeout:15000,windowsHide:true},(error,stdout)=>resolve({code:error?.code||0,stdout})));}
test('separate consumers cannot exceed the final three reservations; every send has a durable reservation',async t=>{
 const f=await fixture(t,{functionalRequests:3});const results=await Promise.all(Array.from({length:10},()=>child(f)));
 assert.equal(results.filter(r=>r.stdout.includes('SENT')).length,3);assert.equal(f.server.snapshot().budget.functionalRequests,3);
 const state=replay(fs.readFileSync(f.options.journalPath,'utf8'));assert.equal([...state.requests.values()].filter(r=>r.state==='CONFIRMED').length,3);
});
test('consumer death before sending and a lost response retain consumption across restart',async t=>{
 const f=await fixture(t);assert.equal((await child(f,'reserve-only')).code,17);
 await assert.rejects(f.client('functional').perform('GetObject',20,async()=>{throw new Error('SIMULATED_RESPONSE_LOST');}));
 const before=f.server.snapshot();await f.restart();assert.deepEqual(f.server.snapshot(),before);
 assert.equal((await child(f)).code,0);assert.equal(f.server.snapshot().budget.functionalRequests,3);
 assert.equal(f.server.snapshot().budget.applicationBytes,20);
});
test('consumer death after sending leaves STARTED unresolved and charged',async t=>{
 const f=await fixture(t);assert.equal((await child(f,'send-then-die')).code,18);await f.restart();
 const state=replay(fs.readFileSync(f.options.journalPath,'utf8'));assert.equal(state.budget.functionalRequests,1);
 assert.equal([...state.requests.values()][0].state,'STARTED');
});
test('abrupt coordinator death and restart preserve a durable reservation; second owner is refused',async t=>{
 const f=await fixture(t);const port=f.server.port;await f.stop();
 async function daemon(){const proc=spawn(process.execPath,[path.join(__dirname,'shared-budget-daemon.js')],{env:{...process.env,SYNTHETIC_BUDGET_CONFIGURATION:JSON.stringify({...f.options,port})},windowsHide:true,stdio:['ignore','pipe','pipe']});
  const closed=new Promise(resolve=>proc.once('close',resolve));
  const ready=new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>{proc.kill();reject(new Error('daemon timeout'));},5000);proc.stdout.on('data',chunk=>{text+=chunk;if(text.includes('\n')){clearTimeout(timer);resolve(JSON.parse(text));}});proc.once('error',reject);});
  await ready;return{proc,closed};}
 let current=await daemon();t.after(async()=>{current.proc.kill();await current.closed;});
 const b=createBudgetClient({port,token:f.options.tokens.functional}),id=crypto.randomUUID();
 await b.call({action:'reserve',id,operation:'HeadObject',bytes:0});
 await assert.rejects(startCoordinator({...f.options,port}));
 current.proc.kill();await current.closed;current=await daemon();
 assert.equal((await b.snapshot()).budget.functionalRequests,1);
 await assert.rejects(b.call({action:'reserve',id,operation:'HeadObject',bytes:0}),/BUDGET_DUPLICATE_RESERVATION/);
});
test('duplicate reservation and repeated outcomes never authorize another transport',async t=>{
 const f=await fixture(t),client=f.client('functional'),id=crypto.randomUUID();let sent=0;
 await client.perform('HeadObject',0,async()=>sent++,{id});
 await assert.rejects(client.perform('HeadObject',0,async()=>sent++,{id}),/BUDGET_DUPLICATE_RESERVATION/);
 await assert.rejects(client.call({action:'CONFIRMED',id}),/BUDGET_EVENT_ORDER/);assert.equal(sent,1);
});
test('functional exhaustion cannot consume cleanup; cleanup cannot fund readiness or downloads',async t=>{
 const f=await fixture(t,{functionalRequests:0});let sent=0;
 await assert.rejects(f.client('functional').perform('HeadObject',0,async()=>sent++),/BUDGET_EXHAUSTED/);
 await assert.rejects(f.client('cleanup').perform('GetObject',1,async()=>sent++),/BUDGET_FUNCTIONAL_IN_CLEANUP/);
 await f.client('cleanup').perform('HeadObject',0,async()=>sent++);
 assert.equal(sent,1);assert.equal(f.server.snapshot().budget.cleanupRequests,1);
});
test('fsync failure poisons the writer and no transport occurs',async t=>{
 let writes=0;const f=await fixture(t,{},(fd,bytes)=>{if(++writes>1)throw new Error('disk');fs.writeSync(fd,bytes);fs.fsyncSync(fd);});let sent=0;
 await assert.rejects(f.client('functional').perform('HeadObject',0,async()=>sent++),/BUDGET_PERSISTENCE_FAILED/);
 await assert.rejects(f.client('functional').perform('HeadObject',0,async()=>sent++),/BUDGET_UNAVAILABLE/);assert.equal(sent,0);
});
test('incomplete or inconsistent journal refuses restart, never resets counters',async t=>{
 const f=await fixture(t);await f.client('functional').perform('HeadObject',0,async()=>{});const port=f.server.port;await f.stop();
 const bytes=fs.readFileSync(f.options.journalPath,'utf8');fs.writeFileSync(f.options.journalPath,bytes.slice(0,-2));
 await assert.rejects(startCoordinator({...f.options,port}),/BUDGET_JOURNAL_INCOMPLETE/);
 fs.writeFileSync(f.options.journalPath,bytes.replace('"bytes":0','"bytes":1'));
 await assert.rejects(startCoordinator({...f.options,port}),/BUDGET_JOURNAL_INVALID/);
});
test('coordinator unavailable fails before transport; SDK retries and redirects cannot escape',async t=>{
 const f=await fixture(t);const budget=f.client('functional');let sent=0;
 class HeadBucketCommand {constructor(){this.input={};}}
 const raw={config:{maxAttempts:async()=>1},async send(){sent++;return{};}};
 await instrumentBudgetClient(raw,budget).send(new HeadBucketCommand());
 await budgetFetch(budget,async(url,options)=>{assert.equal(options.redirect,'error');sent++;return{status:200};},'https://synthetic.invalid/object',{origin:'https://synthetic.invalid',expectedBytes:10});
 await assert.rejects(instrumentBudgetClient({...raw,config:{maxAttempts:2}},budget).send(new HeadBucketCommand()),/BUDGET_RETRIES_FORBIDDEN/);
 assert.equal(sent,2);await f.stop();await assert.rejects(budget.perform('HeadObject',0,async()=>sent++),/BUDGET_UNAVAILABLE/);assert.equal(sent,2);
});
test('cardinalities and byte limits survive restart; artifacts exclude credentials and URLs',async t=>{
 const f=await fixture(t,{applicationBytes:5});const b=f.client('functional'),objectId=crypto.randomUUID();
 await b.perform('OBJECT_INTENT',0,async()=>{},{objectId});await b.perform('PutObject',5,async()=>{},{objectId});
 await assert.rejects(b.perform('GetObject',1,async()=>{}),/BUDGET_EXHAUSTED/);await f.restart();
 assert.equal(f.server.snapshot().budget.completedObjects,1);
 await assert.rejects(f.client('functional').perform('OBJECT_INTENT',0,async()=>{},{objectId:crypto.randomUUID()}),/BUDGET_EXHAUSTED/);
 const text=fs.readFileSync(f.options.journalPath,'utf8');assert(!text.includes(f.options.tokens.functional));assert(!text.includes('https://'));assert(!text.includes('authorization'));
});
