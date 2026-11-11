'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const backup=require('../scripts/localPlatform/backupOpportunityV2');
const CYCLE='7266ad6b-8880-4ec1-9399-4751187831c5',RUN='75b462ed-a399-4bdb-bd96-ed18507761c9';
const scope=()=>({cycleId:CYCLE,runId:RUN,sourceFence:7,previewDigest:'a'.repeat(64)});
test('reconciliation backup has a separate closed profile and accepts only the registered043/034 predecessor',()=>{
 assert.equal(backup.RECONCILIATION_PROFILE,'EU_RECONCILIATION');
 const writer=require('../src/security/opportunityEuWriterMigrationPackage'),old=require('../src/security/opportunityV2MigrationPackage');
 const central={currentVersion:writer.entry.version,postgresMajor:18,fingerprint:writer.entry.schemaFingerprint},tenant={currentVersion:old.tenantAddition.version,schemaFingerprint:old.tenantAddition.schemaFingerprint};
 assert.equal(backup.assertBaseline(central,'central',backup.RECONCILIATION_PROFILE).version,writer.entry.version);
 assert.equal(backup.assertBaseline(tenant,'tenant',backup.RECONCILIATION_PROFILE).version,old.tenantAddition.version);
 for(const p of [{...central,currentVersion:writer.CENTRAL_BASELINE},{...central,currentVersion:'044_opportunity_eu_expired_reconciliation'},{...central,fingerprint:'b'.repeat(64)},{...central,postgresMajor:17}])assert.throws(()=>backup.assertBaseline(p,'central',backup.RECONCILIATION_PROFILE));
});
test('pending-work exception is bound to one cycle, one run, source epoch and exact preview',()=>{
 assert.deepEqual(backup.validateReconciliationScope(scope()),scope());
 for(const mutate of [v=>v.runId=CYCLE,v=>v.cycleId='other',v=>v.sourceFence=0,v=>v.previewDigest='bad',v=>v.extra=true,v=>delete v.runId]){const v=scope();mutate(v);assert.throws(()=>backup.validateReconciliationScope(v));}
});
test('reconciliation idle proof admits only the independently matched expired work, never a positive unrelated counter',()=>{
 const counts={funding:1,inbox:1,outbox:0,published:1,execution:1,admissionCompletion:0,admissionIdentity:0,onboarding:0,members:0};
 const matched={funding:1,inbox:1,outbox:0,published:1,execution:1};
 assert.equal(backup.assertReconciliationWork(counts,matched),true);
 for(const k of Object.keys(counts))assert.throws(()=>backup.assertReconciliationWork({...counts,[k]:counts[k]+1},matched));
 for(const bad of [{...matched,funding:0},{...matched,inbox:2},{...matched,outbox:1},{...matched,published:0},{...matched,execution:2},{...matched,other:0}])assert.throws(()=>backup.assertReconciliationWork(counts,bad));
 const noProjection={...counts,execution:0};assert.throws(()=>backup.assertReconciliationWork(noProjection,{...matched,execution:0}));
});

test('pause proof binds package, scope and stopped process receipt and cannot be serialized into authority',()=>{
 const input={windowId:CYCLE,packageDigest:require('../src/security/opportunityEuReconciliationMigrationPackage').packageDigest,profile:backup.RECONCILIATION_PROFILE,reconciliation:scope(),stopReceipt:{id:123,created:new Date().toISOString(),descendants:[123,124],verified:true,stopped:true}};
 assert.deepEqual(backup.validatePauseInput(input).reconciliation,scope());
 for(const edit of [v=>v.packageDigest='b'.repeat(64),v=>delete v.reconciliation,v=>v.reconciliation.runId=CYCLE,v=>v.profile='EU_WRITER_PREPARATION',v=>v.stopReceipt.stopped=false,v=>v.stopReceipt.descendants=[124],v=>v.extra=true]){const v=structuredClone(input);edit(v);assert.throws(()=>backup.validatePauseInput(v));}
 assert.throws(()=>backup.consumePauseProof({...input,provedAt:new Date().toISOString()}),/PAUSE_REQUIRED/);
});
