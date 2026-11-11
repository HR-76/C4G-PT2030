'use strict';
const {Pool}=require('../../../backend/node_modules/pg'),{fork,execFileSync}=require('node:child_process');
const {randomUUID,randomBytes}=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createPgPolicyStore}=require('../../../backend/src/opportunities/catalogRead/pgPolicyStore');
const out=process.env.GCNI_DURABLE_OUTPUT,container=process.env.GCNI_DURABLE_CONTAINER,run=process.env.GCNI_DURABLE_RUN;
if(!out||!/^gcni-durable-[a-f0-9]{32}$/.test(container)||!run)throw Error('OWNED_REHEARSAL_REQUIRED');
const report={status:'RUNNING',checks:[],isolated:true,claims:['synthetic authority, not institutional OIDC','single PostgreSQL primary, not HA failover']};
const admin=new Pool({host:'127.0.0.1',port:Number(process.env.GCNI_DURABLE_PORT),user:'proof_admin',password:process.env.POSTGRES_PASSWORD,database:'postgres',connectionTimeoutMillis:1500});admin.on('error',()=>{});
const org=randomUUID(),generation=randomUUID(),key=randomBytes(32).toString('base64'),password=randomBytes(32).toString('hex');
const reader={host:'127.0.0.1',port:Number(process.env.GCNI_DURABLE_PORT),user:'proof_reader',password,database:'postgres'},writer={...reader,user:'proof_operator'};
const children=new Set();let counter=0;
function spawn(connection,writable){
 const child=fork(path.join(__dirname,'worker.cjs'),[],{stdio:['ignore','ignore','ignore','ipc'],env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH}});children.add(child);
 const pending=new Map();let enteredResolve;
 child.on('message',m=>{if(m.event==='entered'){enteredResolve?.();return;}const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Object.assign(Error(m.error),{code:m.error,diagnostic:m.diagnostic})):p.resolve(m.value);});
 child.on('exit',()=>{children.delete(child);for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('WORKER_EXIT'));}pending.clear();});
 const call=(action,args)=>new Promise((resolve,reject)=>{const id=++counter;const timer=setTimeout(()=>{pending.delete(id);reject(Error('WORKER_TIMEOUT'));},15000);pending.set(id,{resolve,reject,timer});child.send({id,action,args});});
 return {call,ready:call('init',{connection,writer:writable,org,generation,key}),entered:()=>new Promise(r=>enteredResolve=r),stop:async()=>{await call('stop');}};
}
function pass(name){report.checks.push({name,status:'PASS'});console.log('PASS '+name);}
function ownedDocker(action){const label=execFileSync('docker',['inspect','--format','{{index .Config.Labels "gcni.durable-proof"}}',container],{encoding:'utf8'}).trim();assert.equal(label,run);execFileSync('docker',[action,container],{stdio:'ignore'});}
async function ready(){for(let i=0;i<60;i++){try{await admin.query('SELECT 1');return;}catch{await new Promise(r=>setTimeout(r,250));}}throw Error('DATABASE_NOT_READY');}
(async()=>{
 let readerPool,writerPool;
 try {
  await ready();await admin.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
  for(const [login,role] of [['proof_reader','gcni_control_reader'],['proof_operator','gcni_control_operator']])await admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT PASSWORD '${password}'; GRANT ${role} TO ${login}`);
  readerPool=new Pool(reader);writerPool=new Pool(writer);readerPool.on('error',()=>{});writerPool.on('error',()=>{});
  const readStore=createPgPolicyStore({isolated:true,pool:readerPool,login:reader.user});const writeStore=createPgPolicyStore({isolated:true,pool:writerPool,login:writer.user,writable:true});
  let a=spawn(writer,true),b=spawn(reader,false);await Promise.all([a.ready,b.ready]);
  assert.equal((await readStore.read()).mode,'OFF');await assert.rejects(b.call('read'),{code:'CATALOG_UNAVAILABLE'});pass('DEFAULT_OFF_AND_NEW_INSTANCE_CLOSED');
  await a.call('enable',{expectedRevision:0,organizations:[org]});await assert.rejects(b.call('read'),{code:'CATALOG_UNAVAILABLE'});
  await assert.rejects(b.call('resume',{expectedRevision:0}),{code:'POLICY_VERSION_CONFLICT'});await b.call('resume',{expectedRevision:1});
  const first=await b.call('read');assert.equal(first.data.length,1);await assert.rejects(b.call('read',{principal:'client'}),{code:'ACCESS_DENIED'});pass('EXPLICIT_ADMISSION_ADMIN_ONLY');
  await b.call('hold');const entered=b.entered();const pending=b.call('read');const rejection=assert.rejects(pending,{code:'ACCESS_DENIED'});await entered;
  await a.call('disable',{expectedRevision:1});await b.call('release');await rejection;pass('CROSS_PROCESS_IN_FLIGHT_REVOCATION');
  await a.call('enable',{expectedRevision:2,organizations:[org]});
  const p=await readStore.read();const race=await Promise.allSettled([writeStore.compareAndSet(3,{...p,revision:4,blockedGenerations:[generation]}),writeStore.compareAndSet(3,{...p,revision:4,blockedGenerations:[randomUUID()]})]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.find(r=>r.status==='rejected').reason.message,'POLICY_VERSION_CONFLICT');
  const winner=await readStore.read();if(!winner.blockedGenerations.includes(generation))await a.call('withdraw',{expectedRevision:4,generationId:generation});pass('ATOMIC_CAS_ONE_WINNER');
  let state=await readStore.read();await assert.rejects(writeStore.compareAndSet(state.revision,{...state,revision:state.revision+1,blockedGenerations:[]}),/INVALID_EXPOSURE_POLICY/);pass('WITHDRAWALS_CANNOT_BE_REMOVED');
  await assert.rejects(b.call('read',{pairs:[['snapshot',first.meta.snapshot]]}),{code:'SNAPSHOT_UNAVAILABLE'});
  await b.stop();b=spawn(reader,false);await b.ready;await assert.rejects(b.call('read'),{code:'CATALOG_UNAVAILABLE'});await b.call('resume',{expectedRevision:state.revision});
  await assert.rejects(b.call('read',{pairs:[['snapshot',first.meta.snapshot]]}),{code:'SNAPSHOT_UNAVAILABLE'});pass('PROCESS_RESTART_PRESERVES_WITHDRAWAL_AND_REQUIRES_ADMISSION');
  const before=(await admin.query('SELECT count(*)::int AS n FROM gcni_catalog_control_rehearsal.history')).rows[0].n;
  ownedDocker('stop');await assert.rejects(b.call('read'),{code:'CATALOG_UNAVAILABLE'});ownedDocker('start');await ready();
  assert.deepEqual(await readStore.read(),state);assert.equal((await admin.query('SELECT count(*)::int AS n FROM gcni_catalog_control_rehearsal.history')).rows[0].n,before);
  await assert.rejects(b.call('read'),{code:'SNAPSHOT_UNAVAILABLE'});pass('DATABASE_RESTART_DURABILITY_AND_OUTAGE_FAIL_CLOSED');
  await a.call('disable',{expectedRevision:state.revision});await a.call('enable',{expectedRevision:state.revision+1,organizations:[org]});await assert.rejects(b.call('read'),{code:'SNAPSHOT_UNAVAILABLE'});pass('REOPENING_RETAINS_BLOCKS');
  for(const [pool,role] of [[readerPool,'gcni_control_reader'],[writerPool,'gcni_control_operator']]){
   const c=await pool.connect();try{await c.query(`SET ROLE ${role}`);await assert.rejects(c.query('UPDATE gcni_catalog_control_rehearsal.state SET policy=policy'),{code:'42501'});await assert.rejects(c.query('DELETE FROM gcni_catalog_control_rehearsal.history'),{code:'42501'});if(role==='gcni_control_reader')await assert.rejects(c.query("SELECT gcni_catalog_control_rehearsal.transition(0,'{}')"),{code:'42501'});}finally{await c.query('RESET ROLE');c.release();}
  }pass('READER_AND_OPERATOR_LEAST_PRIVILEGE');
  await admin.query('REVOKE USAGE ON SCHEMA gcni_catalog_control_rehearsal FROM gcni_control_reader');
  await assert.rejects(b.call('read'),{code:'CATALOG_UNAVAILABLE'});
  await admin.query('GRANT USAGE ON SCHEMA gcni_catalog_control_rehearsal TO gcni_control_reader');pass('PERMISSION_REVOCATION_FAILS_CLOSED');
  state=await readStore.read();
  await admin.query('DELETE FROM gcni_catalog_control_rehearsal.state');
  await assert.rejects(b.call('read'),{code:'CATALOG_UNAVAILABLE'});
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM gcni_catalog_control_rehearsal.state')).rows[0].n,0);
  await admin.query('INSERT INTO gcni_catalog_control_rehearsal.state VALUES(true,$1)',[JSON.stringify(state)]);pass('MISSING_STATE_FAILS_CLOSED_WITHOUT_RESET');
  await admin.query(`ALTER TABLE gcni_catalog_control_rehearsal.history ADD CONSTRAINT injected_failure CHECK(revision<=${state.revision})`);
  await assert.rejects(writeStore.compareAndSet(state.revision,{...state,revision:state.revision+1,mode:'OFF',organizations:[],roles:[],expiresAt:null}));
  assert.deepEqual(await readStore.read(),state);
  await admin.query('ALTER TABLE gcni_catalog_control_rehearsal.history DROP CONSTRAINT injected_failure');pass('AUDIT_WRITE_FAILURE_ROLLS_BACK_POLICY');
  state=await readStore.read();const n0=(await admin.query('SELECT count(*)::int AS n FROM gcni_catalog_control_rehearsal.history')).rows[0].n;
  for(const patch of [{roles:['C4G_ADMIN']},{expiresAt:Date.now()+600000},{organizations:[org,org]},{mode:'OFF'}])await assert.rejects(writeStore.compareAndSet(state.revision,{...state,...patch,revision:state.revision+1}));
  assert.equal((await readStore.read()).revision,state.revision);assert.equal((await admin.query('SELECT count(*)::int AS n FROM gcni_catalog_control_rehearsal.history')).rows[0].n,n0);pass('INVALID_TRANSITIONS_ATOMIC_NO_HISTORY_CHANGE');
  await a.call('disable',{expectedRevision:state.revision});await a.call('enable',{expectedRevision:state.revision+1,organizations:[org],leaseMs:700});await new Promise(r=>setTimeout(r,800));
  assert.equal((await readStore.read()).expiresAt,0);await assert.rejects(b.call('read'),{code:'ACCESS_DENIED'});pass('DATABASE_CLOCK_ENFORCES_EXPIRY');
  state=await readStore.read();await a.call('withdraw',{expectedRevision:state.revision,generationId:randomUUID()});pass('EXPIRED_POLICY_STILL_ACCEPTS_CONTAINMENT');
  state=await readStore.read();await a.call('disable',{expectedRevision:state.revision});
  const history=(await admin.query('SELECT revision::int FROM gcni_catalog_control_rehearsal.history ORDER BY revision')).rows;
  assert.deepEqual(history.map(r=>r.revision),Array.from({length:history.length},(_,i)=>i));pass('ATOMIC_CONTIGUOUS_HISTORY');
  report.finalState=await a.call('status');assert.equal(report.finalState.mode,'OFF');
  await a.stop();await b.stop();report.status='PASS';
 }catch(e){report.status='FAIL';report.failure={code:e.code||'ASSERTION_OR_GATE_FAILURE',diagnostic:e.diagnostic,checkCount:report.checks.length};console.error('FAIL gate after '+report.checks.length+' checks');process.exitCode=1;}
 finally {
  for(const child of children)child.kill();
  await Promise.allSettled([admin.end(),readerPool?.end(),writerPool?.end()]);
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));
 }
})();
