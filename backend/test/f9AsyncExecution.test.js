const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const test=require('node:test');const crypto=require('node:crypto');
const {createEnvelope,validateEnvelope,MAX_BYTES}=require('../src/async/envelope');
const {createJobRegistry}=require('../src/async/jobRegistry');
const {result,classify}=require('../src/async/jobResult');
const {nextRetry}=require('../src/async/retryPolicy');
const {ConcurrencyLimiter,FairScheduler,validateConcurrency}=require('../src/async/concurrencyPolicy');
const {assertQueuePort,METHODS}=require('../src/async/queuePort');
const {EXPECTED,assertPgBossCompatibility}=require('../src/async/pgBossVersionGuard');
const {createPgBossQueueAdapter}=require('../src/async/adapters/pgBossQueueAdapter');
const {emitAsyncAudit}=require('../src/async/audit');
const {authorizeExecution}=require('../src/async/authorization');
const {createServiceActorRegistry}=require('../src/async/serviceActorRegistry');
const {classifyReconciliation,KINDS}=require('../src/async/reconciliation');
const {WorkerLifecycle}=require('../src/async/workerLifecycle');
const {manifest:migrations,load:loadMigration}=require('../src/async/migrationManifest');

const orgA='11111111-1111-4111-8111-111111111111', orgB='22222222-2222-4222-8222-222222222222', human='33333333-3333-4333-8333-333333333333';
const registry=createJobRegistry([{type:'synthetic_resource.update',version:2,payloadVersion:2,handler:async()=>{}}]);
function base(){return {envelopeVersion:1,jobType:'synthetic_resource.update',jobVersion:2,payloadVersion:2,organizationId:orgA,actor:{kind:'HUMAN',id:human,membershipVersion:7},operation:'synthetic_resource.update',correlationId:'44444444-4444-4444-8444-444444444444',causationId:'55555555-5555-4555-8555-555555555555',idempotencyKey:'idem-key-0001',executionId:'66666666-6666-4666-8666-666666666666',createdAt:'2026-10-08T10:00:00.000Z',deadlineAt:'2026-10-08T10:05:00.000Z',payload:{resourceId:'synthetic-1',value:1}};}

