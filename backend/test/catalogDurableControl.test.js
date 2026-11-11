'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createPolicyStore}=require('../src/opportunities/catalogRead/exposureControl');
const {createDurableExposureControl,createPgPolicyStore}=require('../src/opportunities/catalogRead/pgPolicyStore');
test('restart stays closed until explicit current-version admission; withdrawal survives admission',async()=>{
 const store={...createPolicyStore(),durable:true};let now=1000;
 const org=randomUUID(),gen=randomUUID(),a={organizationId:org,baseRoleCode:'ORG_ADMIN',scope:'membership',expiresAt:999999};
 const first=createDurableExposureControl({store,clock:()=>now});
 await first.operator.enable({expectedRevision:0,organizations:[org]});await first.operator.withdraw({expectedRevision:1,generationId:gen});
 let healthy=false;const second=createDurableExposureControl({store,clock:()=>now,healthy:()=>healthy});
 await assert.rejects(second.reader.begin(a),{code:'CATALOG_UNAVAILABLE'});
 await assert.rejects(second.operator.resume({expectedRevision:2}),/CONTROL_MONITOR_NOT_READY/);healthy=true;
 await assert.rejects(second.operator.resume({expectedRevision:1}),/POLICY_VERSION_CONFLICT/);
 await second.operator.resume({expectedRevision:2});
 await assert.rejects(second.reader.check(await second.reader.begin(a),a,gen),{code:'SNAPSHOT_UNAVAILABLE'});
 const ticket=await second.reader.begin(a);await first.operator.disable({expectedRevision:2});
 await assert.rejects(second.reader.check(ticket,a,randomUUID()),{code:'ACCESS_DENIED'});
 await assert.rejects(second.operator.resume({expectedRevision:3}),/POLICY_NOT_OPEN/);
 await first.operator.enable({expectedRevision:3,organizations:[org],leaseMs:1});now+=2;
 await assert.rejects(second.operator.resume({expectedRevision:4}),/POLICY_NOT_OPEN/);
});
test('policy adapter requires isolation, refuses writer calls on reader and rejects privileged or replica connections',async()=>{
 assert.throws(()=>createPgPolicyStore({}),/isolated/);
 for(const identity of [{name:'reader',reset:true,limited:false,primary:true},{name:'reader',reset:true,limited:true,primary:false},{name:'other',reset:true,limited:true,primary:true},{name:'reader',reset:false,limited:true,primary:true}]){
  let released=false;const pool={connect:async()=>({query:async sql=>sql.includes('pg_roles')?{rows:[identity]}:{rows:[]},release(){released=true}})};
  const s=createPgPolicyStore({isolated:true,pool,login:'reader'});
  await assert.rejects(s.compareAndSet(0,{}),/POLICY_READ_ONLY/);
  await assert.rejects(s.read(),/POLICY_CONNECTION_REJECTED/);assert(released);
 }
});
test('missing state is never bootstrapped and rollback failure discards connection',async()=>{
 let discard;let broken=false;
 const pool={connect:async()=>({query:async sql=>{
  if(sql.includes('pg_roles'))return {rows:[{name:'reader',reset:true,limited:true,primary:true}]};
  if(broken&&sql==='ROLLBACK')throw Error('private');
  if(broken&&sql.includes('SELECT CASE'))throw Error('private');return {rows:[]};
 },release:e=>{discard=e}})};
 const s=createPgPolicyStore({isolated:true,pool,login:'reader'});
 await assert.rejects(s.read(),/POLICY_STATE_MISSING/);broken=true;
 await assert.rejects(s.read(),/^Error: POLICY_STORAGE_UNAVAILABLE$/);assert(discard);
});
test('pool acquisition errors are sanitized and do not initialize state',async()=>{
 const s=createPgPolicyStore({isolated:true,login:'reader',pool:{connect:async()=>{throw Error('private connection credentials')}}});
 await assert.rejects(s.read(),/^Error: POLICY_STORAGE_UNAVAILABLE$/);
});
test('controlled runtime selects durable admission and audits resume without exposing policy identifiers',async()=>{
 const {createControlledReadRuntime}=require('../src/opportunities/catalogRead/controlledRuntime');
 const {randomBytes}=require('node:crypto');const events=[],store={...createPolicyStore(),durable:true};
 const org=randomUUID();await store.compareAndSet(0,{revision:1,mode:'COHORT',organizations:[org],roles:['ORG_ADMIN'],blockedGenerations:[],expiresAt:Date.now()+30000});
 const pool={connect:async()=>{throw Error('No SQL expected')}};
 const runtime=createControlledReadRuntime({isolated:true,policyStore:store,express:{Router:()=>({use(){}})},catalogPool:pool,authorityPool:pool,authorityLogin:'isolated_membership',policyVersion:'test',key:randomBytes(32),sink:e=>events.push(e)});
 await runtime.operator.resume({expectedRevision:1});assert.equal(events.at(-1).action,'resume');assert(!JSON.stringify(events).includes(org));
 runtime.monitor.probe(false);runtime.monitor.probe(false);runtime.monitor.probe(false);
 await assert.rejects(runtime.operator.resume({expectedRevision:1}),/CONTROL_MONITOR_NOT_READY/);
 await runtime.operator.disable({expectedRevision:1});assert.equal((await store.read()).mode,'OFF');
});
