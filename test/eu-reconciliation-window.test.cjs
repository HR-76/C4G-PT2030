'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const w=require('../scripts/eu-reconciliation-window.cjs'),backup=require('../backend/scripts/localPlatform/backupOpportunityV2');
const pkg=require('../backend/src/security/opportunityEuReconciliationMigrationPackage'),writer=require('../backend/src/security/opportunityEuWriterMigrationPackage'),old=require('../backend/src/security/opportunityV2MigrationPackage');
const id='42188168-9e32-4928-bf44-6d38e94388b7',scope={cycleId:w.CYCLE,runId:w.RUN,sourceFence:7,previewDigest:'a'.repeat(64)};
test('preparation CLI has one closed operation and no caller-selected source, database or scope',()=>{
 const args=['--prepare-window','--validation=output/opportunity-eu-reconciliation-validation-'+id+'/validation.json'];
 assert.deepEqual(w.args(args),{validation:args[1].slice(13)});
 for(const bad of [[],[...args,'--resume'],['--apply',args[1]],[args[0],'--validation=../validation.json']])assert.throws(()=>w.args(bad));
 assert.deepEqual(w.scopeOf({preview:{cycleId:w.CYCLE,run:{run_id:w.RUN},source:{fence:7}},previewDigest:scope.previewDigest}),scope);
 for(const v of [{cycleId:id,run:{run_id:w.RUN},source:{fence:7}},{cycleId:w.CYCLE,run:{run_id:id},source:{fence:7}}])assert.throws(()=>w.scopeOf({preview:v,previewDigest:scope.previewDigest}));
});
test('restored backup must bind exact approved expired work, both baselines and complete restoration',()=>{
 const value={status:'PASS',windowId:id,profile:backup.RECONCILIATION_PROFILE,packageDigest:pkg.packageDigest,reconciliation:scope,cleanup:true,noSourceDrift:true,aclRestricted:true,globalsMatch:true,baselines:{central:{version:writer.entry.version,fingerprint:writer.entry.schemaFingerprint},tenant:{version:old.tenantAddition.version,fingerprint:old.tenantAddition.schemaFingerprint}},databases:{central:{dataMatches:true,sourceStillMatches:true,preflight:true},tenant:{dataMatches:true,sourceStillMatches:true,preflight:true}}};
 assert.equal(w.validateBackup(value,id,scope),value);
 for(const change of [v=>v.windowId=w.CYCLE,v=>v.profile='EU_WRITER_PREPARATION',v=>v.reconciliation.runId=id,v=>v.reconciliation.previewDigest='b'.repeat(64),v=>v.baselines.central.version=pkg.entry.version,v=>v.databases.tenant.preflight=false,v=>v.cleanup=false,v=>v.globalsMatch=false,v=>v.noSourceDrift=false]){const v=structuredClone(value);change(v);assert.throws(()=>w.validateBackup(v,id,scope));}
});
