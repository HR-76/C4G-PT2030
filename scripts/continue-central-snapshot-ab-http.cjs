'use strict';
// External, hash-approved orchestration only. Workload code remains the captured
// 58f2 child CLI. Never rerun the failed arm or convert the campaign to PASS.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash,randomUUID}=require('node:crypto');
const PINS=Object.freeze({
  bundle:'output/central-snapshot-ab-5b9e4e70caa94f49a881fc11b39a47bb',
  id:'central-snapshot-ab-58f2f8910abee80f',
  manifestSha256:'252c80d48081fe9768d02e9d393060b89d1e32864b62943903aae9bcb9691278',
  readinessPath:'evidence/6858547a52ed431d8718719bbd1ed9fe/report.json',
  readinessSha256:'20b7175d004270c7350a530188dc7f212dfa0180d55c59ae5436eac8a88c8ffd',
  failedPath:'evidence/bfd7495e00394b85821c568571e26908/report.json',
  failedSha256:'d94e22e10d38da5ab2aab116a395462a1ff77c8d75b49214e1d01c379cae03fe'
});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const failure=code=>Object.assign(Error(code),{code});
const contained=(base,target)=>{const r=path.relative(base,target);return Boolean(r&&r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r));};
function safeError(error){return{code:/^[A-Z0-9_]+$/.test(error?.code||'')?error.code:'CONTINUATION_FAILED',name:error?.name||'Error',reason:/^[A-Z0-9_]+$/.test(error?.message||'')?error.message:null};}
function parseArgs(args){
  const out={};
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(['--isolated','--continue-http'].includes(arg)){assert(!out[arg.slice(2)]);out[arg.slice(2)]=true;}
    else if(['manifest','tls-dir','readiness-report','failed-report','source-sha'].some(k=>arg==='--'+k)){
      const key=arg.slice(2);assert(!out[key]&&args[i+1]&&!args[i+1].startsWith('--'));out[key]=args[++i];
    }else assert.fail('CONTINUATION_UNKNOWN_ARGUMENT');
  }
  assert(out.isolated&&out['continue-http']&&['manifest','tls-dir','readiness-report','failed-report','source-sha'].every(k=>out[k]),'CONTINUATION_EXPLICIT_INVOCATION_REQUIRED');
  assert.match(out['source-sha'],/^[a-f0-9]{64}$/);return out;
}
function fullPlan(){return [['A','B'],['B','A'],['A','B'],['B','A']].flatMap((order,pairIndex)=>order.map(arm=>({revision:'043',arm,kind:'http',pairIndex})));}
function remainingPlan(){return fullPlan().map((s,index)=>({...s,index})).slice(5);}
function bindings(identity){return{abId:identity.id,sourceSetDigest:identity.sourceSetDigest,manifestSha256:identity.manifestSha256,harnessDigest:identity.harnessDigest,variantDigests:{A:identity.variants.A.sourceSetDigest,B:identity.variants.B.sourceSetDigest},seedDigest:identity.protocol.seedDigest};}
function assertBindings(report,identity){for(const [key,value]of Object.entries(bindings(identity)))assert.deepEqual(report[key],value,'CONTINUATION_BINDING_'+key);}
function assertStageIdentity(entry,identity){
  assert(Number.isInteger(entry.index)&&entry.index>=0&&entry.index<8);const expected=fullPlan()[entry.index];
  for(const [key,value]of Object.entries(expected)){assert.equal(entry[key],value);assert.equal(entry.result?.[key],value);}
  assert.equal(entry.result.index,entry.index);assert.equal(entry.result.mode,'measure-http');assertBindings(entry.result,identity);
}
function assertSafeCompletion(entry){
  assert.equal(entry.cleanup?.status,'PASS','CONTINUATION_RESOURCE_CLEANUP_FAILED');
  assert.equal(entry.cleanup.resources?.length,2);assert(entry.cleanup.resources.every(r=>r.removed===true),'CONTINUATION_RESOURCE_REMOVAL_UNVERIFIED');
  if(entry.resources)assert.deepEqual(entry.cleanup.resources.map(r=>r.id).sort(),entry.resources.map(r=>r.id).sort());
  assert.equal(entry.childCleanup?.exitVerified,true,'CONTINUATION_CHILD_EXIT_UNVERIFIED');
  assert.equal(entry.childCleanup.terminated,false,'CONTINUATION_FORCED_CHILD_TERMINATION');
  assert.equal(entry.result?.cleanup,true,'CONTINUATION_CHILD_CLEANUP_FAILED');
  assert.equal(entry.result.sourceIntegrityAfter,'PASS','CONTINUATION_SOURCE_INTEGRITY_FAILED');
  assert.equal(entry.result.httpReadiness?.status,'PASS','CONTINUATION_HTTP_READINESS_FAILED');
}
function classifyCompletedStage(entry,identity){
  assertStageIdentity(entry,identity);assertSafeCompletion(entry);
  assert.equal(entry.failure,undefined,'CONTINUATION_ORCHESTRATION_FAILURE');
  const http=entry.result.http;assert(http&&Array.isArray(http.attempts)&&Array.isArray(http.warmups),'CONTINUATION_WORKLOAD_EVIDENCE_MISSING');
  assert(http.attempts.length<=36&&http.warmups.length<=7,'CONTINUATION_EXTRA_ATTEMPTS');
  if(entry.result.status==='PASS'){
    assert.equal(entry.processFailure,undefined,'CONTINUATION_PASS_WITH_PROCESS_FAILURE');
    assert.equal(entry.status,'PASS');assert.equal(http.status,'PASS');assert.equal(http.attempts.length,36);assert.equal(http.warmups.length,7);return'PASS';
  }
  assert.equal(entry.processFailure?.code,'FUNCTIONAL_CHILD_FAILED','CONTINUATION_UNEXPECTED_PROCESS_FAILURE');
  assert.equal(entry.status,'FAIL');assert.equal(entry.result.status,'FAIL');assert.equal(http.status,'FAIL','CONTINUATION_NON_WORKLOAD_FAILURE');
  return'WORKLOAD_FAIL';
}
function validateFailedParent(parent,identity){
  assertBindings(parent,identity);assert.equal(parent.mode,'measure-http');assert.equal(parent.status,'FAIL');
  assert.equal(parent.cleanup,true);assert.equal(parent.sourceIntegrityAfter,'PASS');assert.deepEqual(parent.images,identity.protocol.images);
  assert.equal(parent.stages.length,5,'CONTINUATION_ORIGINAL_STAGE_COUNT');
  for(const [index,entry]of parent.stages.entries()){
    assert.equal(entry.index,index);
    // The original frozen parent names its launcher failure `failure`.
    // Translate that field only for admission; original evidence is untouched.
    let completed=entry;
    if(index===4&&entry.failure){assert.equal(entry.failure.code,'FUNCTIONAL_CHILD_FAILED');completed={...entry,processFailure:entry.failure,failure:undefined};}
    assert.equal(classifyCompletedStage(completed,identity),index===4?'WORKLOAD_FAIL':'PASS');
  }
  const partial=parent.stages[4].result.http;
  assert.equal(partial.attempts.length,28);assert.equal(partial.warmups.length,6);
  const warm=partial.warmups.at(-1);assert.equal(warm.replica,4);assert.equal(warm.scenario,'dashboard-c4-two-tenants');assert.equal(warm.tenant,0);assert.equal(warm.status,503);assert.equal(warm.code,'SERVICE_UNAVAILABLE');
  return true;
}
async function continueStages({report,identity,runStage,save=()=>{}}){
  report.workloadFailureIndices=[];
  try{
    for(const stage of remainingPlan()){
      if(report.cleanup!==true)throw failure('CONTINUATION_PREVIOUS_CLEANUP_FAILED');
      const entry=await runStage(stage);report.stages.push(entry);save();
      let classification;try{classification=classifyCompletedStage(entry,identity);}catch(error){if(entry.cleanup?.status!=='PASS'||entry.result?.cleanup!==true||entry.childCleanup?.exitVerified!==true)report.cleanup=false;throw error;}
      if(classification==='WORKLOAD_FAIL')report.workloadFailureIndices.push(stage.index);
      save();
    }
    report.continuationStatus='COMPLETED';
  }catch(error){report.continuationStatus='STOPPED';throw error;}
  finally{report.status='FAIL';report.campaignStatus='FAIL';report.campaignCompleteness='INCOMPLETE';save();}
  return report;
}
function claimOnce(bundleRoot,parentHash,record){
  assert.match(parentHash,/^[a-f0-9]{64}$/);const base=fs.realpathSync(bundleRoot),evidence=fs.realpathSync(path.join(base,'evidence'));
  assert(contained(base,evidence)&&fs.statSync(evidence).isDirectory(),'CONTINUATION_EVIDENCE_ESCAPE');
  const file=path.join(evidence,'continuation-'+parentHash+'.claim.json');fs.writeFileSync(file,JSON.stringify(record,null,2)+'\n',{flag:'wx'});return file;
}
function readInside(base,relative){
  assert(typeof relative==='string'&&!relative.includes('\\')&&!relative.includes(':')&&!relative.startsWith('/')&&relative.split('/').every(x=>x&&x!=='.'&&x!=='..'));
  const actual=fs.realpathSync(path.resolve(base,relative));assert(contained(base,actual)&&fs.statSync(actual).isFile(),'CONTINUATION_PATH_ESCAPE');return fs.readFileSync(actual);
}
function pinInside(base,relative,expected){const bytes=readInside(base,relative);assert.equal(sha(bytes),expected,'CONTINUATION_PIN_CHANGED');return bytes;}
function verifyStageFiles(report,identity,borrowed){
  for(const stage of report.stages){
    const file=borrowed.evidenceFile(identity.bundleRoot,path.resolve(identity.bundleRoot,stage.evidence.path),{existing:true}),bytes=fs.readFileSync(file);
    assert.equal(sha(bytes),stage.evidence.sha256);assert.deepEqual(JSON.parse(bytes),stage.result);assertBindings(stage.result,identity);
  }
}
async function main(argv=process.argv.slice(2)){
  const args=parseArgs(argv),sourceBytes=fs.readFileSync(__filename);assert.equal(sha(sourceBytes),args['source-sha'],'CONTINUATION_SCRIPT_HASH_MISMATCH');
  const workspace=fs.realpathSync(path.resolve(__dirname,'..')),expectedBundle=fs.realpathSync(path.join(workspace,PINS.bundle));
  const manifestFile=fs.realpathSync(path.resolve(args.manifest));assert.equal(manifestFile,path.join(expectedBundle,'ab.json'),'CONTINUATION_WRONG_BUNDLE');
  const manifestBytes=pinInside(expectedBundle,'ab.json',PINS.manifestSha256),manifest=JSON.parse(manifestBytes);assert.equal(manifest.id,PINS.id);
  // Authenticate the verifier and its sole imported helper before require().
  for(const file of ['scripts/verify-central-snapshot-ab.cjs','test/integration/central-snapshot-ab/archive.cjs'])pinInside(expectedBundle,'common/'+file,manifest.harness.sources[file]);
  const verifier=require(path.join(expectedBundle,'common/scripts/verify-central-snapshot-ab.cjs'));
  const identity=verifier.verifyAB({manifestPath:manifestFile,expectedHarnessRoot:path.join(expectedBundle,'common'),verifyDependencies:true});assert.equal(identity.id,PINS.id);
  const common=require(path.join(identity.harnessRoot,'test/integration/central-snapshot-ab/run.cjs'));
  const originalRoot=identity.variants.A.sourceRoot,borrowed=require(path.join(originalRoot,'test/integration/eu-writer-performance/run.cjs')),infra=require(path.join(originalRoot,'test/integration/eu-writer-performance/infra.cjs'));
  assert.deepEqual(common.stagePlan('measure-http'),fullPlan());
  const readinessFile=fs.realpathSync(path.resolve(args['readiness-report'])),failedFile=fs.realpathSync(path.resolve(args['failed-report']));
  assert.equal(readinessFile,path.join(expectedBundle,...PINS.readinessPath.split('/')));assert.equal(failedFile,path.join(expectedBundle,...PINS.failedPath.split('/')));
  const readiness=JSON.parse(pinInside(expectedBundle,PINS.readinessPath,PINS.readinessSha256)),failed=JSON.parse(pinInside(expectedBundle,PINS.failedPath,PINS.failedSha256));
  common.validateReadinessProof(readiness,identity,identity.protocol.seedDigest,identity.protocol.images);verifyStageFiles(readiness,identity,borrowed);
  validateFailedParent(failed,identity);verifyStageFiles(failed,identity,borrowed);
  assert.equal(failed.habitualEnvironmentAccess,false);assert.equal(failed.performanceMeasurement,true);
  assert(Date.parse(failed.finishedAt)>Date.parse(failed.startedAt));assert(Date.parse(failed.startedAt)>Date.parse(readiness.finishedAt));
  const claimPath=path.join(expectedBundle,'evidence','continuation-'+PINS.failedSha256+'.claim.json');assert(!fs.existsSync(claimPath),'CONTINUATION_ALREADY_CLAIMED');
  if(process.platform!=='win32')throw failure('WINDOWS_OWNED_PROCESS_TREE_REQUIRED');
  // Only after immutable source/proof validation: read-only local inventory.
  const images=await infra.localImages();assert.deepEqual(images,identity.protocol.images);
  const priorResources=[...readiness.stages,...failed.stages].flatMap(s=>s.resources),present=new Set((await infra.docker(['ps','-aq','--no-trunc'],process.env,infra.createBudget(90000))).split(/\r?\n/).filter(Boolean));
  assert(priorResources.every(r=>!present.has(r.id)),'CONTINUATION_PRIOR_RESOURCE_STILL_PRESENT');
  const runId=randomUUID().replaceAll('-',''),folder=borrowed.resolveEvidenceDirectory(expectedBundle,runId),scriptFile=path.join(folder,'orchestrator.cjs');
  fs.writeFileSync(scriptFile,sourceBytes,{flag:'wx'});
  const claimed=claimOnce(expectedBundle,PINS.failedSha256,{schemaVersion:1,runId,abId:PINS.id,sourceParentSha256:PINS.failedSha256,orchestratorSha256:args['source-sha'],indices:[5,6,7],createdAt:new Date().toISOString()});
  const relative=p=>path.relative(expectedBundle,p).split(path.sep).join('/');
  const report={schemaVersion:1,runId,mode:'measure-http-continuation',status:'FAIL',campaignStatus:'FAIL',campaignCompleteness:'INCOMPLETE',continuationStatus:'RUNNING',...bindings(identity),images,
    sourceParent:{path:PINS.failedPath,sha256:PINS.failedSha256},readiness:{path:PINS.readinessPath,sha256:PINS.readinessSha256},
    orchestrator:{path:relative(scriptFile),sha256:args['source-sha']},claim:{path:relative(claimed),sha256:sha(fs.readFileSync(claimed))},
    startedAt:new Date().toISOString(),performanceMeasurement:true,habitualEnvironmentAccess:false,cleanup:true,stages:[],plannedIndices:[5,6,7],
    originalCounts:{attempts:172,warmups:34,plannedAttempts:288,plannedWarmups:56,failedStage:4,missingAttemptsInFailedStage:8,missingWarmupsInFailedStage:1},
    priorResourcesAbsent:{method:'READ_ONLY_DOCKER_ID_INVENTORY',count:priorResources.length,ids:priorResources.map(r=>r.id)},
    environment:{platform:process.platform,node:process.version,architecture:process.arch,timezone:'UTC',cpuCount:require('node:os').cpus().length,totalMemory:require('node:os').totalmem(),freeMemoryBefore:require('node:os').freemem(),hostReserved:false,externalLoadControlled:false},
    limitations:['Original failed arm4 is never rerun or excluded. The original reports remain immutable.','The interruption and additional elapsed time break an uninterrupted paired campaign; no exclusive-host or capacity claim is established.','A completed HTTP workload failure may be followed by the next untouched arm only after verified child exit, source integrity, HTTP readiness and owned cleanup.','A hard process termination can lose collector samples still in memory; incomplete evidence never becomes PASS.']};
  const reportFile=path.join(folder,'report.json'),save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');save();
  try{
    await continueStages({report,identity,save,runStage:async stage=>{
      const childFile=path.join(folder,`stage-${stage.index}-${stage.revision}-${stage.arm}.json`),entry={...stage,status:'RUNNING'};let lab;
      report.activeStage={...stage};save();
      try{
        lab=await infra.createLab({runId:randomUUID().replaceAll('-',''),tlsDirectory:path.resolve(args['tls-dir']),images,stage:stage.revision});entry.environment=lab.environment;entry.resources=lab.resources;report.activeStage=entry;save();
        const frozenChild=path.join(identity.harnessRoot,'test/integration/central-snapshot-ab/run.cjs');
        const childArgs=[frozenChild,'--isolated','--measure-http','--manifest',manifestFile,'--tls-dir',path.resolve(args['tls-dir']),'--readiness-report',readinessFile,'--child-stage',stage.revision,'--child-arm',stage.arm,'--child-kind',stage.kind,'--child-index',String(stage.index),'--child-report',childFile];
        try{const result=await borrowed.runOwnedChild(process.execPath,childArgs,{cwd:identity.harnessRoot,env:common.cleanEnvironment(process.env,lab.env),timeoutMs:common.stageBudgetMs(stage)});entry.childCleanup=result.childCleanup;process.stdout.write(result.stdout);}
        catch(error){entry.childCleanup=error.childCleanup;entry.processFailure=safeError(error);if(error.stdout)process.stdout.write(error.stdout);}
        if(fs.existsSync(childFile)){entry.result=JSON.parse(fs.readFileSync(childFile,'utf8'));entry.status=entry.result.status==='PASS'?'PASS':'FAIL';}else{entry.status='FAIL';entry.failure={code:'CONTINUATION_CHILD_REPORT_MISSING'};}
      }catch(error){entry.status='FAIL';entry.failure=safeError(error);if(error.cleanup)entry.cleanup=error.cleanup;}
      finally{
        if(lab){try{entry.cleanup=await lab.cleanup();}catch(error){entry.cleanup={status:'FAIL',failure:safeError(error)};}}
        if(fs.existsSync(childFile))entry.evidence={path:relative(childFile),sha256:sha(fs.readFileSync(childFile))};
        report.activeStage=entry;save();
      }
      return entry;
    }});
  }catch(error){report.continuationStatus='STOPPED';report.failure=safeError(error);}
  finally{
    if(report.activeStage&&!report.stages.some(s=>s.index===report.activeStage.index))report.stages.push(report.activeStage);
    report.httpCounts={attempts:report.stages.reduce((n,s)=>n+(s.result?.http?.attempts?.length||0),0),warmups:report.stages.reduce((n,s)=>n+(s.result?.http?.warmups?.length||0),0)};
    report.observedCampaignCounts={attempts:172+report.httpCounts.attempts,warmups:34+report.httpCounts.warmups,plannedAttempts:288,plannedWarmups:56};
    try{verifier.verifyAB({manifestPath:manifestFile,expectedHarnessRoot:identity.harnessRoot,verifyDependencies:true});pinInside(expectedBundle,PINS.failedPath,PINS.failedSha256);pinInside(expectedBundle,PINS.readinessPath,PINS.readinessSha256);assert.equal(sha(fs.readFileSync(__filename)),args['source-sha']);assert.equal(sha(fs.readFileSync(scriptFile)),args['source-sha']);report.sourceIntegrityAfter='PASS';}
    catch(error){report.sourceIntegrityAfter=safeError(error);report.continuationStatus='STOPPED';}
    report.status='FAIL';report.campaignStatus='FAIL';report.campaignCompleteness='INCOMPLETE';report.finishedAt=new Date().toISOString();delete report.activeStage;save();
  }
  process.stdout.write(JSON.stringify({status:'FAIL',continuationStatus:report.continuationStatus,cleanup:report.cleanup,report:reportFile})+'\n');process.exitCode=1;return report;
}
if(require.main===module)main().catch(error=>{process.stderr.write(JSON.stringify({status:'FAIL',continuationStatus:'STOPPED',failure:safeError(error)})+'\n');process.exitCode=1;});
module.exports={PINS,fullPlan,remainingPlan,validateFailedParent,classifyCompletedStage,continueStages,claimOnce,parseArgs,main};
