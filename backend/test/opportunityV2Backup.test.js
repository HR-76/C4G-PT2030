'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const backup=require('../scripts/localPlatform/backupOpportunityV2');
const ID='11111111-1111-4111-8111-111111111111',TENANT='22222222-2222-4222-8222-222222222222',GEN='33333333-3333-4333-8333-333333333333';
const pause=()=>({windowId:ID,packageDigest:'a'.repeat(64),stopReceipt:{id:45,created:'2026-10-31T12:00:00.000Z',descendants:[45,46],verified:true,stopped:true}});
test('backup CLI is closed and an unbranded or serialized pause never reads configuration or opens a database',async()=>{
 backup.args(['--backup-and-restore']);for(const value of [[],['--apply'],['--backup-and-restore','--host=elsewhere']])assert.throws(()=>backup.args(value));
 const cfg=require('../scripts/localPlatform/config'),original=cfg.readConfig;let calls=0;cfg.readConfig=()=>{calls++;throw Error('CONFIG_MUST_NOT_BE_READ');};
 try{for(const proof of [undefined,{},pause(),JSON.parse(JSON.stringify(pause()))])await assert.rejects(backup.main(['--backup-and-restore'],{pauseProof:proof}),{code:'OPPORTUNITY_BACKUP_PAUSE_REQUIRED'});assert.equal(calls,0);}finally{cfg.readConfig=original;}
});
test('pause receipt binds the package, window and exact verified stopped process set',()=>{
 const input=pause(),valid=backup.validatePauseInput(input);assert(Object.isFrozen(valid.stopReceipt.descendants));input.stopReceipt.descendants.push(999);assert.deepEqual(valid.stopReceipt.descendants,[45,46]);
 for(const mutate of [v=>{v.windowId='other';},v=>{v.packageDigest='bad';},v=>{v.actor='injected';},v=>{v.stopReceipt.verified=false;},v=>{v.stopReceipt.stopped=false;},v=>{v.stopReceipt.id=0;},v=>{v.stopReceipt.created='invalid';},v=>{v.stopReceipt.descendants=[46];},v=>{v.stopReceipt.descendants=[45,45];},v=>{v.stopReceipt.descendants=[45,'46'];}]){const value=pause();mutate(value);assert.throws(()=>backup.validatePauseInput(value));}
});
test('backup pins Central035 and Tenant033 instead of silently accepting another baseline',()=>{
 assert.deepEqual(backup.assertBaseline({currentVersion:backup.BASELINES.central,postgresMajor:18,fingerprint:'a'.repeat(64)},'central'),{version:backup.BASELINES.central,fingerprint:'a'.repeat(64)});
 backup.assertBaseline({currentVersion:backup.BASELINES.tenant,schemaFingerprint:'b'.repeat(64)},'tenant');
 for(const [proof,name]of [[{currentVersion:'034_future',schemaFingerprint:'b'.repeat(64)},'tenant'],[{currentVersion:backup.BASELINES.central,postgresMajor:17},'central'],[{currentVersion:'042_future',postgresMajor:18},'central']])assert.throws(()=>backup.assertBaseline(proof,name));
});

test('writer preparation profile binds the stopped window to the exact registered043 package',()=>{
 const writer=require('../src/security/opportunityEuWriterMigrationPackage'),input={...pause(),profile:'EU_WRITER_PREPARATION',packageDigest:writer.packageDigest};
 const valid=backup.validatePauseInput(input);assert.equal(valid.profile,'EU_WRITER_PREPARATION');assert.equal(valid.packageDigest,writer.packageDigest);assert(Object.isFrozen(valid));
 for(const mutate of [v=>{v.packageDigest='a'.repeat(64);},v=>{v.profile='OTHER';},v=>{v.profile={central:'042_opportunity_eu_source_control_v2'};},v=>{v.baseline='043_opportunity_eu_writer_v2';},v=>{v.tenantManifest=[];}]){const value=structuredClone(input);mutate(value);assert.throws(()=>backup.validatePauseInput(value),{code:'OPPORTUNITY_BACKUP_PAUSE_REQUIRED'});}
 assert.equal(Object.hasOwn(backup.validatePauseInput(pause()),'profile'),false);
});

