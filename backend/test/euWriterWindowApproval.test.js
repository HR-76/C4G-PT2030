'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const pkg=require('../src/security/opportunityEuWriterMigrationPackage');
const installed=require('../src/security/opportunityV2MigrationPackage');
const {euWriterConfiguration}=require('../src/fundingTenders/euWriter');
const {createUuidV7}=require('../src/audit/uuidV7');
const {validateEuWriterWindowPlan,planDigest,ACTIONS,CONTROLLED_CYCLE}=require('../src/opportunities/v2/euWriterWindowPlan');
const {approvalEvent,approvalInput}=require('../src/opportunities/v2/writerWindowApproval');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {verifyEvidence,PRIVATE_FILES}=require('../src/opportunities/v2/euWriterWindowPlan');
const sha='a'.repeat(64),now=Date.now();
function fixture(){return {kind:'eu-writer-window-plan-v1',windowId:randomUUID(),createdAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+1800000).toISOString(),
 package:{packageId:pkg.PACKAGE_ID,packageDigest:pkg.packageDigest,sqlSha256:pkg.entry.upChecksum},
 baseline:{centralVersion:pkg.CENTRAL_BASELINE,tenantVersion:installed.tenantAddition.version,centralFingerprint:installed.centralEntries.at(-1).schemaFingerprint,tenantFingerprint:installed.tenantAddition.schemaFingerprint},
 writer:euWriterConfiguration(),source:{state:'QUIESCED',fence:3},expected:{opportunityId:randomUUID(),revisionId:randomUUID(),rowVersion:5},accepted:{contentDigest:sha,snapshotDigest:sha},
 evidence:Object.fromEntries(['preview','backup','validation'].map(k=>[k,{path:'output/eu-window-test/'+k+'.json',sha256:sha}])),inputs:{'backend/src/opportunities/v2/writerWindowApproval.js':sha},actions:[...ACTIONS],controlledCycle:{...CONTROLLED_CYCLE}};}
