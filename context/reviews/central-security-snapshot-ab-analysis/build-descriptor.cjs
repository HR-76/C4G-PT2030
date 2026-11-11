'use strict';
// Offline closure: pin evidence and copy mutable documentation into the final
// analysis directory. No SQL, HTTP, services, source edits or deletions.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const root=fs.realpathSync(path.resolve(__dirname,'../../..'));
const folder='context/reviews/central-security-snapshot-ab-analysis/final-684b1579f8614d7191bf6a0be8dc7378';
const bundle='output/central-snapshot-ab-5b9e4e70caa94f49a881fc11b39a47bb';
const priorBundle='output/central-snapshot-ab-94af372890614fa799765cd7293dd290';
const destination='context/references/performance/central-security-snapshot-ab.json';
const hash=b=>createHash('sha256').update(b).digest('hex'),references=new Map();
function actual(file){const result=fs.realpathSync(path.resolve(root,file));const rel=path.relative(root,result);assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));return result;}
function ref(file,expected){const target=actual(file),rel=path.relative(root,target).split(path.sep).join('/');let record=references.get(rel);if(!record){const bytes=fs.readFileSync(target);record={path:rel,sha256:hash(bytes),bytes:bytes.length};references.set(rel,record);}if(expected)assert.equal(record.sha256,expected);return record;}
function read(file){return JSON.parse(fs.readFileSync(actual(file),'utf8').replace(/^\uFEFF/,''));}
function harvest(value){if(!value||typeof value!=='object')return;if(typeof value.path==='string'&&/^[a-f0-9]{64}$/.test(value.sha256||''))ref(value.path,value.sha256);for(const item of Object.values(value))if(item&&typeof item==='object')harvest(item);}
function files(dir){for(const entry of fs.readdirSync(actual(dir),{withFileTypes:true}))if(entry.isFile())ref(dir+'/'+entry.name);}
assert(!fs.existsSync(path.resolve(root,destination)),'DESCRIPTOR_ALREADY_EXISTS');
const summary=read(folder+'/summary.json'),manifest=read(bundle+'/ab.json'),verification=read('output/central-snapshot-sql-development/final-verification.json');
assert.equal(summary.status,'DATA_PASS_PROTOCOL_FAIL');assert.equal(summary.validation.unexpectedIssueCount,0);assert.equal(summary.dataQuality.status,'DATA_PASS');assert.equal(summary.protocol.status,'FAIL');
assert.equal(verification.status,'PASS');assert.equal(verification.cleanup.ownedContainerCount,30);assert.equal(verification.cleanup.children.count,15);assert.equal(verification.cleanup.ownedContainersStillPresent.length,0);
assert.equal(summary.http.totals.recordedMeasured,280);assert.equal(summary.http.totals.recordedWarmups,55);assert.equal(summary.http.totals.warmupFailures.length,1);
harvest(summary.inputs);harvest(verification);
files(folder);files('output/central-snapshot-sql-development');files('output/central-snapshot-ab-continuation-development/8712f5a7fe25e32d1ac5509e1c3a562644e04b82c6caab2e2e66ba9853504cc6');
for(const b of [bundle,priorBundle]){
  ref(b+'/ab.json');const m=read(b+'/ab.json');
  for(const arm of ['A','B'])ref(b+'/'+m.variants[arm].archive.path,m.variants[arm].archive.sha256);
  ref(b+'/'+m.harness.archive.path,m.harness.archive.sha256);
  ref(b+'/'+m.parent.manifest.path,m.parent.manifest.sha256);ref(b+'/'+m.parent.archive.path,m.parent.archive.sha256);
  const local=read(b+'/evidence/local-validation/result.json');ref(b+'/evidence/local-validation/result.json');harvest(local);
}
for(const file of ['failure-analysis.json','derived-costs.json']){ref('context/reviews/central-security-snapshot-ab-analysis/'+file);harvest(read('context/reviews/central-security-snapshot-ab-analysis/'+file));}
ref('context/reviews/central-security-snapshot-ab-analysis/final-88dc1be92d3b47a4832e5affa509fbba/summary.json');
ref('context/reviews/central-security-snapshot-ab-analysis/final-88dc1be92d3b47a4832e5affa509fbba/analyze.cjs');
const closure=fs.mkdtempSync(path.resolve(root,folder,'closure-'));
const documentSnapshots=[];
for(const source of ['context/reviews/central-security-snapshot-sql-performance.md','context/features/central-security-snapshot-sql-performance.md','context/references/performance/central-snapshot-ab-continuation.md',path.relative(root,__filename).split(path.sep).join('/')]){
  const target=path.join(closure,documentSnapshots.length+'-'+path.basename(source));fs.copyFileSync(actual(source),target,fs.constants.COPYFILE_EXCL);documentSnapshots.push({currentPath:source,snapshot:ref(target)});
}
const continued=summary.inputs.continuation;
const result={schemaVersion:1,id:'central-security-snapshot-sql-ab-2026-10-31',generatedAt:new Date().toISOString(),status:'SQL_OPTIMIZATION_MEASURED_HTTP_PROTOCOL_FAILED',featureState:'Review',
  identity:summary.identity,manifest:ref(bundle+'/ab.json'),runtimeChanges:manifest.overlays,
  result:{metadataStatus:'PASS',metadataMeasured:2400,metadataWarmups:240,metadataFunctional:16,httpProtocol:'FAIL',dataQuality:'DATA_PASS',unexpectedValidationIssues:0,
    httpMeasured:280,httpMeasured200:280,httpWarmups:55,httpWarmupFailures:summary.http.totals.warmupFailures,httpMissingMeasured:8,httpMissingWarmups:1,
    httpMatchedMeasured:272,httpUnpairedMeasured:8,httpReadinessChecksInMeasurement:136,initialHttpReadinessChecks:34,
    edgeCaseParity:44,postLockProofs:8,authorityCheckpointCountsPreserved:true},
  metadata:summary.metadata.revisions.map(r=>({revision:r.revision,A:r.arms.A.latencyMs,B:r.arms.B.latencyMs,pairsBFasterAtP50:r.pairsBFasterAtP50,pairsBFasterAtP95:r.pairsBFasterAtP95,pairP50ChangePercent:r.pairP50ChangePercent,pairP95ChangePercent:r.pairP95ChangePercent})),
  http:{matched:summary.http.comparisons,uninterruptedSensitivity:summary.http.uninterruptedPairedComparisons,sensitivityPreSpecified:summary.http.sensitivity},
  validation:{backend:{passed:2244,skipped:7,failed:0},frontend:{passed:494},build:'PASS',commonFocused:31,commonSyntax:17,continuationTests:7,continuationSyntax:2,analyzerTests:11,
    result:ref(bundle+'/evidence/local-validation/result.json'),fullSuiteReuse:'B runtime and three backend regression overlays byte-identical; only common functional adapter changed, with fresh targeted checks.'},
  verification:ref('output/central-snapshot-sql-development/final-verification.json'),cleanup:{status:'PASS',containersAbsent:30,childrenExitVerified:15,forcedTerminations:0},
  evidence:{analysis:ref(folder+'/summary.json'),costs:ref('context/reviews/central-security-snapshot-ab-analysis/derived-costs.json'),failure:ref('context/reviews/central-security-snapshot-ab-analysis/failure-analysis.json'),inputs:summary.inputs},
  processOutcomes:{exploratoryReadinessExit:1,finalReadinessExit:0,metadataExit:0,httpOriginalExit:1,httpContinuationExit:1,continuation:'COMPLETED_WITH_INHERITED_CAMPAIGN_FAILURE',analysisExit:1,analysisStatus:summary.status},
  continuation:{sourceReport:ref(summary.inputs.http.path,summary.inputs.http.sha256),result:ref(continued.path,continued.sha256),executedIndices:[5,6,7],failedArmRepeated:false},
  postMeasurementTestRename:{from:'test/central-snapshot-ab-continuation.test.cjs',to:'test/central-snapshot-http-continuation.test.cjs',sha256:'8ae7ff533db32661a7ce96c70712bacb840f564c84ad1fd0707b73eb8fa222ce',contentChanged:false,reason:'Exclude external continuation test from future generic A/B common captures; same directory/imports. Archived source/test/logs keep original names.'},
  documentSnapshots,limitations:summary.limitations,nextStep:'Diagnose the distributed slowdown behind LEASE_TIMEOUT and repeat the complete H protocol with unchanged authority checks and limits.',references:[]};
assert.equal(hash(fs.readFileSync(actual(result.postMeasurementTestRename.to))),result.postMeasurementTestRename.sha256);
result.references=[...references.values()].sort((a,b)=>a.path.localeCompare(b.path));
for(const item of result.references){const bytes=fs.readFileSync(actual(item.path));assert.equal(bytes.length,item.bytes);assert.equal(hash(bytes),item.sha256);}
fs.writeFileSync(path.resolve(root,destination),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify({status:result.status,referencesVerified:result.references.length,path:destination,sha256:hash(fs.readFileSync(path.resolve(root,destination)))})+'\n');
