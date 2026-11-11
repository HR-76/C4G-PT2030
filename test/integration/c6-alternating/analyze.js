'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),reviews=path.join(root,'context/reviews'),out=path.join(reviews,'c6-alternating-host');
const sources=[];
function read(file){const raw=fs.readFileSync(file);sources.push({path:path.relative(root,file).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(raw).digest('hex')});return JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''));}
const round=x=>Number.isFinite(x)?Math.round(x*100)/100:null;
const mean=xs=>xs.length?round(xs.reduce((a,b)=>a+b,0)/xs.length):null;
const max=xs=>xs.length?round(Math.max(...xs)):null;
const min=xs=>xs.length?round(Math.min(...xs)):null;
const median=xs=>{const s=[...xs].sort((a,b)=>a-b);return s.length?round(s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2):null;};
const quantile=(xs,p)=>xs.length?round([...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1]):null;
const distinct=xs=>[...new Set(xs)];
const query=(r,pattern,field='calls')=>Object.entries(r.metrics.queries).filter(([k])=>pattern.test(k)).reduce((n,[,q])=>n+q[field],0);
const control=read(path.join(out,'host-control.json'));assert.equal(control.status,'COMPLETE');assert.equal(control.runs.length,6);assert.deepEqual(control.initial,control.final);
const beforeHashes=read(path.join(reviews,'grouped-authority-validation/baseline.json')).hashes;
const afterHashes=read(path.join(reviews,'grouped-authority-validation/verification.json')).sourceHashes;
const variantPaths=['backend/src/applications/composition.js','backend/src/opportunities/httpComposition.js','backend/src/security/authorityCoordinator.js'];
let policies,checks;
const runs=control.runs.map((entry,i)=>{
 assert.equal(entry.variant,i%2?'after':'before');assert.equal(entry.status,'COMPLETE');assert.equal(entry.exitCode,0);assert.deepEqual(entry.config,control.initial);
 const dir=path.join(reviews,entry.report),raw=read(path.join(dir,'results.json')),summary=read(path.join(dir,'summary.json')),host=read(path.join(dir,'host-variant.json'));
 assert.equal(raw.status,'COMPLETE');assert.equal(raw.scenarios.length,1);assert.equal(host.variant,entry.variant);assert(host.completeVariant&&host.instrumentationObserved);assert.equal(host.loaded.length,3);
 assert.deepEqual(host.loaded.map(x=>x.path).sort(),[...variantPaths].sort());
 for(const loaded of host.loaded)assert.equal(loaded.sha256,(entry.variant==='before'?beforeHashes:afterHashes)[loaded.path]);
 assert(!raw.cleanupError);assert.equal(raw.mode,'capacity');
 if(!policies){policies=raw.instrumentation.policies;checks=raw.checks;}else{assert.deepEqual(raw.instrumentation.policies,policies);assert.deepEqual(raw.checks,checks);}
 assert.equal(policies[0].perTenantLimit,5);assert.equal(policies[0].acquireTimeoutMs,5000);assert.equal(policies[0].leaseTimeoutMs,15000);
 const scenario=raw.scenarios[0],s=summary.scenarios[0];assert.equal(scenario.name,'dashboard-c6');assert.equal(scenario.samples,6);assert.equal(scenario.concurrency,6);assert.equal(scenario.tenants,1);assert.equal(scenario.warmup.status,200);
 const rows=scenario.results,good=rows.filter(r=>r.status===200);assert.equal(good.length,scenario.successes);assert.equal(rows.length-good.length,scenario.errors);
 assert.equal(quantile(good.map(r=>r.ms),.5),scenario.p50Ms);assert.equal(quantile(good.map(r=>r.ms),.95),scenario.p95Ms);
 const expected=entry.variant==='before'?{queries:2619,tx:42}:{queries:2421,tx:36};
 for(const r of good){assert.equal(r.total,1000);assert.equal(r.metrics.queryCount,expected.queries);assert.equal(r.metrics.authorityTransactions,expected.tx);
  assert.equal(query(r,/authority\/authority-protocol$/),198);assert.equal(query(r,/\/audit-prepare$/),10);assert.equal(query(r,/\/audit-append$/),10);assert.equal(query(r,/\/application-selection$/),1);}
 assert.equal(s.afterResponseQueryCompletions,rows.reduce((n,r)=>n+Object.values(r.metrics.afterResponseQueries||{}).reduce((a,q)=>a+q.calls,0),0));
 const start=host.phases.find(p=>p.phase==='dashboard-c6')?.at,end=host.phases.find(p=>p.phase==='dashboard-c6-drain')?.at;assert(end>start);
 const samples=host.samples.filter(x=>x.phase==='dashboard-c6');assert(samples.length>=2);
 const external=host.externalSamples.filter(x=>x.startedAt<=end&&x.finishedAt>=start);
 const preflight=fs.readdirSync(dir).filter(n=>/^idle-[0-9]+\.json$/.test(n)).sort().map(n=>read(path.join(dir,n)));assert(preflight.at(-1).pass);
 const externalOk=host.externalContainerCount===0||external.length>0&&external.every(x=>x.cpuOneCorePercent<=10);
 const hostAssessment={preflightPass:preflight.at(-1).pass,preflightAttempts:preflight.length,externalCpuBefore:entry.externalCpuBefore,
  backgroundContainerSamples:external.length,backgroundContainerCpuMax:max(external.map(x=>x.cpuOneCorePercent)),backgroundContainersQuiet:externalOk,
  samplingErrors:host.samplingErrors,hostCpuMean:mean(samples.map(x=>x.hostCpuPercent)),hostCpuMax:max(samples.map(x=>x.hostCpuPercent)),
  freeMemoryMinGiB:round(Math.min(...samples.map(x=>x.freeBytes))/1024**3),nodeCpuOneCoreMean:mean(samples.map(x=>x.nodeCpuOneCorePercent)),
  eventLoopUtilizationMean:mean(samples.map(x=>x.eventLoopUtilization)),eventLoopDelayMaxMs:max(samples.map(x=>x.eventLoopDelayMaxMs)),
  sampleIntervalMaxMs:max(samples.map(x=>x.intervalMs)),sampleCount:samples.length,
  controlledChecksPass:externalOk&&host.samplingErrors.length===0&&samples.every(x=>x.freeBytes>=4*1024**3)};
 const successfulMetric=field=>mean(good.map(r=>query(r,field,'ms')));
 return {index:i+1,variant:entry.variant,report:entry.report,startedAt:raw.startedAt,finishedAt:raw.finishedAt,
  successes:scenario.successes,errors:scenario.errors,p50Ms:scenario.p50Ms,p95Ms:scenario.p95Ms,elapsedMs:scenario.elapsedMs,warmupMs:scenario.warmup.ms,
  requests:rows.map(r=>({status:r.status,code:r.code??null,ms:r.ms,queries:r.metrics.queryCount,tx:r.metrics.authorityTransactions})),
  queryCounts:distinct(good.map(r=>r.metrics.queryCount)),authorityTransactions:distinct(good.map(r=>r.metrics.authorityTransactions)),
  protocolCalls:distinct(good.map(r=>query(r,/authority\/authority-protocol$/))),auditAppends:distinct(good.map(r=>query(r,/\/audit-append$/))),
  meanMetadataMs:successfulMetric(/\/metadata$/),meanAuthorityMetadataMs:successfulMetric(/^authority\/metadata$/),meanTenantMetadataMs:successfulMetric(/^tenant.*\/metadata$/),
  meanAuditPrepareMs:successfulMetric(/\/audit-prepare$/),meanCentralLockWaitMs:successfulMetric(/\/authority-lock$/),
  meanAuditHeldMs:mean(good.map(r=>r.metrics.locks['audit-held'].ms)),maxAuditHeldMs:max(good.map(r=>r.metrics.locks['audit-held'].maxMs)),
  meanCentralHeldMs:mean(good.map(r=>r.metrics.locks['central-held'].ms)),
  meanTenantHoldMs:mean(good.flatMap(r=>r.metrics.checkouts.filter(c=>c.role.startsWith('tenant')).map(c=>c.holdMs))),
  tenantCheckoutMaxMs:s.physicalCheckouts.tenant.maxWaitMs,authorityCheckoutMaxMs:s.physicalCheckouts.authority.maxWaitMs,
  admissionMaxMs:s.logicalAdmissions.maxWaitMs,admissionErrors:s.logicalAdmissions.errors.length,maxActive:s.maxActive,maxQueued:s.maxQueued,
  afterResponseQueries:s.afterResponseQueryCompletions,samplerMeanMs:summary.sampleQueryMeanMs,samplerMaxMs:summary.sampleQueryMaxMs,
  host:hostAssessment,loadedSources:host.loaded};
});
const delta=(a,b)=>({before:a,after:b,delta:round(b-a),percent:round((b/a-1)*100)});
const pairs=[0,2,4].map(i=>{const a=runs[i],b=runs[i+1];return {pair:i/2+1,beforeRun:a.index,afterRun:b.index,
 controlledChecksPass:a.host.controlledChecksPass&&b.host.controlledChecksPass,
 p50:delta(a.p50Ms,b.p50Ms),p95:delta(a.p95Ms,b.p95Ms),metadata:delta(a.meanMetadataMs,b.meanMetadataMs),
 auditHeld:delta(a.meanAuditHeldMs,b.meanAuditHeldMs),admissionMax:delta(a.admissionMaxMs,b.admissionMaxMs),
 hostCpuMean:delta(a.host.hostCpuMean,b.host.hostCpuMean),beforeErrors:a.errors,afterErrors:b.errors};});
