'use strict';
// Isolated proof only. No application schema, credentials, or production roles.
const {Pool}=require('pg');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const port=Number(process.env.C4G_CAPACITY_PROOF_PORT);
if(port!==56439||process.env.C4G_CAPACITY_PROOF_ISOLATED!=='yes')throw Error('ISOLATED_PROOF_REQUIRED');
const options={host:'127.0.0.1',port,user:'capacity_proof'};
const pool=name=>new Pool({...options,database:name,max:16});
const admin=pool('postgres');let central,tenant;
async function transaction(db,fn){const c=await db.connect();try{await c.query('BEGIN');const value=await fn(c);await c.query('COMMIT');return value;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
async function reserve(id,org,kind){return transaction(central,async c=>{
 const limit=(await c.query('SELECT capacity,reserved FROM capacity.config WHERE id=1 FOR UPDATE')).rows[0];
 const previous=(await c.query('SELECT * FROM capacity.permit WHERE id=$1',[id])).rows[0];
 if(previous){if(previous.org!==org||previous.kind!==kind)throw Error('CONFLICT');return previous.state;}
 const count=Number((await c.query("SELECT count(*) n FROM capacity.permit WHERE state='RESERVED'")).rows[0].n);
 if(count >= (kind==='CRITICAL'?limit.capacity:limit.capacity-limit.reserved))return 'RETRY_LATER';
 await c.query("INSERT INTO capacity.permit(id,org,kind,state) VALUES($1,$2,$3,'RESERVED')",[id,org,kind]);return 'RESERVED';
});}
async function accept(id,org,kind){const r=await reserve(id,org,kind);if(r==='RETRY_LATER')return r;
 await transaction(tenant,async c=>{await c.query("INSERT INTO proof.intent(id,org,kind,state) VALUES($1,$2,$3,'ACCEPTED') ON CONFLICT(id) DO NOTHING",[id,org,kind]);const row=(await c.query('SELECT org,kind FROM proof.intent WHERE id=$1',[id])).rows[0];if(row.org!==org||row.kind!==kind)throw Error('CONFLICT');});return 'ACCEPTED';}
async function finish(id,org){await transaction(tenant,async c=>{const r=await c.query("UPDATE proof.intent SET state='COMPLETED' WHERE id=$1 AND org=$2 RETURNING id",[id,org]);if(!r.rowCount)throw Error('TENANT_PROOF_REQUIRED');});
 const proof=(await tenant.query("SELECT 1 FROM proof.intent WHERE id=$1 AND org=$2 AND state='COMPLETED'",[id,org])).rowCount;if(!proof)throw Error('TENANT_PROOF_REQUIRED');
 await transaction(central,c=>c.query("UPDATE capacity.permit SET state='RELEASED' WHERE id=$1 AND org=$2 AND state='RESERVED'",[id,org]));}
async function main(){try{
 const dataDirectory=(await admin.query('SHOW data_directory')).rows[0].data_directory;
 const expected=path.resolve(__dirname,'../../.tmp/capacity-proof-pg-20261110');
 if(path.resolve(dataDirectory).toLowerCase()!==expected.toLowerCase())throw Error('ISOLATED_CLUSTER_MISMATCH');
 const suffix=randomUUID().replaceAll('-','').slice(0,12),centralName=`capacity_c_${suffix}`,tenantName=`capacity_t_${suffix}`;
 await admin.query(`CREATE DATABASE ${centralName}`);await admin.query(`CREATE DATABASE ${tenantName}`);central=pool(centralName);tenant=pool(tenantName);
 await central.query("CREATE SCHEMA capacity; CREATE TABLE capacity.config(id integer PRIMARY KEY CHECK(id=1), capacity integer NOT NULL, reserved integer NOT NULL CHECK(reserved>=0 AND reserved<capacity)); INSERT INTO capacity.config VALUES(1,6,2); CREATE TABLE capacity.permit(id uuid PRIMARY KEY,org uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('NORMAL','CRITICAL')),state text NOT NULL CHECK(state IN ('RESERVED','RELEASED')))");
 await tenant.query("CREATE SCHEMA proof; CREATE TABLE proof.intent(id uuid PRIMARY KEY,org uuid NOT NULL,kind text NOT NULL,state text NOT NULL CHECK(state IN ('ACCEPTED','COMPLETED'))) ");
 const org=randomUUID(), ids=Array.from({length:12},()=>randomUUID());
 const results=await Promise.all(ids.map(id=>accept(id,org,'NORMAL')));assert.equal(results.filter(x=>x==='ACCEPTED').length,4);assert.equal(results.filter(x=>x==='RETRY_LATER').length,8);
 const accepted=ids[results.indexOf('ACCEPTED')];assert.equal(await accept(accepted,org,'NORMAL'),'ACCEPTED');await assert.rejects(accept(accepted,randomUUID(),'NORMAL'),/CONFLICT/);
 const crash=randomUUID();assert.equal(await reserve(crash,org,'CRITICAL'),'RESERVED');assert.equal(await accept(crash,org,'CRITICAL'),'ACCEPTED');
 const critical=randomUUID();assert.equal(await accept(critical,org,'CRITICAL'),'ACCEPTED');assert.equal(await accept(randomUUID(),org,'CRITICAL'),'RETRY_LATER');
 await assert.rejects(finish(critical,randomUUID()),/TENANT_PROOF_REQUIRED/);
 // Simulate a process ending after the tenant commits but before the central release.
 await tenant.query("UPDATE proof.intent SET state='COMPLETED' WHERE id=$1 AND org=$2",[critical,org]);
 assert.equal((await central.query('SELECT state FROM capacity.permit WHERE id=$1',[critical])).rows[0].state,'RESERVED');
 await finish(critical,org);await finish(critical,org);
 assert.equal(await accept(randomUUID(),org,'CRITICAL'),'ACCEPTED');
 const count=Number((await central.query("SELECT count(*) n FROM capacity.permit WHERE state='RESERVED'")).rows[0].n);assert.equal(count,6);
 console.log(JSON.stringify({result:'PASS',databases:2,concurrentAttempts:12,normalAccepted:4,reservedCritical:2,retryAtCapacity:true,interruptedReservationRecovered:true,idempotency:true,wrongOrganizationRejected:true,terminalReleaseIdempotent:true}));
 }finally{await Promise.all([central?.end(),tenant?.end(),admin.end()]);}}
main().catch(e=>{console.error(e);process.exitCode=1});
