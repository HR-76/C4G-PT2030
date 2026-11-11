'use strict';
// Observational test preload. Never changes worktree sources, SQL or policy.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module');
const {createHash}=require('node:crypto'),{execFile}=require('node:child_process');
const {performance,monitorEventLoopDelay}=require('node:perf_hooks');
const root=path.resolve(__dirname,'../../..'),variant=process.env.C6_VARIANT;
if(!['before','after'].includes(variant)||!/^c6-ded-(?:[1-9]|1[0-2])-(before|after)$/.test(process.env.HTTP_PROOF_REPORT||''))throw Error('C6_PROOF_CONTEXT_REQUIRED');
const prior=path.join(root,'context/reviews/grouped-authority-validation');
const fixed=JSON.parse(fs.readFileSync(path.join(prior,'verification.json'),'utf8')).sourceHashes;
const baseline=JSON.parse(fs.readFileSync(path.join(prior,'baseline.json'),'utf8').replace(/^\uFEFF/,''));
const mappings=[['backend/src/applications/composition.js','applicationComposition.js'],['backend/src/opportunities/httpComposition.js','opportunityHttpComposition.js'],['backend/src/security/authorityCoordinator.js','authorityCoordinator.js']];
const hash=s=>createHash('sha256').update(s).digest('hex');
const targets=new Map(mappings.map(([relative,old])=>{
 const actual=fs.readFileSync(path.join(root,relative));if(hash(actual)!==fixed[relative])throw Error('CURRENT_SOURCE_DRIFT');
 const source=variant==='before'?fs.readFileSync(path.join(prior,'before',old)):actual;
 const expected=variant==='before'?baseline.hashes[relative]:fixed[relative];if(hash(source)!==expected)throw Error('VARIANT_SOURCE_DRIFT');
 return [path.normalize(path.join(root,relative)),{relative,source:source.toString('utf8'),sha256:expected}];
}));
let phase='setup',installed=false,busy=false;
const report={variant,loaded:[],samples:[],externalSamples:[],samplingErrors:[],phases:[],node:process.version,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem()};
const original=Module._extensions['.js'];
Module._extensions['.js']=function(mod,filename){
 const target=targets.get(path.normalize(filename));
 if(target){report.loaded.push({path:target.relative,sha256:target.sha256});return mod._compile(target.source,filename);}
 original(mod,filename);
 if(path.normalize(filename)===path.join(root,'test/integration/http-contention/instrumentation.js')){
  const install=mod.exports.install;
  mod.exports.install=function(...args){const metrics=install.apply(this,args),setPhase=metrics.setPhase;
   metrics.setPhase=function(next){phase=next;report.phases.push({phase,at:Date.now()});return setPhase.call(this,next);};installed=true;return metrics;};
 }
};
const cpu=()=>os.cpus().reduce((a,c)=>{a.idle+=c.times.idle;a.total+=Object.values(c.times).reduce((x,y)=>x+y,0);return a;},{idle:0,total:0});
let previous=cpu(),last=performance.now(),processPrevious=process.cpuUsage(),elu=performance.eventLoopUtilization();
const lag=monitorEventLoopDelay({resolution:20});lag.enable();
const timer=setInterval(()=>{
 const now=performance.now(),current=cpu(),used=process.cpuUsage(),currentElu=performance.eventLoopUtilization();
 report.samples.push({at:Date.now(),phase,intervalMs:now-last,hostCpuPercent:100*(1-(current.idle-previous.idle)/(current.total-previous.total)),freeBytes:os.freemem(),
  nodeCpuOneCorePercent:100*((used.user+used.system-processPrevious.user-processPrevious.system)/1000)/(now-last),
  eventLoopUtilization:performance.eventLoopUtilization(currentElu,elu).utilization,eventLoopDelayMaxMs:lag.max/1e6});
 previous=current;last=now;processPrevious=used;elu=currentElu;lag.reset();
},500);timer.unref();
const external=(process.env.C6_EXTERNAL_CONTAINERS||'').split(',').filter(Boolean);
if(external.some(id=>! /^[a-f0-9]{12,64}$/.test(id)))throw Error('INVALID_EXTERNAL_CONTAINER_ID');
function sampleExternal(){if(busy||!external.length)return;busy=true;const startedAt=Date.now(),startedPhase=phase;
 execFile('docker',['stats','--no-stream','--format','{{.CPUPerc}}',...external],{windowsHide:true,timeout:10000,maxBuffer:8192},(err,stdout)=>{
  busy=false;if(err){report.samplingErrors.push({phase:startedPhase,code:'EXTERNAL_STATS_FAILED'});return;}
  const values=stdout.trim().split(/\r?\n/).map(v=>Number(v.replace('%','')));
  if(values.length!==external.length||values.some(v=>!Number.isFinite(v))){report.samplingErrors.push({phase:startedPhase,code:'EXTERNAL_STATS_INVALID'});return;}
  report.externalSamples.push({startedAt,finishedAt:Date.now(),phase:startedPhase,finishedPhase:phase,cpuOneCorePercent:values.reduce((a,b)=>a+b,0),containers:values.length});
 });
}
const externalTimer=setInterval(sampleExternal,5000);externalTimer.unref();sampleExternal();
process.on('exit',()=>{
 clearInterval(timer);clearInterval(externalTimer);lag.disable();Module._extensions['.js']=original;
 report.instrumentationObserved=installed;report.completeVariant=report.loaded.length===3&&new Set(report.loaded.map(x=>x.path)).size===3;
 report.externalContainerCount=external.length;
 const out=path.join(root,'context/reviews',process.env.HTTP_PROOF_REPORT);fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'host-variant.json'),JSON.stringify(report,null,2)+'\n');
 if(!report.completeVariant||!installed)process.exitCode=1;
});
