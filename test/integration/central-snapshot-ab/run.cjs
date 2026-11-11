'use strict';
// Common A/B entry. Verify both immutable roots before loading any runtime.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {verifyAB,sha,readFile}=require('../../../scripts/verify-central-snapshot-ab.cjs');
const harnessRoot=path.resolve(__dirname,'../../..');
const MODES=['readiness','equivalence','measure-metadata','measure-http'];
const CHILD_KEYS=['child-stage','child-arm','child-kind','child-index','child-report'];
function failure(code){return Object.assign(Error(code),{code});}
function safeError(error){return {code:/^[A-Z0-9_]+$/.test(error?.code||'')?error.code:'AB_EXECUTION_FAILED',name:error?.name||'Error',reason:/^[A-Z0-9_]+$/.test(error?.message||'')?error.message:null};}
function parseArgs(args){
  const parsed={};
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--isolated'){assert(!parsed.isolated);parsed.isolated=true;}
    else if(MODES.some(mode=>arg==='--'+mode)){assert(!parsed.mode);parsed.mode=arg.slice(2);}
    else if(['manifest','tls-dir','readiness-report',...CHILD_KEYS].some(key=>arg==='--'+key)){
      const key=arg.slice(2);assert(!parsed[key]&&args[i+1]&&!args[i+1].startsWith('--'));parsed[key]=args[++i];
    }else assert.fail('AB_UNKNOWN_ARGUMENT');
  }
  assert(parsed.isolated&&parsed.mode&&parsed.manifest&&parsed['tls-dir'],'AB_EXPLICIT_ISOLATED_INVOCATION_REQUIRED');
  if(parsed.mode.startsWith('measure-'))assert(parsed['readiness-report'],'AB_MATCHING_READINESS_REQUIRED');
  if(CHILD_KEYS.some(key=>parsed[key])){
    assert(CHILD_KEYS.every(key=>parsed[key]),'AB_PARTIAL_CHILD_ARGUMENTS');
    assert(['042','043'].includes(parsed['child-stage'])&&['A','B','AB'].includes(parsed['child-arm']));
    assert(/^(0|[1-9][0-9]*)$/.test(parsed['child-index']));
    const expected=stagePlan(parsed.mode)[Number(parsed['child-index'])];
    assert(expected&&expected.revision===parsed['child-stage']&&expected.arm===parsed['child-arm']&&expected.kind===parsed['child-kind'],'AB_CHILD_PLAN_MISMATCH');
  }
  return parsed;
}
function stagePlan(mode){
  if(mode==='equivalence'||mode==='measure-metadata')return ['043','042'].map(revision=>({revision,arm:'AB',kind:mode==='equivalence'?'equivalence':'metadata'}));
  if(mode==='readiness')return [...stagePlan('equivalence'),{revision:'043',arm:'A',kind:'http-readiness'},{revision:'043',arm:'B',kind:'http-readiness'}];
  assert.equal(mode,'measure-http');
  return [['A','B'],['B','A'],['A','B'],['B','A']].flatMap((order,pairIndex)=>order.map(arm=>({revision:'043',arm,kind:'http',pairIndex})));
}
function stageBudgetMs(stage){
  const work=stage.kind==='metadata'?13*300000:stage.kind==='http'?7*180000:stage.kind==='http-readiness'?180000:300000;
  return 300000+work+120000+90000;
}
function cleanEnvironment(original,lab){
  const env={...original,...lab,TZ:'UTC'};
  for(const key of ['NODE_PATH','NODE_OPTIONS','NODE_V8_COVERAGE','F11_TENANT_DATABASE_URL','F7_CENTRAL_DATABASE_URL','F7_TENANT_DATABASE_URL','F9_TEST_DATABASE_URL','C4G_HTTP_SQL_TEST'])delete env[key];
  return env;
}
async function cleanupAll(actions,budget){
  const errors=[];
  for(const action of actions){
    // Still attempt each owner-specific close if an earlier close/budget failed.
    try{await action();}catch(error){errors.push(safeError(error));}
    try{budget.check();}catch(error){errors.push(safeError(error));}
  }
  return errors;
}
async function runSequentialStages(plan,report,executeStage){
  for(const [index,stage]of plan.entries()){
    if(report.cleanup!==true)throw failure('AB_PREVIOUS_CLEANUP_FAILED');
    await executeStage(stage,index);
  }
}
function bindings(identity){return {abId:identity.id,sourceSetDigest:identity.sourceSetDigest,manifestSha256:identity.manifestSha256,harnessDigest:identity.harnessDigest,variantDigests:{A:identity.variants.A.sourceSetDigest,B:identity.variants.B.sourceSetDigest}};}
function validateReadinessProof(prior,identity,seedDigest,images){
  assert.equal(prior.status,'PASS');assert.equal(prior.mode,'readiness');
  for(const [key,value] of Object.entries(bindings(identity)))assert.deepEqual(prior[key],value,'AB_PROOF_IDENTITY_'+key);
  assert.equal(prior.seedDigest,seedDigest);assert.deepEqual(prior.images,images);assert.equal(prior.cleanup,true);assert.equal(prior.sourceIntegrityAfter,'PASS');
  const plan=stagePlan('readiness');assert.equal(prior.stages.length,plan.length);
  for(const [index,expected] of plan.entries()){
    const s=prior.stages[index];for(const [key,value] of Object.entries(expected)){assert.equal(s[key],value);assert.equal(s.result[key],value);}
    assert.equal(s.index,index);assert.equal(s.status,'PASS');assert.equal(s.cleanup.status,'PASS');assert.equal(s.childCleanup.exitVerified,true);
    assert.equal(s.result.index,index);assert.equal(s.result.mode,'readiness');
    assert.equal(s.result.status,'PASS');assert.equal(s.result.cleanup,true);assert.equal(s.result.sourceIntegrityAfter,'PASS');
    if(expected.kind==='equivalence')assert.equal(s.result.equivalence.status,'PASS');else assert.equal(s.result.httpReadiness.status,'PASS');
  }
  return true;
}
function originalModule(identity,arm,name){
  assert(['A','B'].includes(arm));assert(/^[a-z-]+$/.test(name));
  return require(path.join(identity.variants[arm].sourceRoot,'test/integration/eu-writer-performance',name+'.cjs'));
}
function loadProof(file,identity,images,borrowed){
  const actual=borrowed.evidenceFile(identity.bundleRoot,file,{existing:true}),prior=JSON.parse(fs.readFileSync(actual,'utf8'));
  validateReadinessProof(prior,identity,identity.protocol.seedDigest,images);
  for(const stage of prior.stages){
    const childFile=borrowed.evidenceFile(identity.bundleRoot,path.resolve(identity.bundleRoot,stage.evidence.path),{existing:true});
    assert.equal(sha(fs.readFileSync(childFile)),stage.evidence.sha256);assert.deepEqual(JSON.parse(fs.readFileSync(childFile,'utf8')),stage.result);
    for(const [key,value]of Object.entries(bindings(identity)))assert.deepEqual(stage.result[key],value);
    assert.equal(stage.result.seedDigest,identity.protocol.seedDigest);
  }
  return prior;
}
async function step(work,ms,createBudget){const budget=createBudget(ms);budget.check();const result=await work(budget);budget.check();return result;}
async function child(args,identity,images,borrowed){
  const index=Number(args['child-index']),stage=stagePlan(args.mode)[index],arm=stage.arm==='AB'?'A':stage.arm;
  const reportFile=borrowed.evidenceFile(identity.bundleRoot,args['child-report']);
  assert.equal(path.basename(reportFile),`stage-${index}-${stage.revision}-${stage.arm}.json`);
  const report={schemaVersion:1,status:'RUNNING',mode:args.mode,...stage,index,...bindings(identity),seedDigest:identity.protocol.seedDigest,startedAt:new Date().toISOString(),checks:[],cleanup:false,performanceMeasurement:args.mode.startsWith('measure-')};
  let first=true;const save=()=>{fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n',{flag:first?'wx':'w'});first=false;};save();
  async function check(name,work){report.phase=name;save();await work();report.checks.push({name,status:'PASS'});save();process.stdout.write('PASS '+name+'\n');}
  const infra=originalModule(identity,arm,'infra');let fixture,http,metrics;
  try{
    const owned=JSON.parse(process.env.EU_TRIAL_OWNED||'null');assert(Array.isArray(owned)&&owned.length===2);
    assert.equal(new Set(owned.map(x=>x.id)).size,2);
    for(const resource of owned){
      assert.equal(resource.runId,process.env.EU_TRIAL_RUN);
      const kind=resource.name===`c4g-eu-trial-pg-${resource.runId}-${stage.revision}`?'postgres':resource.name===`c4g-eu-trial-kc-${resource.runId}-${stage.revision}`?'keycloak':null;
      assert(kind,'AB_RESOURCE_NAME_MISMATCH');const info=await infra.inspectOwned(resource);assert.equal(info.Image,images[kind].id,'AB_RESOURCE_IMAGE_MISMATCH');
    }
    if(stage.kind.startsWith('http'))metrics=originalModule(identity,arm,'instrumentation').install();
    await step(async budget=>{
      fixture=await originalModule(identity,arm,'fixture').createFixture({adminUrl:process.env.EU_TRIAL_ADMIN_URL,keycloakBase:process.env.EU_TRIAL_KEYCLOAK,keycloakPassword:process.env.EU_TRIAL_KEYCLOAK_PASSWORD,runId:process.env.EU_TRIAL_RUN,centralRevision:stage.revision,report,check:async(name,work)=>{budget.check();await check(name,work);budget.check();}});
    },300000,infra.createBudget);
    assert.equal(fixture.seed.digest,identity.protocol.seedDigest);
    const roots={rootA:identity.variants.A.sourceRoot,rootB:identity.variants.B.sourceRoot};
    if(stage.kind==='equivalence')await check('AB_EQUIVALENCE_'+stage.revision,async()=>{
      report.equivalence=await step(budget=>require('./equivalence.cjs').runEquivalence({fixture,...roots,revision:report.fixture.schemas.central,onProgress:progress=>{budget.check();report.progress=progress;save();}}),300000,infra.createBudget);
      assert.equal(report.equivalence.status,'PASS');
    });
    else if(stage.kind==='metadata')await check('AB_METADATA_'+stage.revision,async()=>{
      report.metadata=await step(budget=>require('./metadata.cjs').runMetadataAB({client:fixture.reader,...roots,revision:report.fixture.schemas.central,mode:'measure',onProgress:progress=>{budget.check();report.progress=progress;save();}}),13*300000,infra.createBudget);
      assert.equal(report.metadata.status,'PASS');
    });
    else{
      const httpModule=originalModule(identity,arm,'http'),readiness=originalModule(identity,arm,'readiness');
      await step(async budget=>{
        http=await httpModule.createHttpHarness({fixture,tlsDirectory:args['tls-dir'],metrics,check});budget.check();
        await metrics.startSampling(fixture.central.pool);await readiness.runReadiness({fixture,http,report,check});
      },180000,infra.createBudget);
      if(stage.kind==='http'){
        report.http=await httpModule.runHttpReplica({http,replica:index,onProgress:()=>save(),validate:(response,tenant,kind)=>{readiness.functionalSummary(kind,response.data,fixture.tenants[tenant]);return true;}});
        assert.equal(report.http.status,'PASS');assert.equal(report.http.attempts.length,36);assert.equal(report.http.warmups.length,7);
      }
      report.drainMs=await metrics.drain(30000);report.instrumentation=metrics.evidence();
      assert.equal(report.instrumentation.samplerErrors.length,0);assert(report.instrumentation.samples.length>0);
    }
    report.status='PASS';
  }catch(error){
    report.status='FAIL';report.failure=safeError(error);
    if(error.equivalenceReport)report.equivalence=error.equivalenceReport;
    if(error.metadataABReport)report.metadata=error.metadataABReport;
    if(error.httpReport)report.http=error.httpReport;
    process.stdout.write('FAIL '+report.phase+' '+report.failure.code+'\n');
  }finally{
    const cleanupBudget=infra.createBudget(120000),errors=[];
    try{if(metrics)report.instrumentation=metrics.evidence();}catch(error){errors.push(safeError(error));}
    errors.push(...await cleanupAll([()=>http?.close(),()=>metrics?.close(),()=>fixture?.close()],cleanupBudget));
    report.cleanup=errors.length===0;if(errors.length){report.status='FAIL';report.cleanupErrors=errors;}
    try{verifyAB({manifestPath:args.manifest,expectedHarnessRoot:harnessRoot,verifyDependencies:true});report.sourceIntegrityAfter='PASS';}catch(error){report.status='FAIL';report.sourceIntegrityAfter=safeError(error);}
    report.finishedAt=new Date().toISOString();save();
  }
  return report;
}
async function main(argv=process.argv.slice(2)){
  const args=parseArgs(argv);args.manifest=path.resolve(args.manifest);args['tls-dir']=path.resolve(args['tls-dir']);
  const identity=verifyAB({manifestPath:args.manifest,expectedHarnessRoot:harnessRoot,verifyDependencies:true});
  if(process.platform!=='win32')throw failure('WINDOWS_OWNED_PROCESS_TREE_REQUIRED');
  const borrowed=originalModule(identity,'A','run'),infra=originalModule(identity,'A','infra');
  if(args.mode.startsWith('measure-'))loadProof(path.resolve(args['readiness-report']),identity,identity.protocol.images,borrowed);
  const images=await infra.localImages();assert.deepEqual(images,identity.protocol.images,'AB_IMAGE_BINDING_MISMATCH');
  if(args['child-stage']){const result=await child(args,identity,images,borrowed);if(result.status!=='PASS')process.exitCode=1;return result;}
  const runId=randomUUID().replaceAll('-',''),folder=borrowed.resolveEvidenceDirectory(identity.bundleRoot,runId);
  const report={schemaVersion:1,runId,mode:args.mode,status:'RUNNING',...bindings(identity),seedDigest:identity.protocol.seedDigest,images,startedAt:new Date().toISOString(),performanceMeasurement:args.mode.startsWith('measure-'),habitualEnvironmentAccess:false,stages:[],cleanup:true,
    environment:{platform:process.platform,node:process.version,architecture:process.arch,timezone:'UTC',cpuCount:require('node:os').cpus().length,totalMemory:require('node:os').totalmem(),freeMemoryBefore:require('node:os').freemem(),hostReserved:false,externalLoadControlled:false}};
  const reportFile=path.join(folder,'report.json'),save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');save();
  try{
    await runSequentialStages(stagePlan(args.mode),report,async(stage,index)=>{
      const childFile=path.join(folder,`stage-${index}-${stage.revision}-${stage.arm}.json`),entry={...stage,index,status:'RUNNING'};report.stages.push(entry);save();let lab;
      try{
        lab=await infra.createLab({runId:randomUUID().replaceAll('-',''),tlsDirectory:args['tls-dir'],images,stage:stage.revision});entry.environment=lab.environment;entry.resources=lab.resources;save();
        const childArgs=[__filename,'--isolated','--'+args.mode,'--manifest',args.manifest,'--tls-dir',args['tls-dir'],'--child-stage',stage.revision,'--child-arm',stage.arm,'--child-kind',stage.kind,'--child-index',String(index),'--child-report',childFile];
        if(args['readiness-report'])childArgs.push('--readiness-report',path.resolve(args['readiness-report']));
        try{const result=await borrowed.runOwnedChild(process.execPath,childArgs,{cwd:identity.harnessRoot,env:cleanEnvironment(process.env,lab.env),timeoutMs:stageBudgetMs(stage)});entry.childCleanup=result.childCleanup;process.stdout.write(result.stdout);}
        catch(error){entry.childCleanup=error.childCleanup;if(error.stdout)process.stdout.write(error.stdout);throw error;}
        entry.result=JSON.parse(fs.readFileSync(childFile,'utf8'));assert.equal(entry.result.status,'PASS');entry.status='PASS';
      }catch(error){entry.status='FAIL';entry.failure=safeError(error);if(fs.existsSync(childFile))entry.result=JSON.parse(fs.readFileSync(childFile,'utf8'));if(error.cleanup)entry.cleanup=error.cleanup;throw error;}
      finally{
        if(lab){try{entry.cleanup=await lab.cleanup();}catch(error){entry.cleanup={status:'FAIL',failure:safeError(error)};}}
        if(entry.cleanup?.status!=='PASS'||entry.result?.cleanup!==true||entry.childCleanup?.exitVerified!==true)report.cleanup=false;
        if(fs.existsSync(childFile))entry.evidence={path:path.relative(identity.bundleRoot,childFile).split(path.sep).join('/'),sha256:sha(fs.readFileSync(childFile))};save();
      }
    });
    if(args.mode==='measure-http'){
      const attempts=report.stages.reduce((n,s)=>n+s.result.http.attempts.length,0),warmups=report.stages.reduce((n,s)=>n+s.result.http.warmups.length,0);
      assert.equal(attempts,288);assert.equal(warmups,56);report.httpCounts={attempts,warmups};
    }
    assert.equal(report.cleanup,true);report.status='PASS';
  }catch(error){report.status='FAIL';report.failure=safeError(error);}
  finally{
    try{verifyAB({manifestPath:args.manifest,expectedHarnessRoot:harnessRoot,verifyDependencies:true});report.sourceIntegrityAfter='PASS';}catch(error){report.status='FAIL';report.sourceIntegrityAfter=safeError(error);}
    report.finishedAt=new Date().toISOString();save();
  }
  process.stdout.write(JSON.stringify({status:report.status,cleanup:report.cleanup,report:reportFile})+'\n');if(report.status!=='PASS')process.exitCode=1;return report;
}
if(require.main===module)main().catch(error=>{process.stderr.write(JSON.stringify({status:'FAIL',failure:safeError(error)})+'\n');process.exitCode=1;});
module.exports={parseArgs,stagePlan,stageBudgetMs,validateReadinessProof,cleanEnvironment,cleanupAll,runSequentialStages,main};