test('operational approval plan is closed, fixed to 042→043 and cannot authorize candidate acceptance',()=>{
 const plan=fixture();assert.equal(validateEuWriterWindowPlan(plan,now).kind,plan.kind);assert.match(planDigest(plan),/^[a-f0-9]{64}$/);
 for(const mutate of [p=>p.extra=true,p=>p.actions.push('ACCEPT_11145'),p=>p.controlledCycle.maxCycles=2,p=>p.source.state='ACTIVE',p=>p.package.sqlSha256=sha,p=>p.writer.mappingDigest=sha,p=>p.baseline.tenantVersion='033',p=>p.expiresAt=new Date(now+7200000).toISOString(),p=>p.inputs={'../secret':sha}]){const changed=structuredClone(plan);mutate(changed);assert.throws(()=>validateEuWriterWindowPlan(changed,now));}
 assert.throws(()=>validateEuWriterWindowPlan(plan,now+3600001),{code:'OPPORTUNITY_V2_WINDOW_EXPIRED'});
});
test('approval uses a deterministic UUIDv7 request and critical plan-specific audit intent',()=>{
 const plan=fixture(),requestId=createUuidV7({now:()=>now}),actorId=randomUUID(),input={windowId:plan.windowId,requestId,planDigest:planDigest(plan)};
 assert.equal(approvalInput(input,plan,now).requestId,requestId);
 const first=approvalEvent(plan,input,actorId),second=approvalEvent(plan,input,actorId);
 assert.deepEqual(first,second);assert.equal(first.event.auditClass,'CRITICAL_PRE_EFFECT');assert.equal(first.event.streamType,'OPERATIONS');assert.equal(first.event.payload.semanticDigest,input.planDigest);assert.equal(first.event.resource.type,'EU_WRITER_WINDOW');
 assert.notEqual(first.digest,approvalEvent(plan,input,randomUUID()).digest);
 assert.throws(()=>approvalInput({...input,requestId:randomUUID()},plan,now));
 assert.throws(()=>approvalInput({...input,planDigest:sha},plan,now),{code:'OPPORTUNITY_V2_WINDOW_CHANGED'});
});
test('hashed evidence refuses changed source facts, stale metadata, wrong gates and omitted tested inputs',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'eu-window-unit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
 const write=(file,data)=>{const bytes=typeof data==='string'?data:JSON.stringify(data);fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),bytes);return {path:file,sha256:sha256(bytes)};};
 const snapshot=structuredClone(require('../../context/references/opportunity-v2/examples/eu-11145.json')),p=fixture();
 p.accepted={contentDigest:require('../src/opportunities/v2/digests').contentDigestV2(snapshot),snapshotDigest:require('../src/opportunities/v2/reconciliation').rawSnapshotDigest(snapshot)};
 const input='backend/src/opportunities/v2/writerWindowApproval.js',file=write(input,'fixture');p.inputs={[input]:file.sha256};
 const config=Object.fromEntries(PRIVATE_FILES.map(f=>[f,{copied:true,sha256:write(f,'synthetic-private-configuration').sha256}]));
 const preview={readOnly:true,source:{candidateSnapshot:snapshot,mappingDigest:require('../src/opportunities/v2/activationArchive').implementationDigest('EU_FUNDING_TENDERS',snapshot.provenance.mappingVersion),metadata:{observedAt:new Date(now-2000).toISOString()}},central:{value:{version:p.baseline.centralVersion,fingerprint:p.baseline.centralFingerprint,expected:p.expected,acceptedSnapshot:snapshot,sourceControl:p.source}},tenant:{value:{version:p.baseline.tenantVersion,fingerprint:p.baseline.tenantFingerprint}}};
 const backup={status:'PASS',profile:'EU_WRITER_PREPARATION',windowId:p.windowId,packageDigest:pkg.packageDigest,completedAt:new Date(now-2000).toISOString(),cleanup:true,noSourceDrift:true,aclRestricted:true,configuration:config,baselines:Object.fromEntries(['central','tenant'].map(k=>[k,{version:p.baseline[k+'Version'],fingerprint:p.baseline[k+'Fingerprint']}])),databases:{central:{dataMatches:true,sourceStillMatches:true,preflight:true},tenant:{dataMatches:true,sourceStillMatches:true,preflight:true}}};
 const gate={status:'PASS',cleanup:true,isolated:true,habitualEnvironmentAccess:false,gateType:'OPPORTUNITY_V2_EU_WRITER',packageDigest:pkg.packageDigest,package:{id:pkg.PACKAGE_ID,entry:pkg.entry},inputHashes:{...p.inputs},checks:['EU_WRITER_REAL_QUEUE_ARCHIVE_UNCHANGED_PRESERVES_HEAD','EU_WRITER_SAFE_CHANGE_ONE_REVISION_AND_NORMALIZED_SQL','EU_WRITER_LOSS_AND_NEW_IDENTITIES_REQUIRE_DURABLE_REVIEW','EU_WRITER_TRANSIENT_RETRY_PRESERVES_LINEAGE_AND_ORIGINAL_DEADLINE','EXECUTOR_PHYSICAL_READERS_V1_V2_SQL_AND_TENANT_RLS_PRESERVATION'].map(name=>({name,status:'PASS'}))};
 function persist(){p.evidence.preview=write('output/unit/preview.json',preview);p.evidence.backup=write('output/unit/backup.json',backup);p.evidence.validation=write('output/unit/validation.json',{status:'PASS',inputs:{...p.inputs},gate:write('output/unit/gate.json',gate)});}
 persist();assert.doesNotThrow(()=>verifyEvidence(root,p));
 preview.source.candidateSnapshot=structuredClone(snapshot);preview.source.candidateSnapshot.description.title.value+=' drift';persist();assert.throws(()=>verifyEvidence(root,p));preview.source.candidateSnapshot=snapshot;
 preview.source.metadata.observedAt=new Date(now-7200000).toISOString();persist();assert.throws(()=>verifyEvidence(root,p));preview.source.metadata.observedAt=new Date(now-2000).toISOString();
 gate.gateType='OTHER';persist();assert.throws(()=>verifyEvidence(root,p));gate.gateType='OPPORTUNITY_V2_EU_WRITER';
 gate.inputHashes['backend/src/other.js']=sha;persist();assert.throws(()=>verifyEvidence(root,p));
});
test('live approval binds the existing v2 head, quiescent source and absence of protected state without data writes',async()=>{
 const {assertCurrentWindowState}=require('../src/opportunities/v2/writerWindowApproval'),snapshot=require('../../context/references/opportunity-v2/examples/eu-11145.json'),p=fixture();
 p.accepted={contentDigest:require('../src/opportunities/v2/digests').contentDigestV2(snapshot),snapshotDigest:require('../src/opportunities/v2/reconciliation').rawSnapshotDigest(snapshot)};
 const state={...p.source,pendingRuns:0,otherPendingRuns:0,activeRunLeases:0,activeInboxLeases:0,activeOutboxLeases:0};
 const row={lifecycle_state:'ACTIVE',current_schema_version:2,current_revision_id:p.expected.revisionId,row_version:p.expected.rowVersion,content_digest:p.accepted.contentDigest,snapshot};let protectedState=false;const queries=[];
 const client={async query(sql){queries.push(sql);if(sql.includes('SELECT state,fence'))return {rows:[p.source]};if(sql.includes('eu_source_state_v2'))return {rows:[{state}]};if(sql.startsWith('SELECT o.'))return {rows:[row]};if(sql.includes('SELECT opportunity_id'))return {rows:[{opportunity_id:p.expected.opportunityId}]};if(sql.includes(' AS protected'))return {rows:[{protected:protectedState}]};return {rows:[]};}};
 assert.equal(await assertCurrentWindowState(client,p),true);
 state.pendingRuns=1;await assert.rejects(assertCurrentWindowState(client,p),{code:'OPPORTUNITY_V2_WINDOW_STATE_CHANGED'});state.pendingRuns=0;
 row.row_version++;await assert.rejects(assertCurrentWindowState(client,p));row.row_version--;
 protectedState=true;await assert.rejects(assertCurrentWindowState(client,p));
 assert.equal(queries.some(sql=>/^(INSERT|UPDATE|DELETE)/.test(sql)),false);
});
test('a preparation ledger must be the complete registered 042 prefix, never an already installed 043',()=>{
 const {assertWindowLedger}=require('../src/opportunities/v2/writerWindowApproval');
 const {knownManifest,requiredCentralMigrations}=require('../src/security/centralMigrationManifest');
 const rows=requiredCentralMigrations(knownManifest).map(e=>({version:e.version,checksum_sha256:e.checksum,irreversible:e.irreversible}));
 assert.throws(()=>assertWindowLedger(rows),{code:'OPPORTUNITY_V2_WINDOW_BASELINE_CHANGED'});
 const baseline=rows.filter(r=>r.version<=pkg.CENTRAL_BASELINE);assert.equal(assertWindowLedger(baseline),pkg.CENTRAL_BASELINE);
 assert.throws(()=>assertWindowLedger(baseline.slice(1)));assert.throws(()=>assertWindowLedger(baseline.map((r,i)=>i? r:{...r,checksum_sha256:sha})));
});
