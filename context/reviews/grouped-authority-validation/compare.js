'use strict';
// Artifact comparison only: no application modules, network, database or workload.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),reviews=path.join(root,'context/reviews');
const sources=[];
const round=n=>Number.isFinite(n)?Math.round(n*100)/100:null;
const finite=values=>values.filter(Number.isFinite);
const sum=values=>values.reduce((n,x)=>n+x,0);
const mean=values=>values.length?round(sum(values)/values.length):null;
const max=values=>values.length?round(Math.max(...values)):null;
const min=values=>values.length?round(Math.min(...values)):null;
const percentile=(values,p)=>values.length?round([...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]):null;
const distinct=values=>[...new Set(values)].sort((a,b)=>typeof a==='number'&&typeof b==='number'?a-b:String(a).localeCompare(String(b)));
const safeCode=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value)?value:null;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const stats=values=>{const xs=finite(values);return {count:xs.length,sum:round(sum(xs)),mean:mean(xs),min:min(xs),max:max(xs),p50:percentile(xs,.5),p95:percentile(xs,.95)};};
const delta=(before,after)=>({before,after,change:Number.isFinite(before)&&Number.isFinite(after)?round(after-before):null,
 changePercent:Number.isFinite(before)&&before!==0&&Number.isFinite(after)?round((after-before)*100/before):null});
