'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto'),{execFile,spawn}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile),root=path.resolve(__dirname,'../../..');
const {createBudget}=require('./infra.cjs');
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function parseArgs(args){
 const parsed={};for(let i=0;i<args.length;i++){const arg=args[i];
  if(arg==='--isolated'){assert(!parsed.isolated);parsed.isolated=true;}
  else if(['--readiness','--measure-metadata','--measure-http'].includes(arg)){assert(!parsed.mode);parsed.mode=arg.slice(2);}
  else if(['--manifest','--tls-dir','--readiness-report','--child-stage','--child-report'].includes(arg)){assert(args[i+1]&&!args[i+1].startsWith('--'));const key=arg.slice(2);assert(!parsed[key]);parsed[key]=args[++i];}
  else assert.fail('UNKNOWN_RUNNER_ARGUMENT');
 }
 assert(parsed.isolated&&parsed.mode&&parsed.manifest&&parsed['tls-dir'],'EXPLICIT_ISOLATED_INVOCATION_REQUIRED');
 if(parsed.mode!=='readiness')assert(parsed['readiness-report'],'MATCHING_READINESS_REPORT_REQUIRED');
 if(parsed['child-stage'])assert(['042','043'].includes(parsed['child-stage'])&&parsed['child-report'],'INVALID_CHILD_INVOCATION');
 else assert(!parsed['child-report']);return parsed;
}
function safeError(error){return {code:/^[A-Z0-9_]+$/.test(error?.code||'')?error.code:'TRIAL_EXECUTION_FAILED',name:error?.name||'Error',reason:/^[A-Z0-9_]+$/.test(error?.message||'')?error.message:null,frames:String(error?.stack||'').split('\n').filter(line=>/^\s+at /.test(line)).slice(0,5)};}
const failure=code=>Object.assign(Error(code),{code});
const contained=(base,target)=>{const relative=path.relative(base,target);return relative&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
function resolveEvidenceDirectory(bundleRoot,runId){assert.match(runId,/^[a-f0-9]{32}$/);const base=fs.realpathSync(bundleRoot),requested=path.join(base,'evidence');if(!fs.existsSync(requested))fs.mkdirSync(requested);const evidence=fs.realpathSync(requested);if(!contained(base,evidence)||!fs.statSync(evidence).isDirectory())throw failure('EVIDENCE_PATH_ESCAPE');const folder=path.join(evidence,runId);assert(!fs.existsSync(folder),'EVIDENCE_DESTINATION_EXISTS');fs.mkdirSync(folder);return folder;}
function evidenceFile(bundleRoot,requested,{existing=false}={}){const base=fs.realpathSync(bundleRoot),evidence=fs.realpathSync(path.join(base,'evidence')),parent=fs.realpathSync(path.dirname(path.resolve(requested)));if(!contained(base,evidence)||!contained(evidence,parent))throw failure('EVIDENCE_PATH_ESCAPE');const file=path.join(parent,path.basename(requested));if(existing){const actual=fs.realpathSync(file);if(!contained(evidence,actual))throw failure('EVIDENCE_PATH_ESCAPE');assert(fs.statSync(actual).isFile());return actual;}assert(!fs.existsSync(file),'EVIDENCE_DESTINATION_EXISTS');return file;}
function validateReadinessProof(prior,identity,seedDigest,images){
 assert.equal(prior.status,'PASS');assert.equal(prior.mode,'readiness');assert.equal(prior.trialId,identity.id);assert.equal(prior.sourceSetDigest,identity.sourceSetDigest);assert.equal(prior.manifestSha256,identity.manifestSha256);assert.equal(prior.seedDigest,seedDigest);assert.deepEqual(prior.images,images);assert.equal(prior.cleanup,true);assert.equal(prior.sourceIntegrityAfter,'PASS');assert.deepEqual(prior.stages.map(s=>s.stage),['043','042']);
 for(const stage of prior.stages){assert.equal(stage.status,'PASS');assert.equal(stage.cleanup.status,'PASS');const result=stage.result;assert.equal(result.status,'PASS');assert.equal(result.mode,'readiness');assert.equal(result.stage,stage.stage);assert.equal(result.trialId,identity.id);assert.equal(result.sourceSetDigest,identity.sourceSetDigest);assert.equal(result.manifestSha256,identity.manifestSha256);assert.equal(result.seedDigest,seedDigest);assert.equal(result.cleanup,true);assert.equal(result.sourceIntegrityAfter,'PASS');assert.equal(result.metadata.status,'PASS');assert.equal(result.metadataDrift.status,'PASS');if(stage.stage==='043')assert.equal(result.httpReadiness.status,'PASS');}return true;
}
function loadReadinessProof(file,identity,seedDigest,images){const actual=evidenceFile(identity.bundleRoot,file,{existing:true}),prior=JSON.parse(fs.readFileSync(actual,'utf8'));validateReadinessProof(prior,identity,seedDigest,images);for(const stage of prior.stages){const evidence=stage.evidence;assert(evidence&&/^[a-f0-9]{64}$/.test(evidence.sha256));const childFile=evidenceFile(identity.bundleRoot,path.resolve(identity.bundleRoot,evidence.path),{existing:true});assert.equal(sha(childFile),evidence.sha256);assert.deepEqual(JSON.parse(fs.readFileSync(childFile,'utf8')),stage.result);}return prior;}
async function step(work,ms){const budget=createBudget(ms);budget.check();const value=await work(budget);budget.check();return value;}
function stageBudgetMs(mode,stage){const metadata=mode==='measure-http'?0:mode==='measure-metadata'?13*300000:300000;const drift=mode==='measure-http'?0:180000;const http=stage==='043'&&mode!=='measure-metadata'?(mode==='measure-http'?7*180000:180000):0;return 300000+metadata+drift+http+120000+90000;}
async function terminateOwnedWindowsTree(child){assert(Number.isSafeInteger(child.pid)&&child.pid>0);if(child.exitCode!==null||child.signalCode!==null)return;try{await execute('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:30000,maxBuffer:65536});}catch{if(child.exitCode===null&&child.signalCode===null)throw failure('OWNED_PROCESS_TREE_TERMINATION_FAILED');}}
function runOwnedChild(file,args,{env,cwd,timeoutMs},{platform=process.platform,spawnProcess=spawn,killTree=terminateOwnedWindowsTree}={}){
 if(platform!=='win32')throw failure('WINDOWS_OWNED_PROCESS_TREE_REQUIRED');assert(Number.isSafeInteger(timeoutMs)&&timeoutMs>0);
 const child=spawnProcess(file,args,{env,cwd,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
 return new Promise((resolve,reject)=>{let stdout='',stderr='',settled=false,stopping=false,closed=false,closeCode,closeSignal,watchdog,closeTimer,resolveClose;const closePromise=new Promise(r=>{resolveClose=r;});
  function finish(error){if(settled)return;settled=true;clearTimeout(watchdog);clearTimeout(closeTimer);if(error){error.stdout=stdout;error.stderr=stderr;error.childCleanup={pid:child.pid||null,terminated:stopping,exitVerified:closed};reject(error);}else resolve({stdout,stderr,childCleanup:{pid:child.pid,terminated:false,exitVerified:true}});}
  async function stop(code){if(settled||stopping)return;stopping=true;try{assert(Number.isSafeInteger(child.pid)&&child.pid>0);if(!closed)await killTree(child);if(!closed)await new Promise((resolveWait,rejectWait)=>{closeTimer=setTimeout(()=>rejectWait(failure('OWNED_PROCESS_EXIT_UNVERIFIED')),15000);closePromise.then(resolveWait);});finish(failure(code));}catch(error){finish(error.code?error:failure('OWNED_PROCESS_TREE_TERMINATION_FAILED'));}}
  function output(kind,bytes){if(kind==='stdout')stdout+=bytes.toString();else stderr+=bytes.toString();if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>2*1024*1024){stdout=stdout.slice(0,1024*1024);stderr=stderr.slice(0,1024*1024);void stop('CHILD_OUTPUT_LIMIT_EXCEEDED');}}
  child.stdout.on('data',bytes=>output('stdout',bytes));child.stderr.on('data',bytes=>output('stderr',bytes));
  child.once('error',()=>{if(!stopping)finish(failure('CHILD_START_FAILED'));});
  child.once('close',(code,signal)=>{closed=true;closeCode=code;closeSignal=signal;resolveClose();if(!stopping){if(code===0&&!signal)finish();else finish(failure('FUNCTIONAL_CHILD_FAILED'));}});
  watchdog=setTimeout(()=>{void stop('CONTROL_DEADLINE_EXCEEDED');},timeoutMs);
 });
}
async function child(args,identity){
 const reportFile=evidenceFile(identity.bundleRoot,args['child-report']);assert(/^stage-\d+-(042|043)\.json$/.test(path.basename(reportFile)));
 const report={status:'RUNNING',mode:args.mode,stage:args['child-stage'],trialId:identity.id,sourceSetDigest:identity.sourceSetDigest,manifestSha256:identity.manifestSha256,startedAt:new Date().toISOString(),checks:[],performanceMeasurement:args.mode!=='readiness',cleanup:false};
 let firstSave=true;const save=()=>{fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n',{flag:firstSave?'wx':'w'});firstSave=false;};save();
 async function check(name,work){report.phase=name;save();await work();report.checks.push({name,status:'PASS'});save();process.stdout.write('PASS '+name+'\n');}
 let fixture,http,metrics;
 try{
  const {inspectOwned}=require('./infra.cjs'),owned=JSON.parse(process.env.EU_TRIAL_OWNED||'null');assert(Array.isArray(owned)&&owned.length===2);for(const resource of owned){assert.equal(resource.runId,process.env.EU_TRIAL_RUN);await inspectOwned(resource);}
  metrics=require('./instrumentation.cjs').install();
  await step(async budget=>{fixture=await require('./fixture.cjs').createFixture({adminUrl:process.env.EU_TRIAL_ADMIN_URL,keycloakBase:process.env.EU_TRIAL_KEYCLOAK,keycloakPassword:process.env.EU_TRIAL_KEYCLOAK_PASSWORD,runId:process.env.EU_TRIAL_RUN,centralRevision:args['child-stage'],report,check:async(name,work)=>{budget.check();await check(name,work);budget.check();}});},300000);
  const revision=report.fixture.schemas.central;
  report.seedDigest=fixture.seed.digest;
  if(args.mode!=='measure-http'){
   await check('METADATA_'+args['child-stage']+'_'+(args.mode==='readiness'?'FUNCTIONAL':'MEASURE'),async()=>{await step(async budget=>{report.metadata=await require('./metadata.cjs').runMetadata({client:fixture.reader,revision,mode:args.mode==='readiness'?'functional':'measure',onProgress:()=>{budget.check();save();}});},args.mode==='measure-metadata'?13*300000:300000);});
   await check('METADATA_'+args['child-stage']+'_DRIFT_AND_POST_LOCK_REFUSAL',async()=>{await step(async budget=>{report.metadataDrift=await require('./metadata-drift.cjs').validateMetadataDrift({ownerPool:fixture.central.pool,readerPool:fixture.reader,authorityPool:fixture.central.authorityPool,revision,permitSecret:fixture.central.permitSecret,ownership:fixture.ownership,onProgress:()=>{budget.check();save();}});},180000);});
  }
  if(args['child-stage']==='043'&&args.mode!=='measure-metadata'){
   await step(async budget=>{http=await require('./http.cjs').createHttpHarness({fixture,tlsDirectory:args['tls-dir'],metrics,check});budget.check();await metrics.startSampling(fixture.central.pool);await require('./readiness.cjs').runReadiness({fixture,http,report,check});},180000);
   if(args.mode==='measure-http'){report.http=await require('./http.cjs').runHttpReplica({http,replica:Number(process.env.EU_TRIAL_REPLICA),onProgress:()=>save(),validate:(response,index,kind)=>{require('./readiness.cjs').functionalSummary(kind,response.data,fixture.tenants[index]);return true;}});assert.equal(report.http.status,'PASS');}
   report.drainMs=await metrics.drain();report.instrumentation=metrics.evidence();assert.equal(report.instrumentation.samplerErrors.length,0);assert(report.instrumentation.samples.length>0);
  }
  report.status='PASS';
 }catch(error){report.status='FAIL';report.failure=safeError(error);if(error.metadataReport)report.metadata=error.metadataReport;if(error.metadataDriftReport)report.metadataDrift=error.metadataDriftReport;if(error.httpReport)report.http=error.httpReport;process.stdout.write('FAIL '+report.phase+' '+report.failure.code+'\n');}
 finally{
  const errors=[],cleanupBudget=createBudget(120000);try{if(metrics)report.instrumentation=metrics.evidence();}catch(error){errors.push(safeError(error));}
  for(const cleanup of [()=>http?.close(),()=>metrics?.close(),()=>fixture?.close()])try{cleanupBudget.check();await cleanup();cleanupBudget.check();}catch(error){errors.push(safeError(error));}
  report.cleanup=errors.length===0;if(errors.length){report.status='FAIL';report.cleanupErrors=errors;}
  try{require('../../../scripts/verify-eu-writer-trial.cjs').verifyTrial({manifestPath:args.manifest,expectedSourceRoot:root,verifyDependencies:true});report.sourceIntegrityAfter='PASS';}catch(error){report.status='FAIL';report.sourceIntegrityAfter=safeError(error);}
  report.finishedAt=new Date().toISOString();save();
 }
 return report;
}
async function main(argv=process.argv.slice(2)){
 const args=parseArgs(argv),{verifyTrial}=require('../../../scripts/verify-eu-writer-trial.cjs');args.manifest=path.resolve(args.manifest);args['tls-dir']=path.resolve(args['tls-dir']);
 const identity=verifyTrial({manifestPath:args.manifest,expectedSourceRoot:root,verifyDependencies:true});
 if(process.platform!=='win32')throw failure('WINDOWS_OWNED_PROCESS_TREE_REQUIRED');
 const {localImages,createLab}=require('./infra.cjs'),images=await localImages();
 const seedDigest=require('./fixture.cjs').seedPlan().digest;
 if(args.mode!=='readiness')loadReadinessProof(path.resolve(args['readiness-report']),identity,seedDigest,images);
 if(args['child-stage']){const result=await child(args,identity);if(result.status!=='PASS')process.exitCode=1;return result;}
 const runId=randomUUID().replaceAll('-',''),folder=resolveEvidenceDirectory(identity.bundleRoot,runId);
 const report={schemaVersion:1,runId,mode:args.mode,status:'RUNNING',trialId:identity.id,sourceSetDigest:identity.sourceSetDigest,manifestSha256:identity.manifestSha256,seedDigest,images,startedAt:new Date().toISOString(),performanceMeasurement:args.mode!=='readiness',habitualEnvironmentAccess:false,stages:[],cleanup:true,environment:{platform:process.platform,architecture:process.arch,node:process.version,timezone:'UTC',cpuCount:require('node:os').cpus().length,totalMemory:require('node:os').totalmem(),freeMemoryBefore:require('node:os').freemem()}};
 const file=path.join(folder,'report.json'),save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');save();
 try{
  const stages=args.mode==='measure-http'?['043','043','043']:['043','042'];
  for(let index=0;index<stages.length;index++){
   const stage=stages[index],childFile=path.join(folder,`stage-${index}-${stage}.json`),stageEntry={stage,index,status:'RUNNING'};report.stages.push(stageEntry);save();let lab;
   try{
    lab=await createLab({runId:randomUUID().replaceAll('-',''),tlsDirectory:args['tls-dir'],images,stage});stageEntry.environment=lab.environment;stageEntry.resources=lab.resources;save();
    const env={...process.env,...lab.env,EU_TRIAL_REPLICA:String(index),TZ:'UTC'};
    for(const key of ['NODE_PATH','NODE_OPTIONS','F11_TENANT_DATABASE_URL','F7_CENTRAL_DATABASE_URL','F7_TENANT_DATABASE_URL','F9_TEST_DATABASE_URL','C4G_HTTP_SQL_TEST'])delete env[key];
    const childArgs=[__filename,'--isolated','--'+args.mode,'--manifest',args.manifest,'--tls-dir',args['tls-dir'],'--child-stage',stage,'--child-report',childFile];if(args['readiness-report'])childArgs.push('--readiness-report',path.resolve(args['readiness-report']));
    try{const result=await runOwnedChild(process.execPath,childArgs,{cwd:root,env,timeoutMs:stageBudgetMs(args.mode,stage)});stageEntry.childCleanup=result.childCleanup;process.stdout.write(result.stdout);}catch(error){if(error.stdout)process.stdout.write(error.stdout);stageEntry.childCleanup=error.childCleanup;throw error;}
    stageEntry.result=JSON.parse(fs.readFileSync(childFile,'utf8'));assert.equal(stageEntry.result.status,'PASS');stageEntry.status='PASS';
   }catch(error){stageEntry.status='FAIL';stageEntry.failure=safeError(error);if(fs.existsSync(childFile))stageEntry.result=JSON.parse(fs.readFileSync(childFile,'utf8'));if(error.cleanup)stageEntry.cleanup=error.cleanup;throw error;}
   finally{if(lab){try{stageEntry.cleanup=await lab.cleanup();}catch(error){stageEntry.cleanup={status:'FAIL',failure:safeError(error)};report.cleanup=false;}}if(stageEntry.cleanup?.status!=='PASS'||stageEntry.result?.cleanup!==true)report.cleanup=false;if(fs.existsSync(childFile))stageEntry.evidence={path:path.relative(identity.bundleRoot,childFile).split(path.sep).join('/'),sha256:sha(childFile)};save();}
  }
  if(args.mode==='measure-http'){const attempts=report.stages.flatMap(s=>s.result.http.attempts),warmups=report.stages.flatMap(s=>s.result.http.warmups);assert.equal(attempts.length,108);assert.equal(warmups.length,21);report.httpCounts={attempts:attempts.length,warmups:warmups.length};}
  assert.equal(report.cleanup,true);report.status='PASS';
 }catch(error){report.status='FAIL';report.failure=safeError(error);}
 finally{try{verifyTrial({manifestPath:args.manifest,expectedSourceRoot:root,verifyDependencies:true});report.sourceIntegrityAfter='PASS';}catch(error){report.status='FAIL';report.sourceIntegrityAfter=safeError(error);}report.finishedAt=new Date().toISOString();save();}
 process.stdout.write(JSON.stringify({status:report.status,cleanup:report.cleanup,report:file})+'\n');if(report.status!=='PASS')process.exitCode=1;return report;
}
if(require.main===module)main().catch(error=>{process.stderr.write(JSON.stringify({status:'FAIL',failure:safeError(error)})+'\n');process.exitCode=1;});
module.exports={parseArgs,main,safeError,step,stageBudgetMs,validateReadinessProof,loadReadinessProof,resolveEvidenceDirectory,evidenceFile,runOwnedChild};
