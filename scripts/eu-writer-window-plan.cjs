'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const cfg=require('../backend/scripts/localPlatform/config');
const {readFile,readValidation,validateBackup}=require('./eu-writer-window.cjs');
const {ACTIONS,CONTROLLED_CYCLE,loadEuWriterWindowPlan,validateEuWriterWindowPlan}=require('../backend/src/opportunities/v2/euWriterWindowPlan');
const pkg=require('../backend/src/security/opportunityEuWriterMigrationPackage');
const {rawSnapshotDigest}=require('../backend/src/opportunities/v2/reconciliation');
const {contentDigestV2}=require('../backend/src/opportunities/v2/digests');
const hash=b=>createHash('sha256').update(b).digest('hex');
function args(argv){assert(Array.isArray(argv)&&argv.length===1&&/^--window=[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(argv[0]));return argv[0].slice(9);}
function buildPlan({windowId,window,preview,backup,validation,createdAt=new Date().toISOString()}){
 const central=preview.central.value,tenant=preview.tenant.value,inputs={...validation.gate.inputHashes,...validation.value.inputs};for(const [file,proof]of Object.entries(backup.configuration))inputs[file]=proof.sha256;
 return validateEuWriterWindowPlan({kind:'eu-writer-window-plan-v1',windowId,createdAt,expiresAt:new Date(Date.parse(createdAt)+3600000).toISOString(),
  package:{packageId:pkg.PACKAGE_ID,packageDigest:pkg.packageDigest,sqlSha256:pkg.entry.upChecksum},baseline:{centralVersion:central.version,tenantVersion:tenant.version,centralFingerprint:central.fingerprint,tenantFingerprint:tenant.fingerprint},writer:require('../backend/src/fundingTenders/euWriter').euWriterConfiguration(),source:{state:central.sourceControl.state,fence:central.sourceControl.fence},expected:central.expected,
  accepted:{contentDigest:contentDigestV2(central.acceptedSnapshot),snapshotDigest:rawSnapshotDigest(central.acceptedSnapshot)},evidence:{preview:window.preview,backup:{path:window.backup.path,sha256:window.backup.sha256},validation:window.validation},inputs,actions:[...ACTIONS],controlledCycle:{...CONTROLLED_CYCLE}});
}
function prepare(windowId){
 args(['--window='+windowId]);const base='output/opportunity-eu-writer-window-'+windowId,window=JSON.parse(readFile(base+'/window.json'));
 assert.equal(window.status,'PASS');assert.equal(window.windowId,windowId);assert.equal(window.packageDigest,pkg.packageDigest);assert.equal(window.healthRestored,true);
 for(const field of ['migrationsApplied','configurationChanged','euResumed','acceptanceApplied'])assert.equal(window[field],false);
 const validation=readValidation(window.validation.path);assert.equal(validation.sha256,window.validation.sha256);
 const previewBytes=readFile(window.preview.path);assert.equal(hash(previewBytes),window.preview.sha256);const preview=JSON.parse(previewBytes);
 const backupBytes=readFile(window.backup.path);assert.equal(hash(backupBytes),window.backup.sha256);const backup=validateBackup(JSON.parse(backupBytes),windowId);
 const plan=buildPlan({windowId,window,preview,backup,validation});
 const file=path.join(cfg.root,base,'plan.json');fs.writeFileSync(file,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});const loaded=loadEuWriterWindowPlan(cfg.root,windowId);
 fs.writeFileSync(path.join(cfg.root,base,'plan-summary.json'),JSON.stringify({windowId,planDigest:loaded.planDigest,expiresAt:plan.expiresAt,package:plan.package,source:plan.source,expected:plan.expected,scope:'PREPARATION_ONLY'},null,2)+'\n',{flag:'wx'});
 return {windowId,planDigest:loaded.planDigest,expiresAt:plan.expiresAt,evidence:base+'/plan.json'};
}
if(require.main===module){try{console.log(JSON.stringify(prepare(args(process.argv.slice(2)))));}catch(error){console.error(error.code?.startsWith('OPPORTUNITY_V2_WINDOW_')?error.code:'EU_WRITER_WINDOW_PLAN_FAILED');process.exitCode=1;}}
module.exports={args,buildPlan,prepare};
