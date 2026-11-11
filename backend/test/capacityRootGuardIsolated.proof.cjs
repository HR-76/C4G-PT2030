'use strict';
// Proof of a proposed lock protocol, not the application schema or roles.
const {Pool}=require('pg');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const port=Number(process.env.C4G_CAPACITY_PROOF_PORT);
if(port!==56439||process.env.C4G_CAPACITY_PROOF_ISOLATED!=='yes')throw Error('ISOLATED_PROOF_REQUIRED');
const options={host:'127.0.0.1',port,user:'capacity_proof'};
const admin=new Pool({...options,database:'postgres'});let central,tenant;
async function main(){try{
 const data=(await admin.query('SHOW data_directory')).rows[0].data_directory;
 if(path.resolve(data).toLowerCase()!==path.resolve(__dirname,'../../.tmp/capacity-proof-pg-20261110').toLowerCase())throw Error('ISOLATED_CLUSTER_MISMATCH');
 const suffix=randomUUID().replaceAll('-','').slice(0,12),cname=`guard_c_${suffix}`,tname=`guard_t_${suffix}`;
 await admin.query(`CREATE DATABASE ${cname}`);await admin.query(`CREATE DATABASE ${tname}`);
 central=new Pool({...options,database:cname,max:5});tenant=new Pool({...options,database:tname,max:3});
 await central.query("CREATE TABLE guard_config(id integer PRIMARY KEY CHECK(id=1),capacity integer NOT NULL,reserved integer NOT NULL CHECK(reserved>=0 AND reserved<capacity)); INSERT INTO guard_config VALUES(1,2,1); CREATE TABLE guard_root(id uuid PRIMARY KEY,epoch integer NOT NULL,state text NOT NULL CHECK(state IN ('RESERVED','RELEASED')),replay_pending boolean NOT NULL); CREATE TABLE replay_intent(id uuid PRIMARY KEY,root_id uuid NOT NULL REFERENCES guard_root(id),state text NOT NULL CHECK(state IN ('RESERVED','CONSUMED')))");
 await tenant.query('CREATE TABLE replay_intent(id uuid PRIMARY KEY,root_id uuid NOT NULL)');
 const root=randomUUID(),replay=randomUUID();await central.query("INSERT INTO guard_root VALUES($1,1,'RESERVED',false)",[root]);
 const holder=await central.connect(),challenger=await central.connect();
 try{
  await holder.query('BEGIN');await holder.query('SELECT * FROM guard_root WHERE id=$1 FOR UPDATE',[root]);
  await challenger.query('BEGIN');await challenger.query("SET LOCAL lock_timeout='100ms'");
  await assert.rejects(challenger.query('SELECT * FROM guard_root WHERE id=$1 FOR UPDATE',[root]),e=>e.code==='55P03');
  await challenger.query('ROLLBACK');
  await holder.query('UPDATE guard_root SET epoch=epoch+1,replay_pending=true WHERE id=$1',[root]);
  await holder.query("INSERT INTO replay_intent VALUES($1,$2,'RESERVED')",[replay,root]);await holder.query('COMMIT');
  const stale=await central.query("UPDATE guard_root SET state='RELEASED' WHERE id=$1 AND epoch=1 AND replay_pending=false AND state='RESERVED' RETURNING id",[root]);assert.equal(stale.rowCount,0);
  // A crash after the central reservation leaves the guard occupied until the tenant intent is recovered.
  let row=(await central.query('SELECT epoch,state,replay_pending FROM guard_root WHERE id=$1',[root])).rows[0];assert.deepEqual(row,{epoch:2,state:'RESERVED',replay_pending:true});
  await tenant.query('INSERT INTO replay_intent VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[replay,root]);
  const proof=(await tenant.query('SELECT root_id FROM replay_intent WHERE id=$1',[replay])).rows[0];assert.equal(proof.root_id,root);
  await central.query("UPDATE replay_intent SET state='CONSUMED' WHERE id=$1 AND root_id=$2 AND state='RESERVED'",[replay,root]);
  // A consumed replay is not terminal: accepting the tenant intent must not release the guard.
  row=(await central.query('SELECT state,replay_pending FROM guard_root WHERE id=$1',[root])).rows[0];assert.deepEqual(row,{state:'RESERVED',replay_pending:true});
  const releasedRoot=randomUUID();await central.query("INSERT INTO guard_root VALUES($1,1,'RESERVED',false)",[releasedRoot]);
  await central.query("UPDATE guard_root SET state='RELEASED' WHERE id=$1 AND state='RESERVED' AND replay_pending=false",[releasedRoot]);
  const noPermit=await central.query("UPDATE guard_root SET epoch=epoch+1,replay_pending=true WHERE id=$1 AND state='RESERVED' RETURNING id",[releasedRoot]);assert.equal(noPermit.rowCount,0);
  const contenders=Array.from({length:8},()=>randomUUID());
  for(const id of contenders)await central.query("INSERT INTO guard_root VALUES($1,1,'RELEASED',false)",[id]);
  async function reacquire(id){const c=await central.connect();try{
   await c.query('BEGIN');const config=(await c.query('SELECT capacity,reserved FROM guard_config WHERE id=1 FOR UPDATE')).rows[0];
   const held=Number((await c.query("SELECT count(*) n FROM guard_root WHERE state='RESERVED'")).rows[0].n);
   const result=held>=config.capacity?0:(await c.query("UPDATE guard_root SET state='RESERVED',epoch=epoch+1,replay_pending=true WHERE id=$1 AND state='RELEASED' RETURNING id",[id])).rowCount;
   await c.query('COMMIT');return result;
  }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}}
  const admissions=await Promise.all(contenders.map(reacquire));assert.equal(admissions.reduce((a,b)=>a+b,0),1);
  assert.equal(Number((await central.query("SELECT count(*) n FROM guard_root WHERE state='RESERVED'")).rows[0].n),2);
  console.log(JSON.stringify({status:'PASS',lockContention:true,staleEvidenceDenied:true,replayCrashRecovery:true,reservationRetained:true,replayAfterReleaseRequiresNewPermit:true,concurrentReacquisition:8,admitted:1}));
 }finally{await holder.query('ROLLBACK').catch(()=>{});await challenger.query('ROLLBACK').catch(()=>{});holder.release();challenger.release();}
 }finally{await Promise.all([central?.end(),tenant?.end(),admin.end()]);}}
main().catch(error=>{console.error(error);process.exitCode=1});