test('writer preparation admits only physical042 and034 with the registered fingerprints',()=>{
 const installed=require('../src/security/opportunityV2MigrationPackage'),central=installed.centralEntries.at(-1),tenant=installed.tenantAddition,profile='EU_WRITER_PREPARATION';
 const proofs={central:{currentVersion:central.version,postgresMajor:18,fingerprint:central.schemaFingerprint},tenant:{currentVersion:tenant.version,schemaFingerprint:tenant.schemaFingerprint}};
 for(const name of ['central','tenant'])assert.deepEqual(backup.assertBaseline(proofs[name],name,profile),{version:proofs[name].currentVersion,fingerprint:name==='central'?central.schemaFingerprint:tenant.schemaFingerprint});
 for(const [proof,name]of [[{...proofs.central,currentVersion:'043_opportunity_eu_writer_v2'},'central'],[{...proofs.central,currentVersion:backup.BASELINES.central},'central'],[{...proofs.central,fingerprint:'a'.repeat(64)},'central'],[{...proofs.central,postgresMajor:17},'central'],[{...proofs.tenant,currentVersion:backup.BASELINES.tenant},'tenant'],[{...proofs.tenant,schemaFingerprint:'b'.repeat(64)},'tenant']])assert.throws(()=>backup.assertBaseline(proof,name,profile),{code:'OPPORTUNITY_BACKUP_BASELINE_MISMATCH'});
 assert.throws(()=>backup.assertBaseline(proofs.central,'central','OTHER'),{code:'OPPORTUNITY_BACKUP_PROFILE_INVALID'});
 assert.throws(()=>backup.assertBaseline(proofs.central,'unrecognized',profile),{code:'OPPORTUNITY_BACKUP_BASELINE_MISMATCH'});
 assert.throws(()=>backup.assertBaseline(proofs.central,'central'),{code:'OPPORTUNITY_BACKUP_BASELINE_MISMATCH'});
});

test('serialized writer pause and arbitrary baseline options never grant a backup capability',async()=>{
 const writer=require('../src/security/opportunityEuWriterMigrationPackage'),input={...pause(),profile:'EU_WRITER_PREPARATION',packageDigest:writer.packageDigest};
 const cfg=require('../scripts/localPlatform/config'),original=cfg.readConfig;let calls=0;cfg.readConfig=()=>{calls++;throw Error('CONFIG_MUST_NOT_BE_READ');};
 try{await assert.rejects(backup.main(['--backup-and-restore'],{pauseProof:backup.validatePauseInput(input)}),{code:'OPPORTUNITY_BACKUP_PAUSE_REQUIRED'});await assert.rejects(backup.main(['--backup-and-restore'],{pauseProof:JSON.parse(JSON.stringify(input)),profile:'EU_WRITER_PREPARATION'}),{code:'OPPORTUNITY_BACKUP_PAUSE_REQUIRED'});assert.equal(calls,0);}finally{cfg.readConfig=original;}
});

test('writer pause capability preserves its selected profile and cannot be serialized, replayed or rebound',async()=>{
 // Isolated module instance: simulate only the stopped-process probe. This is
 // a capability unit test, not evidence of a real maintenance pause.
 const cp=require('node:child_process'),file=require.resolve('../scripts/localPlatform/backupOpportunityV2'),cached=require.cache[file],original=cp.spawnSync;let probes=0;
 try{
  cp.spawnSync=()=>{probes++;return {status:0,stdout:''};};delete require.cache[file];const isolated=require(file);
  const input={...pause(),profile:'EU_WRITER_PREPARATION',packageDigest:require('../src/security/opportunityEuWriterMigrationPackage').packageDigest};
  const token=await isolated.provePausedWindow(input);input.profile='OTHER';input.packageDigest='b'.repeat(64);
  assert.equal(probes,1);assert.equal(isolated.consumePauseProof(token).profile,'EU_WRITER_PREPARATION');
  assert.throws(()=>isolated.consumePauseProof(token),{code:'OPPORTUNITY_BACKUP_PAUSE_REQUIRED'});
  assert.throws(()=>isolated.consumePauseProof(JSON.parse(JSON.stringify(token))),{code:'OPPORTUNITY_BACKUP_PAUSE_REQUIRED'});
  await assert.rejects(isolated.provePausedWindow({...pause(),profile:'EU_WRITER_PREPARATION'}),{code:'OPPORTUNITY_BACKUP_PAUSE_REQUIRED'});assert.equal(probes,1);
 }finally{cp.spawnSync=original;require.cache[file]=cached;}
});