function read(directory,name='results.json'){
 const file=path.join(reviews,directory,name),raw=fs.readFileSync(file,'utf8');
 sources.push({path:path.relative(root,file).replaceAll('\\','/'),sha256:createHash('sha256').update(raw).digest('hex')});
 const result=JSON.parse(raw.replace(/^\uFEFF/,''));
 assert(result.status&&result.status!=='RUNNING','INPUT_NOT_TERMINAL: '+directory+'/'+name);
 return result;
}
const codes=items=>items.reduce((out,item)=>{const key=safeCode(item?.code||item?.error)||'UNKNOWN';out[key]=(out[key]||0)+1;return out;},{});
const duration=r=>Number.isFinite(Date.parse(r.finishedAt))&&Number.isFinite(Date.parse(r.startedAt))?round((Date.parse(r.finishedAt)-Date.parse(r.startedAt))/1000):null;
const policy=p=>Object.fromEntries(Object.entries(p).filter(([,v])=>typeof v==='number'||typeof v==='boolean').sort(([a],[b])=>a.localeCompare(b)));
const role=r=>r?.startsWith('tenant')?'tenant':['authority','catalog','central-reader'].includes(r)?r:'unknown';
function queryMetric(result,pattern){
 const entries=Object.entries(result.metrics?.queries||{}).filter(([key])=>pattern.test(key));
 return {calls:sum(entries.map(([,q])=>q.calls)),ms:sum(entries.map(([,q])=>q.ms)),maxMs:max(entries.map(([,q])=>q.maxMs))};
}
function queryAggregate(rows,pattern){
 const values=rows.map(r=>queryMetric(r,pattern));
 return {callsPerRequest:distinct(values.map(v=>v.calls)),callsTotal:sum(values.map(v=>v.calls)),
  sumMsPerRequest:stats(values.map(v=>v.ms)),maxIndividualCallMs:max(values.map(v=>v.maxMs).filter(Number.isFinite))};
}
function lockAggregate(rows,key){
 const values=rows.map(r=>r.metrics?.locks?.[key]||{calls:0,ms:0,maxMs:0});
 return {callsPerRequest:distinct(values.map(v=>v.calls)),callsTotal:sum(values.map(v=>v.calls)),
  heldSumMsPerRequest:stats(values.map(v=>v.ms)),maxIndividualHoldMs:max(values.map(v=>v.maxMs))};
}
function requestAggregate(rows){
 const categories={};
 for(const row of rows)for(const [key,q]of Object.entries(row.metrics?.queries||{})){
  const slash=key.indexOf('/'),safeKey=role(key.slice(0,slash))+key.slice(slash);
  const target=categories[safeKey]||={calls:0,ms:0,maxMs:0};
  target.calls+=q.calls;target.ms+=q.ms;target.maxMs=Math.max(target.maxMs,q.maxMs);
 }
 return {requests:rows.length,queryCounts:distinct(rows.map(r=>r.metrics?.queryCount)),authorityTransactions:distinct(rows.map(r=>r.metrics?.authorityTransactions)),
  queriesPerRequest:stats(rows.map(r=>r.metrics?.queryCount)),transactionsPerRequest:stats(rows.map(r=>r.metrics?.authorityTransactions)),
  authorityProtocol:queryAggregate(rows,/^authority\/authority-protocol$/),auditPrepare:queryAggregate(rows,/\/audit-prepare$/),
  auditAppend:queryAggregate(rows,/\/audit-append$/),applicationSelection:queryAggregate(rows,/\/application-selection$/),
  metadata:queryAggregate(rows,/\/metadata$/),centralLockQuery:queryAggregate(rows,/\/authority-lock$/),
  sqlDurationSumMsPerRequest:stats(rows.map(r=>sum(Object.values(r.metrics?.queries||{}).map(q=>q.ms)))),
  locks:{audit:lockAggregate(rows,'audit-held'),central:lockAggregate(rows,'central-held')},
  categories:Object.fromEntries(Object.entries(categories).sort(([a],[b])=>a.localeCompare(b)).map(([key,q])=>[key,{
   callsTotal:q.calls,callsMeanPerRequest:rows.length?round(q.calls/rows.length):null,
   msMeanPerRequest:rows.length?round(q.ms/rows.length):null,maxIndividualMs:round(q.maxMs)}]))};
}
function admissionAggregate(rows){
 const admissions=rows.flatMap(r=>r.metrics?.admissions||[]),failed=admissions.filter(a=>a.error),good=admissions.filter(a=>!a.error);
 return {count:admissions.length,successes:good.length,errors:failed.length,waitMs:stats(admissions.map(a=>a.ms)),
  successfulWaitMs:stats(good.map(a=>a.ms)),failedWaitMs:stats(failed.map(a=>a.ms)),
  failureCodes:codes(failed),failed:failed.map(a=>({ms:a.ms,code:safeCode(a.error)})),
  grantedLeaseRemainingMs:distinct(good.map(a=>a.leaseRemainingMs).filter(Number.isFinite))};
}
function checkoutAggregate(rows){
 const all=rows.flatMap(r=>r.metrics?.checkouts||[]);
 return Object.fromEntries(['authority','tenant','catalog','central-reader'].map(name=>{
  const xs=all.filter(c=>role(c.role)===name);
  return [name,{count:xs.length,waitMs:stats(xs.map(c=>c.waitMs)),holdMs:stats(xs.map(c=>c.holdMs)),
   waitingAtEntryMax:max(xs.map(c=>c.waiting)),poolTotalAtEntryMax:max(xs.map(c=>c.total)),configuredMaxValues:distinct(xs.map(c=>c.max)),
   discards:xs.filter(c=>c.discard).length,errorCodes:codes(xs.filter(c=>c.error))}];
 }));
}
const afterResponse=rows=>sum(rows.map(r=>sum(Object.values(r.metrics?.afterResponseQueries||{}).map(q=>q.calls))));
function warmup(r){
 return {status:r.status,code:safeCode(r.code),ms:r.ms,total:r.total??null,queryCount:r.metrics?.queryCount??null,
  authorityTransactions:r.metrics?.authorityTransactions??null,authorityProtocolCalls:queryMetric(r,/^authority\/authority-protocol$/).calls,
  auditPrepareCalls:queryMetric(r,/\/audit-prepare$/).calls,auditAppendCalls:queryMetric(r,/\/audit-append$/).calls,
  admissions:admissionAggregate([r]),checkouts:checkoutAggregate([r]),afterResponseQueryCompletions:afterResponse([r])};
}
function scenario(s,summary){
 const rows=s.results,good=rows.filter(r=>r.status===200);
 assert.equal(rows.length,s.samples,'RAW_SAMPLE_COUNT_MISMATCH');assert.equal(good.length,s.successes,'RAW_SUCCESS_COUNT_MISMATCH');
 for(const key of ['samples','successes','errors','p50Ms','p95Ms','drainMs'])assert.equal(summary[key],s[key],'SUMMARY_'+key+'_MISMATCH');
 assert.deepEqual(summary.queryCount,rows.map(r=>r.metrics.queryCount),'SUMMARY_QUERY_COUNT_MISMATCH');
 assert.deepEqual(summary.authorityTransactions,rows.map(r=>r.metrics.authorityTransactions),'SUMMARY_AUTHORITY_COUNT_MISMATCH');
 assert.equal(summary.afterResponseQueryCompletions,afterResponse(rows),'SUMMARY_AFTER_RESPONSE_MISMATCH');
 assert.equal(s.p50Ms,percentile(good.map(r=>r.ms),.5),'RAW_P50_MISMATCH');
 assert.equal(s.p95Ms,percentile(good.map(r=>r.ms),.95),'RAW_P95_MISMATCH');
 const admissions=admissionAggregate(rows),checkouts=checkoutAggregate(rows);
 assert.equal(summary.logicalAdmissions.count,admissions.count,'SUMMARY_ADMISSION_COUNT_MISMATCH');
 assert.equal(summary.logicalAdmissions.maxWaitMs,admissions.waitMs.max,'SUMMARY_ADMISSION_MAX_MISMATCH');
 assert.equal(summary.logicalAdmissions.errors.length,admissions.errors,'SUMMARY_ADMISSION_ERRORS_MISMATCH');
 for(const name of ['authority','tenant']){
  assert.equal(summary.physicalCheckouts[name].count,checkouts[name].count,'SUMMARY_CHECKOUT_COUNT_MISMATCH');
  assert.equal(summary.physicalCheckouts[name].maxWaitMs,checkouts[name].waitMs.max,'SUMMARY_CHECKOUT_MAX_MISMATCH');
 }
 return {name:s.name,kind:s.kind,concurrency:s.concurrency,tenants:s.tenants,samples:s.samples,successes:s.successes,errors:s.errors,
  p50Ms:s.p50Ms,p95Ms:s.p95Ms,elapsedMs:s.elapsedMs,drainMs:s.drainMs,successThroughputPerSecond:summary.successThroughputPerSecond,
  individual:rows.map(r=>({status:r.status,code:safeCode(r.code),ms:r.ms,failures:codes(r.metrics?.failures||[]),
   queryCount:r.metrics?.queryCount,authorityTransactions:r.metrics?.authorityTransactions})),
  allRequests:requestAggregate(rows),successfulRequests:requestAggregate(good),admissions,checkouts,
  sampling:{frames:summary.sampledFrames,activeMax:summary.maxActive,queuedMax:summary.maxQueued,queuedFrames:summary.framesQueued,
   auditBlockedFrames:summary.auditBlockedFrames,centralBlockedFrames:summary.centralBlockedFrames,auditWaitEvents:summary.auditWaitEvents},
  afterResponseQueryCompletions:afterResponse(rows),warmup:warmup(s.warmup),summaryMatchesRaw:true};
}
function profile(directory,expectedNames){
 const raw=read(directory),summary=read(directory,'summary.json');
 assert.equal(raw.status,'COMPLETE','PROFILE_NOT_COMPLETE');assert.equal(summary.status,raw.status,'PROFILE_SUMMARY_STATUS_MISMATCH');
 assert.equal(summary.finishedAt,raw.finishedAt,'STALE_PROFILE_SUMMARY');
 assert.deepEqual(raw.scenarios.map(s=>s.name),expectedNames,'PROFILE_SCENARIO_SET_MISMATCH');
 assert.equal(summary.sampleCount,raw.instrumentation.samples.length,'SUMMARY_SAMPLER_COUNT_MISMATCH');
 assert.deepEqual(summary.policies,raw.instrumentation.policies,'SUMMARY_POLICY_MISMATCH');
 return {directory,status:raw.status,startedAt:raw.startedAt,finishedAt:raw.finishedAt,durationSeconds:duration(raw),
  mode:raw.mode,postgres:raw.postgres,centralMigration:raw.centralMigration,checks:raw.checks,limits:raw.limits,
  policies:summary.policies.map(policy),sampler:{samples:summary.sampleCount,queryMeanMs:summary.sampleQueryMeanMs,queryMaxMs:summary.sampleQueryMaxMs},
  cleanupError:safeCode(raw.cleanupError?.code),lastManagers:(raw.instrumentation.samples.at(-1)?.managers||[]).map(policy),
  scenarios:raw.scenarios.map(s=>scenario(s,summary.scenarios.find(x=>x.name===s.name))),raw};
}
function comparisonScenario(before,after){
 const a=before.successfulRequests,b=after.successfulRequests,report=before.kind==='report';
 const expected={before:{queries:report?1117:2619,transactions:report?21:42},after:{queries:report?1051:2421,transactions:report?19:36},
  protocol:report?77:198,auditPrepareAndAppend:report?5:10};
 return {name:before.name,configurationEquivalent:['kind','concurrency','tenants','samples'].every(k=>before[k]===after[k]),
  baselineCounterExpectationMatches:same(a.queryCounts,[expected.before.queries])&&same(a.authorityTransactions,[expected.before.transactions])
   &&same(a.authorityProtocol.callsPerRequest,[expected.protocol])&&same(a.auditPrepare.callsPerRequest,[expected.auditPrepareAndAppend])
   &&same(a.auditAppend.callsPerRequest,[expected.auditPrepareAndAppend]),
  groupedCounterExpectationMatches:same(b.queryCounts,[expected.after.queries])&&same(b.authorityTransactions,[expected.after.transactions]),
  protocolPreserved:same(a.authorityProtocol.callsPerRequest,b.authorityProtocol.callsPerRequest),
  auditCountsPreserved:same(a.auditPrepare.callsPerRequest,b.auditPrepare.callsPerRequest)&&same(a.auditAppend.callsPerRequest,b.auditAppend.callsPerRequest),
  applicationSelectionCountsPreserved:same(a.applicationSelection.callsPerRequest,b.applicationSelection.callsPerRequest),
  expected,p50Ms:delta(before.p50Ms,after.p50Ms),p95Ms:delta(before.p95Ms,after.p95Ms),errors:delta(before.errors,after.errors),
  auditHeldMeanMs:delta(a.locks.audit.heldSumMsPerRequest.mean,b.locks.audit.heldSumMsPerRequest.mean),
  centralHeldMeanMs:delta(a.locks.central.heldSumMsPerRequest.mean,b.locks.central.heldSumMsPerRequest.mean),
  admissionMaxMs:delta(before.admissions.waitMs.max,after.admissions.waitMs.max),
  warmupStatusEquivalent:before.warmup.status===after.warmup.status,before,after};
}
function profilePair(beforeDirectory,afterDirectory,names){
 const before=profile(beforeDirectory,names),after=profile(afterDirectory,names);
 const result={policiesEquivalent:same(before.policies,after.policies),postgresEquivalent:before.postgres===after.postgres,
  centralMigrationEquivalent:before.centralMigration===after.centralMigration,
  checksAdded:after.checks.filter(c=>!before.checks.includes(c)),checksRemoved:before.checks.filter(c=>!after.checks.includes(c)),
  limitsEquivalent:same(before.limits,after.limits),before:Object.fromEntries(Object.entries(before).filter(([k])=>!['scenarios','raw'].includes(k))),
  after:Object.fromEntries(Object.entries(after).filter(([k])=>!['scenarios','raw'].includes(k))),
  scenarios:before.scenarios.map(s=>comparisonScenario(s,after.scenarios.find(a=>a.name===s.name)))};
 return {result,beforeRaw:before.raw,afterRaw:after.raw};
}
function httpRun(directory){
 const r=read(directory);assert(['PASS','FAIL'].includes(r.status),'HTTP_NOT_TERMINAL');assert.equal(r.scope,'all','HTTP_SCOPE_MISMATCH');
 assert.equal(r.measurements.length,9,'HTTP_MEASUREMENTS_INCOMPLETE');assert(r.finishedAt,'HTTP_FINISH_MISSING');
 const measurements=r.measurements.map(m=>{
  assert(!m.warmupFailed,'HTTP_WARMUP_FAILED_NO_EQUIVALENT_MEASUREMENT');assert.equal(m.statuses.length,m.samples,'HTTP_STATUSES_INCOMPLETE');
  assert.equal(m.statuses.filter(x=>x===200).length,m.successes,'HTTP_SUCCESS_COUNT_MISMATCH');
  return {name:m.name,volume:m.volume,people:m.people,samples:m.samples,concurrency:m.concurrency,warmups:m.warmups,
   successes:m.successes,errors:m.errors,statuses:m.statuses,p50Ms:m.p50Ms,p95Ms:m.p95Ms,errorP95Ms:m.errorP95Ms,elapsedMs:m.elapsedMs,
   payloadBytes:m.payloadBytes,sqlCalls:m.sqlCalls,applicationSelections:distinct(m.applicationSelections),peopleBatchSelections:distinct(m.peopleBatchSelections),
   firstCompletedRequestProtocolCalls:m.firstProfile?.profile?.['authority/authority-protocol']?.calls??null};
 });
 return {directory,status:r.status,scope:r.scope,startedAt:r.startedAt,finishedAt:r.finishedAt,durationSeconds:duration(r),
  checks:r.checks,postgres:r.postgres,centralMigration:r.centralMigration,keycloak:r.keycloak,node:r.node,browser:r.browser,limits:r.limits,
  samples:sum(measurements.map(m=>m.samples)),successes:sum(measurements.map(m=>m.successes)),errors:sum(measurements.map(m=>m.errors)),
  observerFailureCodes:codes(r.failures||[]),blockers:(r.blockers||[]).map(b=>({test:b.test,reason:safeCode(b.reason),status:b.status??null,code:safeCode(b.code)})),
  cleanupError:safeCode(r.cleanupError?.code),error:safeCode(r.error?.code),sessionTouch:r.sessionTouch,sessionRenewal:r.sessionRenewal,
  concurrentRevocation:r.concurrentRevocation,revokedDashboard:r.revokedDashboard,measurements};
}
function httpPair(){
 const before=httpRun('http-audit-dashboard-gate'),after=httpRun('grouped-authority-http');
 return {before,after,configurationEquivalent:before.scope===after.scope&&before.postgres===after.postgres&&before.centralMigration===after.centralMigration,
  checksAdded:after.checks.filter(c=>!before.checks.includes(c)),checksRemoved:before.checks.filter(c=>!after.checks.includes(c)),
  durationSeconds:delta(before.durationSeconds,after.durationSeconds),measurements:before.measurements.map(b=>{
   const a=after.measurements.find(m=>m.name===b.name&&m.volume===b.volume);assert(a,'HTTP_MATCHING_MEASUREMENT_MISSING');
   return {name:b.name,volume:b.volume,configurationEquivalent:['volume','people','samples','concurrency','warmups'].every(k=>b[k]===a[k]),
    p50Ms:delta(b.p50Ms,a.p50Ms),p95Ms:delta(b.p95Ms,a.p95Ms),errors:delta(b.errors,a.errors),payloadBytesEquivalent:same(b.payloadBytes,a.payloadBytes),
    applicationSelectionCountsEquivalent:same(b.applicationSelections,a.applicationSelections),before:b,after:a};
  }),limits:['HTTP results retain only the first completed request SQL profile per measurement; that profile cannot establish per-request transaction or audit counts.',
   'HTTP warmups are recorded as counts, without successful warmup timings; no warmup latency is inferred.']};
}
function union(events,ceiling=Infinity){
 const spans=events.map(e=>[Math.max(0,e[0]),Math.min(ceiling,e[1])]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
 let end=-Infinity,total=0;for(const [a,b]of spans)if(b>end){total+=b-Math.max(a,end);end=b;}return total;
}
function stages(directory,raw){
 const summary=read(directory,'stages-summary.json');assert.equal(summary.status,raw.status,'STALE_STAGES_SUMMARY');
 const rows=raw.scenarios.find(s=>s.name==='dashboard-c1').results;
 assert.equal(rows.length,4,'C1_SAMPLE_COUNT_MISMATCH');assert.equal(summary.samples,rows.length,'STAGES_SUMMARY_SAMPLE_MISMATCH');
 const expected=['report','privateSummary','centralSummary','dashboardContext'];
 const evidence=rows.map(r=>{
  const t=r.metrics.stageTrace;assert(t?.captureEvents,'STAGE_EVENTS_MISSING');const ss=t.spans.filter(s=>s.kind==='stage');
  assert.deepEqual(ss.map(s=>s.name),expected,'STAGE_ORDER_MISMATCH');
  assert(ss.every((s,i)=>!s.failed&&Number.isFinite(s.endMs)&&(i===0||s.startMs>=ss[i-1].endMs-.02)),'STAGE_FAILURE_OR_OVERLAP');
  assert.equal(t.queryEvents.length,r.metrics.queryCount,'STAGE_EVENT_COUNT_MISMATCH');
  assert.equal(sum(Object.values(t.stages).map(s=>s.queries)),r.metrics.queryCount,'STAGE_QUERY_COUNT_MISMATCH');
  assert.equal(sum(Object.values(t.stages).map(s=>s.authorityTransactions)),r.metrics.authorityTransactions,'STAGE_AUTHORITY_COUNT_MISMATCH');
  assert(t.queryEvents.every(e=>e[0]>=0&&e[1]<=t.responseMs+.02),'STAGE_QUERY_OUTSIDE_RESPONSE');
  const sqlUnion=union(t.queryEvents,t.responseMs),metadataUnion=union(t.queryEvents.filter(e=>e[4]==='metadata'),t.responseMs);
  return {httpMs:r.ms,responseMs:t.responseMs,sqlSumMs:sum(t.queryEvents.map(e=>e[1]-e[0])),sqlUnionMs:sqlUnion,
   metadataUnionMs:metadataUnion,outsideQueryMs:t.responseMs-sqlUnion,metadataCoveragePercent:metadataUnion*100/t.responseMs,
   stages:ss.map(s=>({name:s.name,startMs:s.startMs,endMs:s.endMs,ms:s.ms}))};
 });
 for(const key of ['httpMs','responseMs','sqlSumMs','sqlUnionMs','metadataUnionMs','outsideQueryMs'])
  assert(Math.abs(mean(evidence.map(r=>r[key]))-summary.means[key])<=.02,'STAGES_MEAN_MISMATCH_'+key);
 for(const s of summary.stages){
  assert.deepEqual(s.queries,distinct(rows.map(r=>r.metrics.stageTrace.stages[s.name].queries)),'STAGES_QUERY_SUMMARY_MISMATCH');
  assert.deepEqual(s.authorityTransactions,distinct(rows.map(r=>r.metrics.stageTrace.stages[s.name].authorityTransactions)),'STAGES_TX_SUMMARY_MISMATCH');
 }
 return {directory,samples:rows.length,verifiedFromRaw:true,means:summary.means,stages:summary.stages,
  meanMetadataIntervalCoveragePercent:mean(evidence.map(r=>r.metadataCoveragePercent)),individual:evidence,limits:summary.limits};
}
function run(){
 const names=['report-c1','report-c2','report-c4','dashboard-c1','dashboard-c4','dashboard-two-tenants-c4'];
 const http=httpPair(),standard=profilePair('dashboard-c1-stages','grouped-authority-standard',names),
  capacity=profilePair('audit-dashboard-capacity','grouped-authority-capacity',['dashboard-c6']);
 const beforeStages=stages('dashboard-c1-stages',standard.beforeRaw),afterStages=stages('grouped-authority-standard',standard.afterRaw);
 const report={generatedAt:new Date().toISOString(),sources,http,standard:standard.result,capacity:capacity.result,
  stages:{before:beforeStages,after:afterStages,comparison:beforeStages.stages.map(b=>{
   const a=afterStages.stages.find(s=>s.name===b.name);assert(a,'MATCHING_STAGE_MISSING');
   return {name:b.name,wallMeanMs:delta(b.wallMeanMs,a.wallMeanMs),queries:{before:b.queries,after:a.queries},
    authorityTransactions:{before:b.authorityTransactions,after:a.authorityTransactions},authorityProtocolCalls:{before:b.authorityProtocolCalls,after:a.authorityProtocolCalls},
    protocolCountsPreserved:same(b.authorityProtocolCalls,a.authorityProtocolCalls),sqlSumMeanMs:delta(b.sqlSumMeanMs,a.sqlSumMeanMs),
    sqlUnionMeanMs:delta(b.sqlUnionMeanMs,a.sqlUnionMeanMs),metadataSumMeanMs:delta(b.metadataSumMeanMs,a.metadataSumMeanMs)};
  })},limits:[
   'Success latency quantiles exclude failed responses; all-request and successful-request SQL/lock aggregates are both retained.',
   'SQL durations include driver/network/client queue time; sums and inclusive checkpoint spans are not exclusive HTTP wall time.',
   'Only C1 stage traces provide interval unions. Sampled blocked frames are observations, not exact wait durations.',
   'Warmup observations are separate and retained as measured. Mixed-tenant standard warms tenant A only.',
   'Physical checkout attribution may follow the manager dispatching a queued task; per-scenario/pool aggregates are used.',
   'After-response counters represent query completions after response finish, not necessarily queries started afterwards.',
   'The standard comparison uses the same stage observer in both runs. Capacity uses the unmodified profile without it.',
   'Local synthetic independent runs with small samples and no alternating-version control; no production SLO/capacity or isolated causal claim.'
  ]};
 fs.writeFileSync(path.join(__dirname,'comparison.json'),JSON.stringify(report,null,2)+'\n');
 const compact=part=>part.scenarios.map(s=>({name:s.name,beforeOK:s.before.successes+'/'+s.before.samples,afterOK:s.after.successes+'/'+s.after.samples,
  p50:s.p50Ms,p95:s.p95Ms,queryCounts:{before:s.before.successfulRequests.queryCounts,after:s.after.successfulRequests.queryCounts},
  transactions:{before:s.before.successfulRequests.authorityTransactions,after:s.after.successfulRequests.authorityTransactions},
  protocolPreserved:s.protocolPreserved,auditCountsPreserved:s.auditCountsPreserved}));
 console.log(JSON.stringify({artifact:'context/reviews/grouped-authority-validation/comparison.json',http:{before:http.before.successes+'/'+http.before.samples,after:http.after.successes+'/'+http.after.samples},
  standard:compact(report.standard),capacity:compact(report.capacity),policiesEquivalent:{standard:report.standard.policiesEquivalent,capacity:report.capacity.policiesEquivalent}},null,2));
}
try{run();}catch(error){console.error('COMPARISON_NOT_WRITTEN '+(error.code==='ENOENT'?'INPUT_MISSING':error.code==='ERR_ASSERTION'?'INPUT_VALIDATION_FAILED':'INPUT_ERROR'));process.exitCode=1;}