test('F9 envelope is canonical, immutable, bounded, closed and N/N-1 only',()=>{
 const a=validateEnvelope(base(),registry), b=validateEnvelope({...base(),payload:{value:1,resourceId:'synthetic-1'}},registry);
 assert.equal(a.digest,b.digest);assert.equal(Object.isFrozen(a.envelope.payload),true);
 for(const mutation of [e=>e.extra=1,e=>e.jobVersion=0,e=>e.payload={token:'canary'},e=>e.payload=Object.create(null),e=>e.organizationId='caller-org']) {const e=base();mutation(e);assert.throws(()=>validateEnvelope(e,registry));}
 const n1=base();n1.jobVersion=1;n1.payloadVersion=1;assert.doesNotThrow(()=>validateEnvelope(n1,registry));
 const unknown=base();unknown.jobVersion=3;assert.throws(()=>validateEnvelope(unknown,registry),/incompatible/);
 const oversized=base();oversized.payload={data:'x'.repeat(MAX_BYTES)};assert.throws(()=>validateEnvelope(oversized,registry),/32 KiB/);
});
test('trusted context, not payload, supplies organization actor and operation',()=>{
 const made=createEnvelope({trustedContext:{organizationId:orgA,actor:{kind:'HUMAN',id:human,membershipVersion:7},operation:'synthetic_resource.update',correlationId:'44444444-4444-4444-8444-444444444444',causationId:'55555555-5555-4555-8555-555555555555'},job:{type:'synthetic_resource.update',version:2,payloadVersion:2,idempotencyKey:'idem-key-0001'},payload:{resourceId:'r'},registry,clock:()=>new Date('2026-10-08T10:00:00Z'),id:()=> '66666666-6666-4666-8666-666666666666'});
 assert.equal(made.envelope.organizationId,orgA);assert.throws(()=>createEnvelope({trustedContext:{},job:{},payload:{handler:'evil'},registry}));
});
test('result classification is closed and retry uses full jitter within five attempts/deadline',()=>{
 assert.equal(classify(new Error('RETRYABLE')).code,'PERMANENT');assert.equal(classify(result('RETRYABLE')).code,'RETRYABLE');
 assert.deepEqual(nextRetry({outcome:'RETRYABLE',attempt:1,nowMs:0,deadlineMs:300000,random:()=>0.5}),{delayMs:1000,runAtMs:1000});
 assert.equal(nextRetry({outcome:'PERMANENT',attempt:1,nowMs:0,deadlineMs:300000}),null);assert.equal(nextRetry({outcome:'RETRYABLE',attempt:5,nowMs:0,deadlineMs:300000}),null);
});
test('fair scheduler rotates organizations and concurrency caps fail closed',()=>{
 const s=new FairScheduler();for(let i=0;i<4;i++)s.add({organizationId:orgA,i});s.add({organizationId:orgB,i:9});const out=s.take(3);assert.deepEqual(out.map(x=>x.organizationId),[orgA,orgB,orgA]);
 assert.throws(()=>validateConcurrency({globalConcurrency:65}));assert.throws(()=>validateConcurrency({globalConcurrency:2,operationalReserve:2}));
});
test('concurrency limiter enforces global, type, organization and operational reserve',()=>{const l=new ConcurrencyLimiter({globalConcurrency:4,typeConcurrency:3,organizationConcurrency:2,operationalReserve:1});const a=l.tryAcquire({jobType:'a',organizationId:'o1'}),b=l.tryAcquire({jobType:'a',organizationId:'o1'}),c=l.tryAcquire({jobType:'b',organizationId:'o2'});assert.ok(a&&b&&c);assert.equal(l.tryAcquire({jobType:'b',organizationId:'o3'}),null);const op=l.tryAcquire({jobType:'ops',organizationId:'ops',operational:true});assert.ok(op);assert.equal(op.release(),true);assert.equal(op.release(),false);});
test('QueuePort is closed and pg-boss adapter never leaks library errors or arbitrary queues',async()=>{
 const calls=[];class Boss{constructor(o){calls.push(['ctor',o])}async start(o){calls.push(['start',o])}async send(...a){calls.push(['send',...a]);return 'q1'}async fetch(){return []}async touch(){}async complete(){}async fail(){}async cancel(){}async findJobs(){return []}async stop(o){calls.push(['stop',o])}}
 const q=await createPgBossQueueAdapter({connectionString:'postgres://synthetic.invalid/db',queueMap:{'synthetic_resource.update':'c4g.synthetic.update'},inspectSchema:async()=>({schemaVersion:45,drift:false}),load:async()=>({PgBoss:Boss})});assertQueuePort(q);assert.deepEqual(Object.keys(q),METHODS);
 const validated=validateEnvelope(base(),{supports:()=>true});await q.publish({type:'synthetic_resource.update',envelope:validated.envelope,envelopeDigest:validated.envelopeDigest});await q.shutdown();assert.equal(calls[0][1].createSchema,false);assert.equal(calls[0][1].migrate,false);assert.throws(()=>q.publish({type:'evil.type',envelope:{}}),/shape/);
 assertPgBossCompatibility({...EXPECTED,drift:false});assert.throws(()=>assertPgBossCompatibility({...EXPECTED,schemaVersion:44}));
});
test('F5 authorization revalidates membership and fixes service actors internally',async()=>{
 const allow={authorize:async()=>({allowed:true})};const services=createServiceActorRegistry([{code:'ASYNC_RECONCILER',organizationId:orgA,operation:'synthetic_resource.update'}]);
 assert.equal((await authorizeExecution({envelope:base(),membershipPort:{getActive:async()=>({version:7})},serviceActorRegistry:services,authorizationPort:allow})).allowed,true);
 assert.equal((await authorizeExecution({envelope:base(),membershipPort:{getActive:async()=>null},serviceActorRegistry:services,authorizationPort:allow})).reason,'AUTHORIZATION_REVOKED');
 const e=base();e.actor={kind:'SERVICE',serviceActorCode:'ASYNC_RECONCILER'};assert.equal((await authorizeExecution({envelope:e,membershipPort:{},serviceActorRegistry:services,authorizationPort:allow})).allowed,true);e.organizationId=orgB;assert.equal((await authorizeExecution({envelope:e,membershipPort:{},serviceActorRegistry:services,authorizationPort:allow})).allowed,false);
});
test('audit classes preserve deny and abort critical effects',async()=>{
 const down={accept:async()=>{throw new Error('down')}};await assert.rejects(()=>emitAsyncAudit(down,'ASYNC_EFFECT_AUTHORIZED',{}),/REQUIRED/);assert.equal(await emitAsyncAudit(down,'ASYNC_AUTHORIZATION_DENIED',{}),false);assert.equal(await emitAsyncAudit(down,'ASYNC_JOB_OBSERVED',{}),false);await assert.rejects(()=>emitAsyncAudit(down,'OTHER',{}));
});
test('reconciliation taxonomy is closed and only deterministic cases auto-repair',()=>{assert.equal(KINDS.length,11);assert.equal(classifyReconciliation({kind:'OUTBOX_PENDING'}).automatic,true);assert.equal(classifyReconciliation({kind:'DIGEST_DIVERGENT'}).requiresAuthority,true);assert.throws(()=>classifyReconciliation({kind:'UNKNOWN'}));});
test('worker stops admission and completes active work inside the graceful deadline',async()=>{let stopped=false,aborted=false,release;const work=new Promise(resolve=>{release=resolve});const w=new WorkerLifecycle({queue:{shutdown:async()=>{stopped=true}},graceMs:100,forcedCancelMs:20,run:async({signal})=>{signal.addEventListener('abort',()=>{aborted=true});}});await w.start();const active=w.execute(base(),async()=>work);const shutdown=w.shutdown();assert.equal(w.accepting(),false);release('done');assert.equal(await active,'done');assert.deepEqual(await shutdown,{mode:'GRACEFUL',errorCode:null,pending:0});assert.equal(aborted,true);assert.equal(w.controller.signal.aborted,false);assert.equal(stopped,true);});
test('worker forces cancellation only after the graceful deadline',async()=>{let stopped=false,observed=false;const w=new WorkerLifecycle({queue:{shutdown:async()=>{stopped=true}},graceMs:10,forcedCancelMs:100,run:async()=>{}});const active=w.execute(base(),({signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>{observed=true;resolve('cancelled')},{once:true})));const shutdown=await w.shutdown();assert.equal(await active,'cancelled');assert.deepEqual(shutdown,{mode:'FORCED',errorCode:null,pending:0});assert.equal(observed,true);assert.equal(stopped,true);});
test('worker reports an uncooperative effect without announcing a clean shutdown',async()=>{let release;const w=new WorkerLifecycle({queue:{shutdown:async()=>{}},graceMs:5,forcedCancelMs:5,run:async()=>{}});const active=w.execute(base(),()=>new Promise(resolve=>{release=resolve}));const shutdown=await w.shutdown();assert.equal(shutdown.mode,'FORCED');assert.equal(shutdown.errorCode,'WORKER_SHUTDOWN_INCOMPLETE');assert.equal(shutdown.pending,1);release();await active;});
test('migrations are registered, explicit and pg-boss plan is pinned',()=>{
 assert.equal(migrations.central.version,'004_f9_async_execution');assert.match(loadMigration('central','up').sql,/Upstream plan SHA-256 before whitespace normalization: e0cc78/);assert.match(loadMigration('central','up').sql,/CREATE SCHEMA async_exec/);
 assert.equal(migrations.tenant.version,'001_f9_async_execution');assert.match(loadMigration('tenant','up').checksum,/^[a-f0-9]{64}$/);
 const generator=fs.readFileSync(path.resolve(__dirname,'../scripts/generatePgBossMigration.js'),'utf8');assert.match(generator,/12\.37\.0/);assert.match(generator,/e0cc78ee/);
});
test('productive composition has no synthetic handlers and API does not import F9 worker',()=>{const reg=require('../src/async/productionRegistry').productionRegistry;assert.equal(reg.types.length,0);const server=fs.readFileSync(path.resolve(__dirname,'../src/server.js'),'utf8');assert.doesNotMatch(server,/async\/productionRegistry|src\/worker|async\/workerLifecycle/);});
test('dead-letter contract excludes raw payload, external stack and infrastructure',()=>{const sql=loadMigration('central','up').sql;const segment=sql.slice(sql.indexOf('CREATE TABLE async_exec.dead_letter'),sql.indexOf('CREATE TABLE async_exec.reconciliation_item'));assert.doesNotMatch(segment,/payload jsonb|stack|dsn|credential/i);});