test('public writer backup receipt retains its closed purpose without exposing private material',()=>{
 const value=backup.publicSummary({profile:'EU_WRITER_PREPARATION',packageDigest:require('../src/security/opportunityEuWriterMigrationPackage').packageDigest,password:'PRIVATE',status:'PASS'});
 assert.equal(value.profile,'EU_WRITER_PREPARATION');assert(!JSON.stringify(value).includes('PRIVATE'));
});
test('scope refuses another tenant, generation or live database connection outside the copied tenant',()=>{
 const config={tenantDatabase:'c4g_tenant_dev'},state={tenantId:TENANT,organizationId:ID,generationId:GEN};
 const rows=()=>({tenants:[{tenant_id:TENANT,organization_id:ID}],generations:[{tenant_id:TENANT,database_generation_id:GEN,database_ref:config.tenantDatabase}],connections:[{tenant_id:TENANT,database_generation_id:GEN,database_ref:config.tenantDatabase}]});
 assert.deepEqual(backup.assertScopeRows(rows(),config,state),{tenants:1,activeGenerations:1,activeConnectionVersions:1});
 for(const mutate of [r=>r.tenants.push({tenant_id:GEN,organization_id:GEN}),r=>{r.tenants[0].organization_id=GEN;},r=>r.generations.push({...r.generations[0]}),r=>{r.generations[0].database_generation_id=ID;},r=>{r.connections=[];},r=>{r.connections[0].database_ref='other_database';}]){const r=rows();mutate(r);assert.throws(()=>backup.assertScopeRows(r,config,state),{code:'OPPORTUNITY_BACKUP_TENANT_SCOPE'});}
});
test('isolated restore identity requires its owned directory, separate exact port, loopback and PG18',()=>{
 const cluster=path.resolve('owned-backup/restore-cluster'),row={directory:cluster,port:'25432',address:'127.0.0.1',version:'180001'};backup.assertIsolatedIdentity(row,cluster,25432);
 // PostgreSQL inet::text includes /32 for an IPv4 host, including loopback.
 backup.assertIsolatedIdentity({...row,address:'127.0.0.1/32'},cluster,25432);
 for(const changed of [{...row,directory:path.resolve('habitual-cluster')},{...row,port:'5432'},{...row,address:'192.0.2.1'},{...row,address:'127.0.0.1/24'},{...row,address:'::1/128'},{...row,version:'170000'}])assert.throws(()=>backup.assertIsolatedIdentity(changed,cluster,25432));
});
test('complete inventory hashes the row multiset, sequences and database properties without exposing row values',async()=>{
 const queries=[],rows=[{value:'{"secret":"private-content"}'},{value:'{"id":2}'}];
 const client={query:async sql=>{queries.push(sql);if(sql.includes('FROM pg_class'))return {rows:[{nspname:'private',relname:'quoted"table'}]};if(sql.startsWith('SELECT to_jsonb'))return {rows};if(sql.includes('FROM pg_sequences'))return {rows:[{schemaname:'private',sequencename:'seq'}]};if(sql.includes('last_value'))return {rows:[{last_value:'9007199254740993',is_called:true}]};if(sql.includes('pg_largeobject_metadata'))return {rows:[{count:0}]};if(sql.includes('FROM pg_database'))return {rows:[{datname:'isolated',owner:'postgres'}]};throw Error('Unexpected SQL');}};
 const value=await backup.snapshot(client);assert.equal(value.data['"private"."quoted""table"'].count,2);assert.match(value.data['"private"."quoted""table"'].sha256,/^[a-f0-9]{64}$/);assert.equal(value.sequences['"private"."seq"'].last_value,'9007199254740993');assert.equal(value.database.datname,'isolated');assert(!JSON.stringify(value).includes('private-content'));assert(queries.every(sql=>sql.startsWith('SELECT')));
 assert.deepEqual(backup.tableInventory(rows),backup.tableInventory([...rows].reverse()));assert.notDeepEqual(backup.tableInventory(rows),backup.tableInventory(rows.slice(0,1)));
 const unsupported={query:async sql=>sql.includes('pg_largeobject_metadata')?{rows:[{count:1}]}:client.query(sql)};await assert.rejects(backup.snapshot(unsupported),{code:'OPPORTUNITY_BACKUP_LARGE_OBJECT_REQUIRES_REVIEW'});
});
test('public backup receipt omits private inventories, role SQL, credentials and raw process data',()=>{
 const report={status:'PASS',windowId:ID,packageDigest:'a'.repeat(64),backup:'.tmp/local-platform/opportunity-v2-backup-id',aclRestricted:true,noSourceDrift:true,cleanup:true,privateSnapshot:{secret:'secret-marker'},rolesSql:'secret-marker',password:'secret-marker',stopReceipt:{commandLine:'secret-marker'}};
 const summary=backup.publicSummary(report);assert.equal(summary.noSourceDrift,true);assert(!JSON.stringify(summary).includes('secret-marker'));assert(!Object.hasOwn(summary,'stopReceipt'));
});

