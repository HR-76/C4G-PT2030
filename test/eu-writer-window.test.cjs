'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {args,validateGate,validateBackup}=require('../scripts/eu-writer-window.cjs');
const pkg=require('../backend/src/security/opportunityEuWriterMigrationPackage');
test('043 preparation only accepts exact bounded mode and owned validation path',()=>{
 const path='output/opportunity-eu-writer-window-validation/validation.json';
 assert.equal(args(['--prepare-window','--validation='+path]).validation,path);
 for(const input of [[],['--execute'],['--prepare-window','--validation=../outside'],['--prepare-window','--validation='+path,'--resume']])assert.throws(()=>args(input));
});
test('043 requires current isolated writer gate and every passing check',()=>{
 const good={packageDigest:pkg.packageDigest,gateType:'OPPORTUNITY_V2_EU_WRITER',status:'PASS',cleanup:true,isolated:true,habitualEnvironmentAccess:false,inputHashes:{'backend/src/fundingTenders/euWriter.js':'a'.repeat(64)},checks:[{name:'writer',status:'PASS'}]};
 validateGate(good);
 for(const delta of [{packageDigest:'a'.repeat(64)},{status:'FAIL'},{cleanup:false},{isolated:false},{habitualEnvironmentAccess:true},{inputHashes:{}},{inputHashes:{'../outside':'a'.repeat(64)}},{checks:[]},{checks:[{name:'writer',status:'FAIL'}]}])assert.throws(()=>validateGate({...good,...delta}));
});
test('043 backup cannot reuse historical 035/033 proof or incomplete restoration',()=>{
 const old=require('../backend/src/security/opportunityV2MigrationPackage');
 const good={status:'PASS',profile:'EU_WRITER_PREPARATION',packageDigest:pkg.packageDigest,windowId:'window',cleanup:true,noSourceDrift:true,aclRestricted:true,baselines:{central:{version:pkg.CENTRAL_BASELINE,fingerprint:old.centralEntries.at(-1).schemaFingerprint},tenant:{version:'034_application_snapshot_v2',fingerprint:old.tenantAddition.schemaFingerprint}},databases:{central:{dataMatches:true,sourceStillMatches:true,preflight:true},tenant:{dataMatches:true,sourceStillMatches:true,preflight:true}}};
 validateBackup(good,'window');
 for(const delta of [{windowId:'other'},{profile:undefined},{status:'FAIL'},{cleanup:false},{noSourceDrift:false},{databases:{central:good.databases.central}},{baselines:{...good.baselines,central:{version:'035_funding_source_resolution'}}}])assert.throws(()=>validateBackup({...good,...delta},'window'));
});
test('actual plan builder binds the controlled cycle, both baselines and every tested input',()=>{
 const installed=require('../backend/src/security/opportunityV2MigrationPackage'),snapshot=require('../context/references/opportunity-v2/examples/eu-11145.json');
 const {buildPlan}=require('../scripts/eu-writer-window-plan.cjs'),{CONTROLLED_CYCLE,loadEuWriterWindowPlan}=require('../backend/src/opportunities/v2/euWriterWindowPlan');
 const sha='a'.repeat(64),id='12345678-1234-4123-8123-123456789012';
 const window=Object.fromEntries(['preview','backup','validation'].map(k=>[k,{path:'output/test/'+k+'.json',sha256:sha}]));
 const preview={central:{value:{version:pkg.CENTRAL_BASELINE,fingerprint:installed.centralEntries.at(-1).schemaFingerprint,sourceControl:{state:'QUIESCED',fence:3},expected:{opportunityId:id,revisionId:id,rowVersion:5},acceptedSnapshot:snapshot}},tenant:{value:{version:installed.tenantAddition.version,fingerprint:installed.tenantAddition.schemaFingerprint}}};
 const validation={gate:{inputHashes:{'backend/src/fundingTenders/euWriter.js':sha}},value:{inputs:{'scripts/eu-writer-window-plan.cjs':sha}}},backup={configuration:{'.tmp/local-platform/runtime.json':{sha256:sha}}};
 const plan=buildPlan({windowId:id,window,preview,backup,validation});assert.deepEqual(plan.controlledCycle,CONTROLLED_CYCLE);assert.equal(plan.actions.at(-1),'SUSPEND_EU_AND_VERIFY');assert.equal(Object.keys(plan.inputs).length,3);assert.equal(plan.accepted.contentDigest,require('../backend/src/opportunities/v2/digests').contentDigestV2(snapshot));
});
