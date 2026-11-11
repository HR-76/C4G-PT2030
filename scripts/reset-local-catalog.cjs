'use strict';
// One explicit local maintenance operation. No tenant writes, CASCADE or source activation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {Pool}=require('../backend/node_modules/pg');
const cfg=require('../backend/scripts/localPlatform/config');
const {target}=require('../backend/scripts/localPlatform/prepareOpportunityInterests');
const {snapshot}=require('../backend/scripts/localPlatform/backupOpportunityV2');
const TABLES=Object.freeze(('accepted_receipt_v2 activation_decision_v2 activation_plan_v2 duplicate_candidate eu_expired_permit_v1 eu_expired_reconciliation_v1 eu_writer_decision_v2 eu_writer_execution_v2 eu_writer_permit_v2 funding_batch funding_candidate_v2 funding_cycle funding_cycle_seen funding_identity funding_observation funding_refresh_target funding_resolution funding_run funding_run_item idempotency_record manual_v2_candidate opportunity provenance pt2030_plan_identity pt2030_plan_import pt2030_plan_observation pt2030_plan_preview pt2030_plan_revision revision revision_allocation_concept_v2 revision_allocation_v2 revision_concept_v2 revision_deadline_v2 revision_evidence_v2 revision_financial_detail_v2 source_identity_v2 source_observation_v2').split(' '));
const RETAIN=Object.freeze(['eu_source_control_v2','eu_source_control_receipt_v2','eu_legacy_prearchive_use_v1']);
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const qualified=t=>`opportunity_catalog.${quote(t)}`;
const sha=b=>createHash('sha256').update(b).digest('hex');
const STALE_JOB='a3970ea8-07d0-436a-994a-f55e632a1cdf';
async function staleQueue(c){
 const jobs=(await c.query("SELECT j.id,j.name,j.state,j.tableoid::regclass::text AS physical_table,r.status,r.error_code,r.lease_until FROM pgboss.job j LEFT JOIN opportunity_catalog.funding_run r ON r.run_id::text=j.data->'payload'->>'runId' WHERE j.state::text IN('created','retry','active') AND (j.data->>'jobType'='funding_tenders.refresh' OR j.name LIKE '%funding%')")).rows;
 assert(jobs.length<=1,'UNEXPECTED_QUEUE_WORK');
 for(const j of jobs){assert.equal(j.id,STALE_JOB);assert.equal(j.name,'funding-tenders-refresh');assert.equal(j.status,'ERROR');assert.equal(j.error_code,'FUNDING_EXECUTION_EXPIRED');assert.equal(j.lease_until,null);assert.match(j.physical_table,/^pgboss\.[a-z0-9_]+$/);}
 return jobs[0];
}
function validateTables(actual){assert.deepEqual([...actual].sort(),[...TABLES,...RETAIN].sort(),'CATALOG_TABLE_SET_CHANGED');return TABLES.map(qualified).join(', ');}
function run(exe,args,env={}){const r=spawnSync(exe,args,{env:{...process.env,...env},encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024});if(r.status!==0)throw Error('CATALOG_RESET_TOOL_FAILED');return r.stdout;}
async function gates(c,t,state){
 const identity=(await c.query('SELECT current_database() AS db,inet_server_port() AS port')).rows[0];assert.equal(identity.db,'c4g_central_dev');assert.equal(identity.port,5432);
 const tenants=(await c.query('SELECT tenant_id::text,organization_id::text FROM public.tenant')).rows;assert.equal(tenants.length,1);assert.equal(tenants[0].tenant_id,state.tenantId);assert.equal(tenants[0].organization_id,state.organizationId);
 assert.equal((await t.query('SELECT current_database() AS db')).rows[0].db,'c4g_tenant_dev');
 const control=(await c.query('SELECT state,fence FROM opportunity_catalog.eu_source_control_v2')).rows;assert.equal(control.length,1);assert.equal(control[0].state,'QUIESCED');
 assert.equal(Number((await c.query("SELECT count(*) n FROM opportunity_catalog.funding_run WHERE status IN('QUEUED','RUNNING')")).rows[0].n),0,'FUNDING_RUN_PENDING');
 assert.equal(Number((await c.query("SELECT count(*) n FROM async_exec.outbox WHERE envelope->>'jobType'='funding_tenders.refresh' AND state IN('PENDING','UNCERTAIN','CLAIMED')")).rows[0].n),0,'FUNDING_OUTBOX_PENDING');
 await staleQueue(c);
 const rows=(await t.query("SELECT tablename FROM pg_tables WHERE schemaname='opportunity_catalog'")).rows;
 for(const r of rows)assert.equal(Number((await t.query(`SELECT count(*) n FROM ${qualified(r.tablename)}`)).rows[0].n),0,'TENANT_CATALOG_DEPENDENCIES_EXIST');
 assert.equal(Number((await t.query('SELECT count(*) n FROM organization_profile.pq1_evaluation')).rows[0].n),0,'TENANT_EVALUATIONS_EXIST');
 return control;
}
function preserved(data,queueTable){return Object.fromEntries(Object.entries(data).filter(([name])=>!TABLES.some(t=>name===`"opportunity_catalog"."${t}"`)&&(!queueTable||![queueTable,'"pgboss"."job"'].includes(name))));}
async function resetTransaction(c,t,state,commit){
 await c.query('BEGIN');
 try{
  await c.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
  const names=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='opportunity_catalog' ORDER BY tablename")).rows.map(x=>x.tablename);
  const list=validateTables(names);
  await c.query(`LOCK TABLE ${list}, ${RETAIN.map(qualified).join(', ')} IN ACCESS EXCLUSIVE MODE`);
  await gates(c,t,state);
  const stale=await staleQueue(c),queueTable=stale?.physical_table.split('.').map(quote).join('.');
  const queueBefore=(await c.query('SELECT to_jsonb(j) AS value FROM pgboss.job j ORDER BY name,id')).rows;
  const triggers=(await c.query("SELECT c.relname AS table_name,t.tgname,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relnamespace='opportunity_catalog'::regnamespace AND c.relname=ANY($1::text[]) AND (t.tgtype & 32)<>0 ORDER BY 1,2",[TABLES])).rows;
  const before=await snapshot(c);
  if(stale){const cancelled=await c.query("UPDATE pgboss.job SET state='cancelled',completed_on=clock_timestamp() WHERE id=$1 AND name='funding-tenders-refresh' AND state='active' RETURNING id",[STALE_JOB]);assert.equal(cancelled.rowCount,1);}
  for(const tr of triggers)await c.query(`ALTER TABLE ${qualified(tr.table_name)} DISABLE TRIGGER ${quote(tr.tgname)}`);
  await c.query(`TRUNCATE TABLE ${list} CONTINUE IDENTITY RESTRICT`);
  for(const tr of triggers){const action={O:'ENABLE',D:'DISABLE',R:'ENABLE REPLICA',A:'ENABLE ALWAYS'}[tr.tgenabled];assert(action);await c.query(`ALTER TABLE ${qualified(tr.table_name)} ${action} TRIGGER ${quote(tr.tgname)}`);}
  const after=await snapshot(c);
  for(const name of TABLES)assert.equal(after.data[`"opportunity_catalog"."${name}"`].count,0);
  assert.deepEqual(preserved(after.data,queueTable),preserved(before.data,queueTable),'UNRELATED_CENTRAL_DATA_CHANGED');
  const queueAfter=(await c.query('SELECT to_jsonb(j) AS value FROM pgboss.job j ORDER BY name,id')).rows;
  if(stale){const old=queueBefore.find(x=>x.value.id===STALE_JOB).value,now=queueAfter.find(x=>x.value.id===STALE_JOB).value;assert.equal(now.state,'cancelled');assert(now.completed_on);now.state=old.state;now.completed_on=old.completed_on;}
  assert.deepEqual(queueAfter,queueBefore,'UNRELATED_QUEUE_DATA_CHANGED');
  assert.deepEqual(after.sequences,before.sequences);
  const restored=(await c.query("SELECT c.relname AS table_name,t.tgname,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relnamespace='opportunity_catalog'::regnamespace AND c.relname=ANY($1::text[]) AND (t.tgtype & 32)<>0 ORDER BY 1,2",[TABLES])).rows;assert.deepEqual(restored,triggers);
  await c.query(commit?'COMMIT':'ROLLBACK');return {before:before.data,after:after.data,triggersRestored:triggers.length};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
}
async function main(){
 assert.deepEqual(process.argv.slice(2),['--execute-local-catalog-reset']);
 const config=cfg.readConfig(),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));target(config,state);
 // Application must already be stopped by the repository maintenance controller.
 run('powershell',['-NoProfile','-Command',"$ErrorActionPreference='Stop'; foreach($p in @(3000,5000)){if(@(Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue | Where-Object {$_.RemotePort -eq 0}).Count){exit 2}}; if(@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object {$_.CommandLine -match 'scripts/start-local\\.cjs|scripts/localPlatform/worker\\.js|scripts/startDev\\.js'}).Count){exit 3}"]);
 const folder=path.join(cfg.folder,'catalog-reset-'+new Date().toISOString().replaceAll(/[:.]/g,'-'));fs.mkdirSync(folder);
 const sid=run('whoami',['/user','/fo','csv','/nh']).match(/S-1-5-[0-9-]+/)?.[0];assert(sid);
 run('icacls',[folder,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F']);
 const cpool=new Pool({...cfg.connection(config,config.centralDatabase),max:1}),tpool=new Pool({...cfg.connection(config,config.tenantDatabase),max:1,options:'-c default_transaction_read_only=on'});
 const c=await cpool.connect(),t=await tpool.connect();
 try{
  const control=await gates(c,t,state),tenantBefore=await snapshot(t),centralBefore=await snapshot(c);
  assert.equal(centralBefore.data['"opportunity_catalog"."opportunity"'].count,538,'CATALOG_BASELINE_CHANGED');
  const version=(await c.query('SELECT version FROM public.c4g_schema_migration ORDER BY version DESC LIMIT 1')).rows[0].version;
  const schemaBefore=await require('../backend/src/security/centralSchemaManifest').assertCentralSchema(c,version);
  const bin='C:/Program Files/PostgreSQL/18/bin',dump=path.join(folder,'central-before-reset.dump');
  run(path.join(bin,'pg_dump.exe'),['--no-password','-h',config.host,'-p',String(config.port),'-U',config.user,'-d',config.centralDatabase,'-Fc','-f',dump],{PGPASSWORD:config.password});
  const listing=run(path.join(bin,'pg_restore.exe'),['--list',dump]);assert(listing.includes('TABLE DATA opportunity_catalog opportunity '));
  // Decode all archive data before removal, not just its table of contents.
  run(path.join(bin,'pg_restore.exe'),['--data-only','-f',path.join(folder,'central-data-verification.sql'),dump]);
  const backup={file:path.relative(cfg.root,dump),bytes:fs.statSync(dump).size,sha256:sha(fs.readFileSync(dump)),archiveReadable:true,restoreToDatabaseTested:false};
  fs.writeFileSync(path.join(folder,'before.json'),JSON.stringify({backup,central:centralBefore.data,tenant:tenantBefore.data},null,2));
  await resetTransaction(c,t,state,false);
  assert.deepEqual((await snapshot(c)).data,centralBefore.data,'REHEARSAL_ROLLBACK_FAILED');
  const result=await resetTransaction(c,t,state,true);
  assert.deepEqual((await snapshot(t)).data,tenantBefore.data,'TENANT_CHANGED');
  assert.equal(await require('../backend/src/security/centralSchemaManifest').assertCentralSchema(c,version),schemaBefore);
  const after=await snapshot(c);for(const name of TABLES)assert.equal(after.data[`"opportunity_catalog"."${name}"`].count,0);
  const report={status:'PASS',completedAt:new Date().toISOString(),database:config.centralDatabase,backup,opportunitiesBefore:538,opportunitiesAfter:0,clearedTables:TABLES,retainedSecurityTables:RETAIN,cancelledExpiredCatalogueJob:STALE_JOB,sourceControl:control,tenantUnchanged:true,unrelatedCentralDataUnchanged:true,schemaUnchanged:true,rollbackRehearsal:'PASS',triggersRestored:result.triggersRestored};
  fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(cfg.root,'output/catalog-reset-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{c.release();t.release();await cpool.end();await tpool.end();}
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({status:'FAIL',code:e.code||'RESET_FAILED',detail:e.message,location:e.stack?.split('\n').find(line=>line.includes('reset-local-catalog.cjs:'))?.trim()}));process.exitCode=1;});
module.exports={TABLES,RETAIN,validateTables,preserved};
