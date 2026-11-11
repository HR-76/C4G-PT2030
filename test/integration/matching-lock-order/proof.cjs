'use strict';
// Synthetic lock protocol only: no product schema, authority, OIDC, or RLS.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{Pool}=require('../../../backend/node_modules/pg');
const run=process.env.MATCHING_PROOF_RUN,name=process.env.MATCHING_PROOF_REPORT,container=process.env.MATCHING_PROOF_CONTAINER,url=new URL(process.env.MATCHING_PROOF_URL);
assert.match(run,/^[a-f0-9]{32}$/);assert.match(name,/^[a-z0-9-]+$/);assert.equal(container,'c4g-matching-lock-'+run);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/postgres');assert(!['5432','5433'].includes(url.port));
assert.equal(JSON.parse(execFileSync('docker',['inspect','--format','{{json .Config.Labels}}',container],{encoding:'utf8'}))['c4g.matching-lock'],run);
const dir=path.resolve(__dirname,'../../../context/reviews',name);fs.mkdirSync(dir);
const report={status:'RUNNING',checks:[],limits:['Synthetic markers and synthetic lock ordering in three databases on one PostgreSQL server; no product writers, authority coordinator, OIDC, RLS or runtime pagination.','Synthetic interleaving proves a possible protocol cycle, not a demonstrated deadlock in current production.']};
const save=()=>fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(report,null,2)+'\n');
async function main(){const admin=new Pool({connectionString:url.toString(),max:2}),pools=[];try{
 for(const db of ['lock_central','lock_tenant_a','lock_tenant_b'])await admin.query('CREATE DATABASE '+db);
 for(const db of ['lock_central','lock_tenant_a','lock_tenant_b']){const u=new URL(url);u.pathname='/'+db;pools.push(new Pool({connectionString:u.toString(),max:4}));}
 const [central,tenant,other]=pools;
 for(const p of pools)await p.query('CREATE TABLE marker(id int PRIMARY KEY,epoch int NOT NULL); INSERT INTO marker VALUES(1,0); CREATE TABLE item(id int PRIMARY KEY,value int NOT NULL); INSERT INTO item VALUES(1,0)');
 const c=await central.connect(),t=await tenant.connect(),w=await tenant.connect(),cw=await central.connect();
 try{
  // Writer holds a tenant functional row, then requests Central; capture holds
  // Central marker and requests that same row. Each DB sees only one edge.
  await Promise.all([c.query('BEGIN'),t.query('BEGIN'),w.query('BEGIN'),cw.query('BEGIN')]);
  await c.query('SELECT * FROM marker WHERE id=1 FOR SHARE');
  await w.query('SELECT * FROM item WHERE id=1 FOR UPDATE');
  await t.query("SET LOCAL lock_timeout='1200ms'");await cw.query("SET LOCAL lock_timeout='250ms'");
  const tenantPid=(await t.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const blockedTenant=t.query('SELECT * FROM item WHERE id=1 FOR UPDATE');blockedTenant.catch(()=>{});
  let observed=false;for(let i=0;i<100;i++){
   const state=(await tenant.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[tenantPid])).rows[0];
   if(state?.wait_event_type==='Lock'){observed=true;break}await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert(observed,'capture must be observed waiting on the tenant lock');
  await assert.rejects(cw.query('UPDATE marker SET epoch=epoch+1 WHERE id=1'),e=>e.code==='55P03');
  await cw.query('ROLLBACK');await w.query('ROLLBACK');await blockedTenant;
  await t.query('ROLLBACK');await c.query('ROLLBACK');
  report.checks.push('cross-database opposing lock order hits timeout; aborting writer releases the waiting capture');
  assert.equal((await other.query('SELECT epoch FROM marker')).rows[0].epoch,0);
  report.checks.push('unrelated synthetic tenant remains unchanged');
  // The same order, Central then tenant, serializes two participants.
  await c.query('BEGIN');await t.query('BEGIN');await w.query('BEGIN');
  await c.query('SELECT * FROM marker WHERE id=1 FOR SHARE');await t.query('SELECT * FROM marker WHERE id=1 FOR SHARE');
  await w.query("SET LOCAL lock_timeout='250ms'");
  await assert.rejects(w.query('UPDATE marker SET epoch=epoch+1 WHERE id=1'),e=>e.code==='55P03');
  await w.query('ROLLBACK');await t.query('COMMIT');await c.query('COMMIT');
  await w.query('UPDATE marker SET epoch=epoch+1 WHERE id=1');
  assert.equal((await tenant.query('SELECT epoch FROM marker')).rows[0].epoch,1);
  report.checks.push('shared marker blocks a cooperating writer until release and then permits the update');
 }finally{await Promise.allSettled([c.query('ROLLBACK'),t.query('ROLLBACK'),w.query('ROLLBACK'),cw.query('ROLLBACK')]);for(const client of [c,t,w,cw])client.release();}
 report.status='PASS';save();console.log('MATCHING_LOCK_ORDER_PASS');
 }finally{await Promise.all(pools.map(p=>p.end()));await admin.end();}}
main().catch(e=>{report.status='FAIL';report.error={name:e.name,code:e.code||null};save();console.error('MATCHING_LOCK_ORDER_FAIL',e.code||e.name);process.exitCode=1});
