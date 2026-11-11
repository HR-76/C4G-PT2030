'use strict';
const {createHash}=require('node:crypto'),{isDeepStrictEqual}=require('node:util');
const {cloneData,deepFreeze}=require('./data'),{readSafe,PRIVATE_FILES}=require('./euWriterWindowPlan');
const {UUID,SHA,assertPreview}=require('./euRunReconciliationState');
const pkg=require('../../security/opportunityEuReconciliationMigrationPackage'),writer=require('../../security/opportunityEuWriterMigrationPackage'),installed=require('../../security/opportunityV2MigrationPackage');
const ACTIONS=Object.freeze(['INSTALL_044','TERMINATE_EXPIRED_RUN_AND_CYCLE','PRESERVE_TARGETS_AND_PUBLISHED_OUTBOX','VERIFY_SOURCE_REMAINS_QUIESCED']);
const REQUIRED_PROOF_INPUTS=Object.freeze(['scripts/eu-reconciliation-window.cjs','scripts/eu-reconciliation-install.cjs','scripts/eu-reconciliation-execute.cjs','scripts/lib/eu-reconciliation-browser.cjs','backend/src/opportunities/v2/euRunReconciliation.js','backend/src/opportunities/v2/euRunReconciliationPlan.js','backend/src/opportunities/v2/euRunReconciliationState.js','backend/database/central/candidates/opportunity_eu_expired_reconciliation.up.sql']);
const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
function fail(code='OPPORTUNITY_V2_RECONCILIATION_INVALID'){throw Object.assign(Error(code),{code});}
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const relative=p=>typeof p==='string'&&p.length<=256&&!/[\\:]/.test(p)&&p.split('/').every(x=>x&&x!=='.'&&x!=='..');
const instant=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const inputPath=p=>relative(p)&&(PRIVATE_FILES.includes(p)||['backend/.env.example','context/features/repository-cleanup.md','context/features/dashboard-tenant-read-cost.md'].includes(p)||/^(backend\/src\/|backend\/database\/|backend\/scripts\/|backend\/test\/|scripts\/|frontend\/src\/|test\/|context\/references\/opportunity-v2\/)/.test(p));
const baseline=()=>({centralVersion:pkg.CENTRAL_BASELINE,centralFingerprint:writer.entry.schemaFingerprint,tenantVersion:installed.tenantAddition.version,tenantFingerprint:installed.tenantAddition.schemaFingerprint});
function validateReconciliationPlan(raw,now=Date.now()){
 let p;try{p=cloneData(raw,{maxBytes:4*1024*1024});}catch{fail();}
 if(!exact(p,['kind','planId','createdAt','expiresAt','package','baseline','cycleId','runId','source','preview','previewDigest','inputs','evidence','actions'])||p.kind!=='eu-expired-reconciliation-plan-v1'||![p.planId,p.cycleId,p.runId].every(v=>UUID.test(v))||!instant(p.createdAt)||!instant(p.expiresAt))fail();
 const created=Date.parse(p.createdAt),expires=Date.parse(p.expiresAt);if(created>now+5000||expires<=created||expires>created+3600000)fail();if(expires<=now)fail('OPPORTUNITY_V2_RECONCILIATION_EXPIRED');
 if(!isDeepStrictEqual(p.package,{packageId:pkg.PACKAGE_ID,packageDigest:pkg.packageDigest,sqlSha256:pkg.entry.upChecksum})||!isDeepStrictEqual(p.baseline,baseline())||!isDeepStrictEqual(p.actions,ACTIONS))fail();
 assertPreview(p.preview);if(!SHA.test(p.previewDigest)||p.preview.cycleId!==p.cycleId||p.preview.run.run_id!==p.runId||!isDeepStrictEqual(p.source,{state:'QUIESCED',fence:p.preview.source.fence}))fail();
 if(!exact(p.evidence,['preview','backup','validation'])||!Object.values(p.evidence).every(v=>exact(v,['path','sha256'])&&relative(v.path)&&v.path.startsWith('output/')&&v.path.endsWith('.json')&&SHA.test(v.sha256)))fail();
 if(!p.inputs||Array.isArray(p.inputs)||typeof p.inputs!=='object'||!Object.keys(p.inputs).length||Object.keys(p.inputs).length>3000||!Object.entries(p.inputs).every(([f,h])=>inputPath(f)&&SHA.test(h))||PRIVATE_FILES.some(f=>!Object.hasOwn(p.inputs,f)))fail();return deepFreeze(p);
}
function buildReconciliationPlan({planId,createdAt,expiresAt,state,inputs,evidence},now=Date.now()){
 return validateReconciliationPlan({kind:'eu-expired-reconciliation-plan-v1',planId,createdAt,expiresAt,package:{packageId:pkg.PACKAGE_ID,packageDigest:pkg.packageDigest,sqlSha256:pkg.entry.upChecksum},baseline:baseline(),cycleId:state.preview.cycleId,runId:state.preview.run.run_id,source:{state:'QUIESCED',fence:state.preview.source.fence},preview:state.preview,previewDigest:state.previewDigest,inputs,evidence,actions:ACTIONS},now);
}
function verified(root,reference){const bytes=readSafe(root,reference.path,32*1024*1024);if(hash(bytes)!==reference.sha256)fail('OPPORTUNITY_V2_RECONCILIATION_CHANGED');return JSON.parse(bytes);}
function loadReconciliationPlan(root,planId,now=Date.now()){
 try{
 if(!UUID.test(planId))fail();const plan=validateReconciliationPlan(JSON.parse(readSafe(root,`output/opportunity-eu-reconciliation-${planId}/plan.json`,4*1024*1024)),now);if(plan.planId!==planId)fail();
 const preview=verified(root,plan.evidence.preview),backup=verified(root,plan.evidence.backup),validation=verified(root,plan.evidence.validation);
 if(preview.previewDigest!==plan.previewDigest||!isDeepStrictEqual(preview.preview,plan.preview)||preview.readOnly!==true)fail('OPPORTUNITY_V2_RECONCILIATION_CHANGED');
 if(backup.status!=='PASS'||backup.profile!=='EU_RECONCILIATION'||backup.windowId!==planId||backup.packageDigest!==pkg.packageDigest||backup.cleanup!==true||backup.noSourceDrift!==true||backup.aclRestricted!==true||backup.globalsMatch!==true
 ||!isDeepStrictEqual(backup.reconciliation,{cycleId:plan.cycleId,runId:plan.runId,sourceFence:plan.source.fence,previewDigest:plan.previewDigest}))fail('OPPORTUNITY_V2_RECONCILIATION_CHANGED');
 for(const name of ['central','tenant'])if(backup.baselines?.[name]?.version!==plan.baseline[name+'Version']||backup.baselines[name].fingerprint!==plan.baseline[name+'Fingerprint']||backup.databases?.[name]?.dataMatches!==true||backup.databases[name].sourceStillMatches!==true||backup.databases[name].preflight!==true)fail('OPPORTUNITY_V2_RECONCILIATION_CHANGED');
 if(!instant(backup.completedAt)||Date.parse(backup.completedAt)>Date.parse(plan.createdAt)||Date.parse(plan.createdAt)-Date.parse(backup.completedAt)>3600000)fail('OPPORTUNITY_V2_RECONCILIATION_CHANGED');
 if(validation.status!=='PASS'||!validation.gate)fail('OPPORTUNITY_V2_RECONCILIATION_CHANGED');const gate=verified(root,validation.gate);
 if(gate.status!=='PASS'||gate.cleanup!==true||gate.isolated!==true||gate.habitualEnvironmentAccess!==false||gate.gateType!=='OPPORTUNITY_V2_EU_EXPIRED_RECONCILIATION'||gate.packageDigest!==pkg.packageDigest||!Array.isArray(gate.checks)||!gate.checks.length||gate.checks.some(c=>c.status!=='PASS'))fail('OPPORTUNITY_V2_RECONCILIATION_CHANGED');
 for(const tested of [validation.inputs,gate.inputHashes])if(!tested||Array.isArray(tested)||typeof tested!=='object'||!Object.keys(tested).length||Object.entries(tested).some(([f,h])=>!inputPath(f)||!SHA.test(h)||plan.inputs[f]!==h))fail('OPPORTUNITY_V2_RECONCILIATION_CHANGED');
 if(REQUIRED_PROOF_INPUTS.some(f=>!SHA.test(gate.inputHashes[f]||'')))fail('OPPORTUNITY_V2_RECONCILIATION_CHANGED');
 for(const [file,sha] of Object.entries(plan.inputs))if(hash(readSafe(root,file))!==sha)fail('OPPORTUNITY_V2_RECONCILIATION_CHANGED');
 for(const file of PRIVATE_FILES)if(backup.configuration?.[file]?.copied!==true||backup.configuration[file].sha256!==plan.inputs[file])fail('OPPORTUNITY_V2_RECONCILIATION_CHANGED');
 return deepFreeze({plan,previewDigest:plan.previewDigest});
 }catch(e){if(e.code?.startsWith('OPPORTUNITY_V2_RECONCILIATION_'))throw e;fail('OPPORTUNITY_V2_RECONCILIATION_CHANGED');}
}
module.exports={ACTIONS,PRIVATE_FILES,REQUIRED_PROOF_INPUTS,hash,baseline,validateReconciliationPlan,buildReconciliationPlan,loadReconciliationPlan};
