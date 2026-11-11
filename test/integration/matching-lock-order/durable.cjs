'use strict';
// Isolated candidate protocol, not product authority, matching, RLS, or F5.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{Pool}=require('../../../backend/node_modules/pg');
const {execFileSync}=require('node:child_process');
const name=process.env.MATCHING_INTEGRATED_REPORT,url=new URL(process.env.HTTP_PROOF_ADMIN_URL||'');
assert.match(name,/^[a-z0-9-]+$/);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/postgres');assert(!['5432','5433'].includes(url.port));assert.match(process.env.HTTP_PROOF_RUN||'',/^[a-f0-9]{32}$/);
assert.equal(process.env.MATCHING_DURABLE_CONTAINER,'c4g-matching-durable-'+process.env.HTTP_PROOF_RUN);
assert.equal(JSON.parse(execFileSync('docker',['inspect','--format','{{json .Config.Labels}}',process.env.MATCHING_DURABLE_CONTAINER],{encoding:'utf8'}))['c4g.matching-durable'],process.env.HTTP_PROOF_RUN);
const report={status:'RUNNING',checks:[],limits:['Synthetic durable guard protocol in three isolated PostgreSQL databases; no product guard, F4, F5, RLS, matching, cursor, or production schema.','Writers cooperate explicitly; this does not prove complete writer coverage, real network partitions, security grants, deployment, or distributed deadlock freedom.']};
const output=path.resolve(__dirname,'../../../context/reviews',name,'durable.json');
const save=()=>{fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n')};
let admin,pools=[];
async function main(){
 admin=new Pool({connectionString:url.toString(),max:2});for(const db of ['durable_central','durable_tenant_a','durable_tenant_b'])await admin.query('CREATE DATABASE '+db);
 for(const db of ['durable_central','durable_tenant_a','durable_tenant_b']){const u=new URL(url);u.pathname='/'+db;pools.push(new Pool({connectionString:u.toString(),max:5}))}
 const [central,tenant,other]=pools;
 await central.query("CREATE TABLE mutex(id int PRIMARY KEY, epoch int NOT NULL); INSERT INTO mutex VALUES(1,0); CREATE TABLE source(id int PRIMARY KEY,value int NOT NULL); INSERT INTO source VALUES(1,0); CREATE TABLE guard(id uuid PRIMARY KEY,nonce uuid NOT NULL,state text NOT NULL CHECK(state IN ('PREPARED','UNKNOWN','DONE')),outcome text)");
 for(const p of [tenant,other])await p.query('CREATE TABLE receipt(id uuid PRIMARY KEY, value int NOT NULL)');
 async function prepare(id,nonce,disconnect=false){const c=await central.connect();let destroyed=false;try{await c.query('BEGIN');await c.query('SELECT * FROM mutex WHERE id=1 FOR UPDATE');const active=await c.query("SELECT 1 FROM guard WHERE state IN ('PREPARED','UNKNOWN')");if(active.rowCount)throw Error('GUARD_BUSY');await c.query("INSERT INTO guard(id,nonce,state) VALUES($1,$2,'PREPARED')",[id,nonce]);await c.query('COMMIT');if(disconnect){destroyed=true;c.release(new Error('SYNTHETIC_CONNECTION_LOSS'))}}finally{if(!destroyed){await c.query('ROLLBACK').catch(()=>{});c.release()}}}
 async function writer(value){const c=await central.connect();try{await c.query('BEGIN');await c.query('SELECT * FROM mutex WHERE id=1 FOR UPDATE');if((await c.query("SELECT 1 FROM guard WHERE state IN ('PREPARED','UNKNOWN')")).rowCount){await c.query('ROLLBACK');return false}await c.query('UPDATE source SET value=$1 WHERE id=1',[value]);await c.query('UPDATE mutex SET epoch=epoch+1 WHERE id=1');await c.query('COMMIT');return true}finally{await c.query('ROLLBACK').catch(()=>{});c.release()}}
 async function unknown(id){await central.query("UPDATE guard SET state='UNKNOWN' WHERE id=$1 AND state='PREPARED'",[id])}
 async function recover(id,nonce){const t=await tenant.connect();try{await t.query('BEGIN');const locked=(await t.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,43001305)) AS ok',[nonce])).rows[0].ok;if(!locked){await t.query('ROLLBACK');return null}const present=(await t.query('SELECT 1 FROM receipt WHERE id=$1',[id])).rowCount>0;await t.query('ROLLBACK');const c=await central.connect();try{await c.query('BEGIN');await c.query('SELECT * FROM mutex WHERE id=1 FOR UPDATE');const row=(await c.query("UPDATE guard SET state='DONE',outcome=$2 WHERE id=$1 AND state IN ('PREPARED','UNKNOWN') RETURNING outcome",[id,present?'COMMITTED':'ROLLED_BACK'])).rows[0];await c.query('COMMIT');return row?.outcome||null}finally{await c.query('ROLLBACK').catch(()=>{});c.release()}}finally{await t.query('ROLLBACK').catch(()=>{});t.release()}}
 const id=randomUUID(),nonce=randomUUID();await prepare(id,nonce,true);
 // Destroy the connection that committed the guard before any tenant commit.
 assert.deepEqual(await Promise.all([writer(1),writer(2)]),[false,false]);assert.equal((await central.query('SELECT value FROM source')).rows[0].value,0);
 await assert.rejects(prepare(randomUUID(),randomUUID()),/GUARD_BUSY/);
 report.checks.push('committed durable guard survives connection loss and rejects two concurrent cooperative writers');
 report.checks.push('a second capture is refused while the first durable guard remains active');
 const client=await tenant.connect();try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,43001305))',[nonce]);await client.query('INSERT INTO receipt VALUES($1,1)',[id]);
  await unknown(id);assert.equal(await recover(id,nonce),null);assert.equal(await writer(3),false);
  await client.query('COMMIT'); // Lost acknowledgement is represented by retaining UNKNOWN after observed commit.
  assert.equal(await writer(4),false);assert.equal(await recover(id,nonce),'COMMITTED');assert.equal(await writer(5),true);
  report.checks.push('unknown commit remains fenced until nonce proves termination and durable receipt proves commit');
 }finally{await client.query('ROLLBACK').catch(()=>{});client.release()}
 const id2=randomUUID(),nonce2=randomUUID();await prepare(id2,nonce2);const rollback=await tenant.connect();try{await rollback.query('BEGIN');await rollback.query('SELECT pg_advisory_xact_lock(hashtextextended($1,43001305))',[nonce2]);await rollback.query('INSERT INTO receipt VALUES($1,2)',[id2]);await unknown(id2);await rollback.query('ROLLBACK');assert.equal(await recover(id2,nonce2),'ROLLED_BACK');assert.equal((await tenant.query('SELECT count(*)::int n FROM receipt WHERE id=$1',[id2])).rows[0].n,0);assert.equal(await writer(6),true)}finally{await rollback.query('ROLLBACK').catch(()=>{});rollback.release()}
 assert.equal((await other.query('SELECT count(*)::int n FROM receipt')).rows[0].n,0);
 report.checks.push('rollback is reconciled only after termination and the second tenant is unchanged');
 // A writer already holding the serialization row excludes guard admission.
 const active=await central.connect();try{await active.query('BEGIN');await active.query('SELECT * FROM mutex WHERE id=1 FOR UPDATE');const contender=await central.connect();try{await contender.query('BEGIN');await contender.query("SET LOCAL lock_timeout='250ms'");await assert.rejects(contender.query('SELECT * FROM mutex WHERE id=1 FOR UPDATE'),{code:'55P03'});await contender.query('ROLLBACK')}finally{contender.release()}await active.query('ROLLBACK')}finally{active.release()}
 report.checks.push('guard admission cannot pass a writer already holding the serialization row');
 report.status='PASS';
}
main().catch(e=>{report.status='FAIL';report.error={name:e.name,code:e.code||null};process.exitCode=1}).finally(async()=>{await Promise.allSettled(pools.map(p=>p.end()));await admin?.end();save();console.log('MATCHING_DURABLE_'+report.status)});
