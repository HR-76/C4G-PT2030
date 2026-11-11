'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const service=require('../src/opportunities/v2/euRunReconciliation');
function preview(){const id='019a4030-0000-7000-8000-000000000001',digest='a'.repeat(64),deadline='2026-10-31T16:44:48.588Z';return {cycleId:id,source:{state:'QUIESCED',fence:7,writerMode:'CANONICAL_V2',writerPolicy:'eu-existing-v2.0',writerMappingDigest:digest,pendingRuns:1,expiredPendingRuns:1,unrecoverablePendingRuns:1,otherPendingRuns:0,activeRunLeases:0,activeInboxLeases:0,activeOutboxLeases:0,incompatiblePendingRuns:0},run:{run_id:id,source_code:'EU_FUNDING_TENDERS',status:'RUNNING',eu_writer_mode:'CANONICAL_V2',eu_writer_policy:'eu-existing-v2.0',eu_writer_mapping_digest:digest,eu_source_held:true},cycle:{cycle_id:id,status:'RUNNING'},batch:{run_id:id,cycle_id:id},inbox:{state:'PROCESSING',consumer:'funding-central-v1',idempotency_key:id,organization_id:null,job_type:'funding_tenders.refresh',execution_id:id,digest_sha256:digest},execution:{state:'QUEUED',execution_id:id,organization_id:null,outbox_id:null,job_type:'funding_tenders.refresh',deadline_at:deadline,delivery_kind:'INITIAL',lineage_version:1,attempt:1,root_execution_id:id,previous_execution_id:null,replay_request_id:null,content_digest:digest,envelope_digest:digest},outbox:{state:'PUBLISHED',organization_id:null,outbox_id:id,digest_sha256:digest,content_digest:digest,envelope_digest:digest,delivery_kind:'INITIAL',lineage_version:1,attempt:1,root_execution_id:id,previous_execution_id:null,replay_request_id:null,envelope:{executionId:id,payload:{runId:id},jobType:'funding_tenders.refresh',deadlineAt:deadline}},expiry:{runExpired:true,runLeaseExpired:true,inboxLeaseExpired:true,executionExpired:true,envelopeExpired:true},counts:{pendingInCycle:1,outboxes:1,successors:0}};}
test('real INITIAL projection may retain null outbox_id only with exact immutable lineage and digests',()=>{
 const p=preview();assert.equal(service.assertPreview(p),p);
 for(const field of ['content_digest','envelope_digest','attempt','root_execution_id','previous_execution_id','replay_request_id']){const changed=structuredClone(p);changed.execution[field]='mismatch';assert.throws(()=>service.assertPreview(changed),/RECONCILIATION_STATE_CHANGED/);}
 const changed=structuredClone(p);changed.execution.delivery_kind='RETRY';assert.throws(()=>service.assertPreview(changed),/RECONCILIATION_STATE_CHANGED/);
});
test('reconciliation refuses a different cycle and a non-quiescent source',()=>{
 assert.throws(()=>service.assertPreview({cycleId:'00000000-0000-4000-8000-000000000001'}),/RECONCILIATION_STATE_CHANGED/);
 assert.throws(()=>service.assertPreview({source:{state:'ACTIVE'}}),/RECONCILIATION_STATE_CHANGED/);
});
test('a queued cycle cannot be approved because the SQL expiry scope requires RUNNING',()=>{
 const p=preview();p.cycle.status='QUEUED';assert.throws(()=>service.assertPreview(p),/RECONCILIATION_STATE_CHANGED/);
});
test('reconciliation terminal effects preserve all targets and the published outbox',()=>{
 assert.deepEqual(service.PROPOSED_CHANGES,{runStatus:'ERROR',cycleStatus:'ERROR',errorCode:'FUNDING_EXECUTION_EXPIRED',inboxState:'FAILED',inboxResult:'EXPIRED',executionState:'EXPIRED',outboxState:'PUBLISHED',targetsChanged:false});
});
test('reconciliation requests are closed, UUIDv7 and bound to the exact preview',()=>{
 const id='019a4030-0000-7000-8000-000000000001',digest='a'.repeat(64),plan={planId:id,previewDigest:digest,createdAt:new Date(parseInt(id.replaceAll('-','').slice(0,12),16)-1000).toISOString()};
 assert.equal(service.validateRequest({planId:id,requestId:id,previewDigest:digest},plan,false,Date.parse(plan.createdAt)+2000).previewDigest,digest);
 assert.throws(()=>service.validateRequest({planId:id,requestId:id,previewDigest:digest,actorId:id},plan,false),/RECONCILIATION_INVALID/);
 assert.throws(()=>service.validateRequest({planId:id,requestId:id,previewDigest:'b'.repeat(64)},plan,false),/RECONCILIATION_CHANGED/);
});
test('critical approval binds the entire plan as well as the stable data preview',()=>{
 const id='019a4030-0000-7000-8000-000000000001',plan={planId:id,previewDigest:'a'.repeat(64),inputs:{'backend/src/a.js':'b'.repeat(64)}},input={requestId:id};
 const a=service.reconciliationEvent(plan,input,id),b=service.reconciliationEvent({...plan,inputs:{'backend/src/a.js':'c'.repeat(64)}},input,id);
 assert.equal(a.event.streamType,'OPERATIONS');assert.equal(a.event.actor.type,'HUMAN');assert.equal(a.event.auditClass,'CRITICAL_PRE_EFFECT');assert.equal(a.event.payload.scopeDigest,plan.previewDigest);assert.notEqual(a.event.payload.semanticDigest,b.event.payload.semanticDigest);
 assert.equal(a.event.resource.id,id);assert.equal(a.event.actor.membershipId,null);
});
test('all execution lineage, deadline and future successors are closed before a plan is built',()=>{
 for(const alter of [p=>{p.counts.successors=1;},p=>{p.execution.deadline_at='2030-01-01T00:00:00Z';},p=>{p.source.pendingRuns=2;},p=>{p.expiry.runLeaseExpired=false;},p=>{p.outbox.state='PENDING';}]){const p=preview();alter(p);assert.throws(()=>service.assertPreview(p),/RECONCILIATION_STATE_CHANGED/);}
});
test('default, accepted and writer packages stop at their historical versions',()=>{
 const m=require('../src/security/centralMigrationManifest'),pkg=require('../src/security/opportunityEuReconciliationMigrationPackage');
 assert.equal(m.manifest.at(-1).version,'035_funding_source_resolution');
 assert.equal(m.registeredManifest.at(-1).version,'042_opportunity_eu_source_control_v2');
 assert.equal(m.writerManifest.at(-1).version,'043_opportunity_eu_writer_v2');
 assert.equal(m.reconciliationManifest.at(-1).version,pkg.entry.version);
 assert.equal(m.migrationSql(pkg.entry.version,'up').checksum,pkg.entry.upChecksum);
});
test('registered trigger retains every 043 guard byte except the protected expiry allow branch',()=>{
 const fs=require('node:fs'),path=require('node:path'),start='CREATE OR REPLACE FUNCTION opportunity_catalog.guard_eu_write_v2()';
 const old=fs.readFileSync(path.join(__dirname,'../database/central/candidates/opportunity_eu_writer_v2.up.sql'),'utf8'),current=fs.readFileSync(path.join(__dirname,'../database/central/candidates/opportunity_eu_expired_reconciliation.up.sql'),'utf8');
 const body=sql=>sql.slice(sql.indexOf(start),sql.indexOf('END $$;',sql.indexOf(start))+7);
 assert.equal(body(current).replace(' IF opportunity_catalog.allow_eu_expired_effect_v1(TG_TABLE_NAME,TG_OP,j,oldj) THEN RETURN NEW; END IF;\n',''),body(old));
 assert.ok(current.includes(service.PREVIEW_SQL.replace(/\$1/g,'p_cycle')),'preview statement must be exactly the one used on043');
});
test('reconciliation security fingerprint binds forced audit RLS and each policy predicate',async()=>{
 const m=require('../src/security/euRunReconciliationSecurityManifest');let predicate='organization_id IS NULL';
 const client={query:async sql=>({rows:sql.includes('pg_policy')?[{name:'audit_eu_expired_read_v1',roles:['c4g_audit_owner'],using:predicate}]:sql.includes('pg_class')?[{schema:'audit',name:'event',relrowsecurity:true,relforcerowsecurity:true}]:[]})};
 const before=await m.euRunReconciliationSecuritySnapshot(client);assert.equal(before.auditPolicies.length,1);assert.equal(before.relations[0].relforcerowsecurity,true);
 predicate='true';const after=await m.euRunReconciliationSecuritySnapshot(client);assert.notEqual(m.digest(before),m.digest(after));await assert.rejects(m.assertEuRunReconciliationSecurity(client,m.digest(before)),{code:'EU_RECONCILIATION_SECURITY_DRIFT'});
});
test('catalog reader can inspect reconciliation policies without application schema USAGE',async()=>{
 const m=require('../src/security/euRunReconciliationSecurityManifest'),policy={name:'audit_eu_expired_read_v1',command:'r',permissive:true,roles:['c4g_audit_owner'],using_expression:"organization_id IS NULL",check_expression:null};
 const queries=[],client={query:async sql=>{queries.push(sql);if(/'[^']+\.[^']+'\s*::regclass/i.test(sql))throw Object.assign(Error('permission denied for schema audit'),{code:'42501'});return {rows:sql.includes('pg_policy')?[policy]:[]};}};
 const snapshot=await m.euRunReconciliationSecuritySnapshot(client);assert.deepEqual(snapshot.auditPolicies,[policy]);
 const query=queries.find(sql=>sql.includes('pg_policy'));assert.match(query,/JOIN pg_class c ON c\.oid=p\.polrelid/);assert.match(query,/JOIN pg_namespace n ON n\.oid=c\.relnamespace/);assert.match(query,/n\.nspname='audit' AND c\.relname='event'/);assert.match(query,/ORDER BY p\.polname$/);
});
test('plan evidence rejects an empty or unrelated gate and pins the actual executor code',()=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),root=fs.mkdtempSync(path.join(os.tmpdir(),'c4g-reconciliation-test-'));
 const id=crypto.randomUUID(),now=Date.now(),createdAt=new Date(now).toISOString(),pkg=require('../src/security/opportunityEuReconciliationMigrationPackage');
 const write=(file,value)=>{const abs=path.join(root,file);fs.mkdirSync(path.dirname(abs),{recursive:true});const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value));fs.writeFileSync(abs,bytes);return {path:file,sha256:service.hash(bytes)};};
 try{
 const inputs={};for(const file of [...service.PRIVATE_FILES,...service.REQUIRED_PROOF_INPUTS])inputs[file]=write(file,'synthetic isolated evidence fixture').sha256;
 const baseline=service.baseline(),state={preview:preview(),previewDigest:'e'.repeat(64)};
 const previewRef=write('output/preview.json',{...state,readOnly:true});
 const backup={status:'PASS',profile:'EU_RECONCILIATION',windowId:id,packageDigest:pkg.packageDigest,cleanup:true,noSourceDrift:true,aclRestricted:true,globalsMatch:true,reconciliation:{cycleId:state.preview.cycleId,runId:state.preview.run.run_id,sourceFence:state.preview.source.fence,previewDigest:state.previewDigest},completedAt:new Date(now-1000).toISOString(),baselines:{central:{version:baseline.centralVersion,fingerprint:baseline.centralFingerprint},tenant:{version:baseline.tenantVersion,fingerprint:baseline.tenantFingerprint}},databases:{central:{dataMatches:true,sourceStillMatches:true,preflight:true},tenant:{dataMatches:true,sourceStillMatches:true,preflight:true}},configuration:Object.fromEntries(service.PRIVATE_FILES.map(f=>[f,{copied:true,sha256:inputs[f]}]))};
 const gate={status:'PASS',cleanup:true,isolated:true,habitualEnvironmentAccess:false,gateType:'OPPORTUNITY_V2_EU_EXPIRED_RECONCILIATION',packageDigest:pkg.packageDigest,checks:[{name:'SYNTHETIC_FIXTURE_ONLY',status:'PASS'}],inputHashes:Object.fromEntries(service.REQUIRED_PROOF_INPUTS.map(f=>[f,inputs[f]]))};
 const save=()=>{const backupRef=write('output/backup.json',backup),gateRef=write('output/gate.json',gate),validationRef=write('output/validation.json',{status:'PASS',gate:gateRef,inputs:gate.inputHashes});const p=service.buildReconciliationPlan({planId:id,createdAt,expiresAt:new Date(now+60000).toISOString(),state,inputs,evidence:{preview:previewRef,backup:backupRef,validation:validationRef}},now);write(`output/opportunity-eu-reconciliation-${id}/plan.json`,p);};
 save();assert.equal(service.loadReconciliationPlan(root,id,now).plan.planId,id);
 backup.globalsMatch=false;save();assert.throws(()=>service.loadReconciliationPlan(root,id,now),/RECONCILIATION_CHANGED/);backup.globalsMatch=true;
 backup.reconciliation.runId=id;save();assert.throws(()=>service.loadReconciliationPlan(root,id,now),/RECONCILIATION_CHANGED/);backup.reconciliation.runId=state.preview.run.run_id;
 gate.checks=[];save();assert.throws(()=>service.loadReconciliationPlan(root,id,now),/RECONCILIATION_CHANGED/);gate.checks=[{status:'PASS'}];
 gate.gateType='UNRELATED';save();assert.throws(()=>service.loadReconciliationPlan(root,id,now),/RECONCILIATION_CHANGED/);gate.gateType='OPPORTUNITY_V2_EU_EXPIRED_RECONCILIATION';
 gate.inputHashes={};save();assert.throws(()=>service.loadReconciliationPlan(root,id,now),/RECONCILIATION_CHANGED/);
 }finally{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(root).startsWith('c4g-reconciliation-test-'));fs.rmSync(root,{recursive:true});}
});
