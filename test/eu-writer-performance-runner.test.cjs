'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseArgs,validateReadinessProof,resolveEvidenceDirectory,runOwnedChild}=require('./integration/eu-writer-performance/run.cjs');
const {assertOwned,validateDockerEndpoint,createBudget,cleanupResources}=require('./integration/eu-writer-performance/infra.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
test('readiness is explicit and distinct from load, with manifest and TLS required',()=>{
 assert.throws(()=>parseArgs([]));assert.throws(()=>parseArgs(['--readiness']));
 const args=['--isolated','--readiness','--manifest','trial.json','--tls-dir','certs'];assert.equal(parseArgs(args).mode,'readiness');
 assert.throws(()=>parseArgs([...args,'--measure-http']));assert.throws(()=>parseArgs([...args,'--unknown']));
 assert.throws(()=>parseArgs(['--isolated','--measure-http','--manifest','trial.json','--tls-dir','certs']));
});
test('resource ownership requires exact id, name, label and loopback published ports',()=>{
 const id='a'.repeat(64),runId='b'.repeat(32),name='c4g-eu-trial-pg-'+runId;
 const record={Id:id,Name:'/'+name,Config:{Labels:{'c4g.eu-trial':runId}},NetworkSettings:{Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'49152'}]}}};
 assert.doesNotThrow(()=>assertOwned(record,{id,name,runId}));
 for(const bad of [{...record,Id:'c'.repeat(64)},{...record,Name:'/foreign'},{...record,Config:{Labels:{}}},{...record,NetworkSettings:{Ports:{'5432/tcp':[{HostIp:'0.0.0.0',HostPort:'49152'}]}}}])assert.throws(()=>assertOwned(bad,{id,name,runId}));
});
test('Docker remote endpoints are refused before resource creation',()=>{
 assert.doesNotThrow(()=>validateDockerEndpoint('npipe:////./pipe/dockerDesktopLinuxEngine'));
 assert.doesNotThrow(()=>validateDockerEndpoint('unix:///var/run/docker.sock'));
 assert.throws(()=>validateDockerEndpoint('tcp://127.0.0.1:2375'));
});

test('control budgets bound each external command by remaining time and refuse work after expiry',()=>{
 let now=100;const budget=createBudget(1000,{now:()=>now});assert.equal(budget.remaining(),1000);now=850;assert.equal(budget.commandTimeout(30000),250);now=1100;assert.throws(()=>budget.check(),{code:'CONTROL_DEADLINE_EXCEEDED'});
});

test('cleanup records failure and still attempts every exact owned resource',async()=>{
 const runId='b'.repeat(32),owned=[{id:'1'.repeat(64),name:'one',runId},{id:'2'.repeat(64),name:'two',runId}],calls=[];
 const result=await cleanupResources({attempted:owned,owned,runId,dockerCall:async args=>{calls.push(args);if(args[0]==='inspect'){if(args[1]===owned[1].id)throw Error('synthetic failure');const item=owned[0];return JSON.stringify([{Id:item.id,Name:'/'+item.name,Config:{Labels:{'c4g.eu-trial':runId}},NetworkSettings:{Ports:{}}}]);}return '';}});
 assert.equal(result.status,'FAIL');assert.equal(result.resources.length,2);assert(calls.some(a=>a[0]==='rm'&&a.includes(owned[0].id)));assert.equal(result.resources.filter(r=>r.removed).length,1);
});

test('load proof requires both functional revisions, matching identity and successful cleanup, also for child callers',()=>{
 const identity={id:'trial',sourceSetDigest:'sources',manifestSha256:'manifest'},images={postgres:{id:'pg'},keycloak:{id:'kc'}},seedDigest='seed';
 const prior={status:'PASS',mode:'readiness',trialId:identity.id,sourceSetDigest:identity.sourceSetDigest,manifestSha256:identity.manifestSha256,seedDigest,images,cleanup:true,sourceIntegrityAfter:'PASS',stages:['043','042'].map(stage=>({stage,status:'PASS',cleanup:{status:'PASS'},result:{status:'PASS',mode:'readiness',stage,trialId:identity.id,sourceSetDigest:identity.sourceSetDigest,manifestSha256:identity.manifestSha256,seedDigest,cleanup:true,sourceIntegrityAfter:'PASS',metadata:{status:'PASS'},metadataDrift:{status:'PASS'},...(stage==='043'?{httpReadiness:{status:'PASS'}}:{})}}))};
 assert.doesNotThrow(()=>validateReadinessProof(prior,identity,seedDigest,images));
 for(const mutate of [p=>{p.stages.pop();},p=>{p.stages[0].result.manifestSha256='other';},p=>{p.stages[1].cleanup.status='FAIL';},p=>{p.stages[0].result.httpReadiness.status='FAIL';}]){const altered=structuredClone(prior);mutate(altered);assert.throws(()=>validateReadinessProof(altered,identity,seedDigest,images));}
});

test('evidence directory rejects an escaping junction before creating a run directory',t=>{
 const base=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'c4g-trial-evidence-')),outside=fs.mkdtempSync(path.join(base,'c4g-trial-outside-'));
 t.after(()=>{for(const target of [root,outside]){assert.equal(path.dirname(fs.realpathSync(target)),base);fs.rmSync(target,{recursive:true,force:true});}});
 fs.symlinkSync(outside,path.join(root,'evidence'),process.platform==='win32'?'junction':'dir');assert.throws(()=>resolveEvidenceDirectory(root,'a'.repeat(32)),{code:'EVIDENCE_PATH_ESCAPE'});assert.deepEqual(fs.readdirSync(outside),[]);
});

test('owned child deadline terminates only the process actually spawned and waits for its exit',async()=>{
 let killed;const processObject=new EventEmitter();Object.assign(processObject,{pid:78901,exitCode:null,signalCode:null,stdout:new PassThrough(),stderr:new PassThrough()});
 const started=Date.now();await assert.rejects(runOwnedChild('node',['synthetic'],{env:{},cwd:'.',timeoutMs:5},{platform:'win32',spawnProcess:()=>processObject,killTree:async owned=>{killed=owned.pid;processObject.signalCode='SIGTERM';processObject.emit('exit',null,'SIGTERM');processObject.emit('close',null,'SIGTERM');}}),{code:'CONTROL_DEADLINE_EXCEEDED'});
 assert.equal(killed,78901);assert(Date.now()-started<1000);
});

test('completed child is not terminated; unsupported process-tree platform is refused before spawning',async()=>{
 const child=new EventEmitter();Object.assign(child,{pid:78902,exitCode:null,signalCode:null,stdout:new PassThrough(),stderr:new PassThrough()});let killed=0;
 const result=runOwnedChild('node',[],{env:{},cwd:'.',timeoutMs:1000},{platform:'win32',spawnProcess:()=>{setImmediate(()=>{child.stdout.write('PASS');child.exitCode=0;child.emit('exit',0,null);child.emit('close',0,null);});return child;},killTree:async()=>{killed++;}});
 assert.equal((await result).stdout,'PASS');assert.equal(killed,0);assert.throws(()=>runOwnedChild('node',[],{timeoutMs:10},{platform:'linux',spawnProcess:()=>{throw Error('must not spawn');}}),{code:'WINDOWS_OWNED_PROCESS_TREE_REQUIRED'});
});
