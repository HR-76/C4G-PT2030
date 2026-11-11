'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'../../..');
function workspace(outputDirectory){const destination=path.join(outputDirectory,'reconciliation-fixture-workspace');fs.mkdirSync(destination,{recursive:true});return destination;}
function planFixture({workspaceRoot,state,report}){
 const plans=require('../../../backend/src/opportunities/v2/euRunReconciliationPlan'),pkg=require('../../../backend/src/security/opportunityEuReconciliationMigrationPackage');
 const planId=randomUUID(),folder='output/opportunity-eu-reconciliation-'+planId,inputs={...report.inputHashes};
 function write(relative,value){const file=path.join(workspaceRoot,relative);assert(file.startsWith(workspaceRoot+path.sep));fs.mkdirSync(path.dirname(file),{recursive:true});const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');fs.writeFileSync(file,bytes);return {path:relative,sha256:plans.hash(bytes)};}
 for(const [relative,digest]of Object.entries(inputs)){const bytes=fs.readFileSync(path.join(root,relative));assert.equal(plans.hash(bytes),digest,'RECONCILIATION_FIXTURE_INPUT_DRIFT');const file=path.join(workspaceRoot,relative);assert(file.startsWith(workspaceRoot+path.sep));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
 for(const relative of plans.PRIVATE_FILES){const ref=write(relative,{syntheticConfiguration:true,path:relative});inputs[relative]=ref.sha256;}
 const now=new Date(),baseline=plans.baseline();
 // Explicit evidence-format fixtures. The test does not certify a habitual
 // backup, an earlier independent044 gate, or a real-person approval.
 const preview=write(folder+'/preview.json',{...state,readOnly:true,fixtureOnly:true});
 const backup=write(folder+'/backup.json',{status:'PASS',fixtureOnly:true,profile:'EU_RECONCILIATION',windowId:planId,packageDigest:pkg.packageDigest,cleanup:true,noSourceDrift:true,aclRestricted:true,globalsMatch:true,reconciliation:{cycleId:state.preview.cycleId,runId:state.preview.run.run_id,sourceFence:state.preview.source.fence,previewDigest:state.previewDigest},completedAt:now.toISOString(),
  baselines:{central:{version:baseline.centralVersion,fingerprint:baseline.centralFingerprint},tenant:{version:baseline.tenantVersion,fingerprint:baseline.tenantFingerprint}},
  databases:{central:{dataMatches:true,sourceStillMatches:true,preflight:true},tenant:{dataMatches:true,sourceStillMatches:true,preflight:true}},
  configuration:Object.fromEntries(plans.PRIVATE_FILES.map(file=>[file,{copied:true,sha256:inputs[file]}]))});
 const gate=write(folder+'/gate-format-fixture.json',{status:'PASS',fixtureOnly:true,gateType:'OPPORTUNITY_V2_EU_EXPIRED_RECONCILIATION',cleanup:true,isolated:true,habitualEnvironmentAccess:false,packageDigest:pkg.packageDigest,inputHashes:report.inputHashes,checks:[{name:'SYNTHETIC_APPROVAL_EVIDENCE_FORMAT_ONLY',status:'PASS'}]});
 const validation=write(folder+'/validation.json',{status:'PASS',fixtureOnly:true,inputs:report.inputHashes,gate});
 const plan=plans.buildReconciliationPlan({planId,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+3600000).toISOString(),state,inputs,evidence:{preview,backup,validation}});
 const reference=write(folder+'/plan.json',plan),loaded=plans.loadReconciliationPlan(workspaceRoot,planId);assert.deepEqual(loaded.plan,plan);
 return {plan,loaded,reference,planFile:path.join(workspaceRoot,reference.path),workspaceRoot};
}
module.exports={workspace,planFixture};