const aggregates=['before','after'].map(variant=>{const subset=runs.filter(r=>r.variant===variant),good=subset.flatMap(r=>r.requests.filter(x=>x.status===200));return{variant,
 bursts:subset.length,successes:good.length,errors:subset.reduce((n,r)=>n+r.errors,0),medianBurstP50Ms:median(subset.map(r=>r.p50Ms)),medianBurstP95Ms:median(subset.map(r=>r.p95Ms)),
 pooledP50Ms:quantile(good.map(r=>r.ms),.5),pooledP95Ms:quantile(good.map(r=>r.ms),.95),worstAdmissionMs:max(subset.map(r=>r.admissionMaxMs))};});
const report={at:new Date().toISOString(),status:'COMPLETE',allRequestsPassed:runs.every(r=>r.errors===0),controlledChecksPassed:runs.every(r=>r.host.controlledChecksPass),
 sources,configuration:control.initial,policies,checks,runs,pairs,aggregates,
 medianPairedP95ChangePercent:median(pairs.map(p=>p.p95.percent)),
 limits:['A/B/A/B/A/B is alternating but not randomized or order-balanced; temporal drift remains possible.',
 'Three paired bursts, not eighteen independent experiments per variant; pooled quantiles are descriptive only.',
 'Each burst p95 is its maximum of six requests. No production SLO or capacity conclusion.',
 'Host is shared; baseline Docker containers observed, but Windows background processes, temperature and effective frequency are not fully controlled.',
 'Same added host instrumentation in both variants. Historical results without it are not interchangeable.',
 'Driver SQL sums and overlapping lock/checkout times are not additive to HTTP wall time.',
 'Any contaminated run is retained; control flags do not prove full host isolation.']};
fs.writeFileSync(path.join(out,'comparison.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({allRequestsPassed:report.allRequestsPassed,controlledChecksPassed:report.controlledChecksPassed,pairs,aggregates},null,2));