test('backup quiescence includes both durable async queues and privileged external operations',async()=>{
 const rows={central:{funding:0,execution:0,inbox:0,outbox:0,published:0,admissionCompletion:0,admissionIdentity:0,onboarding:0,members:0},tenant:{inbox:0,outbox:0,published:0}};
 for(const scope of ['central','tenant']){
  let sql;const counts=await backup.pendingWork({query:async value=>{sql=value;return{rows:[rows[scope]]};}},scope);
  assert.equal(backup.isQuiescentWork(counts,scope),true);
  for(const key of Object.keys(counts)){assert.equal(backup.isQuiescentWork({...counts,[key]:1},scope),false);const incomplete={...counts};delete incomplete[key];assert.equal(backup.isQuiescentWork(incomplete,scope),false);}
  for(const state of ['PUBLISHED','UNCERTAIN'])assert(sql.includes(state));
  for(const state of ['QUEUED','RETRY_WAIT','RECONCILIATION_REQUIRED'])assert.equal(sql.includes(state),scope==='central');
  for(const relation of ['entity_admission_completion','entity_admission','platform_onboarding_operation','platform_member_operation'])assert.equal(sql.includes('public.'+relation),scope==='central');
 }
 await assert.rejects(backup.pendingWork({query:async()=>{throw Error('must not query');}},'other'),/SCOPE/);
});

test('tenant quiescence uses tenant inbox/outbox and never queries the Central execution projection',async()=>{
 const client={query:async sql=>{assert(!sql.includes('async_exec.execution'));assert(!sql.includes('opportunity_catalog.funding_run'));return{rows:[{inbox:0,outbox:0,published:0}]};}};
 assert.equal(backup.isQuiescentWork(await backup.pendingWork(client,'tenant'),'tenant'),true);
});

test('stale funding projection exclusion requires its terminal run and exact immutable envelope lineage',async()=>{
 let query;await backup.pendingWork({query:async sql=>{query=sql;return{rows:[]};}},'central');
 for(const proof of ["o.envelope->>'authority'='CENTRAL'","o.envelope->>'jobType'='funding_tenders.refresh'","r.status IN ('SUCCESS','ERROR')","o.envelope_digest=e.envelope_digest","o.content_digest=e.content_digest","o.envelope->>'executionId'=e.execution_id::text"])assert(query.includes(proof),proof);
 assert(!query.includes('deadline_at'));assert(!query.includes('deadlineAt'));
});
