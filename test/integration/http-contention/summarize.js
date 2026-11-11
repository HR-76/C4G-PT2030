'use strict';
const fs=require('node:fs'),path=require('node:path');
const source=path.resolve(process.argv[2]||'context/reviews/authority-contention/results.json');
const report=JSON.parse(fs.readFileSync(source,'utf8'));
const round=n=>Math.round(n*100)/100,mean=xs=>xs.length?round(xs.reduce((a,b)=>a+b,0)/xs.length):null,max=xs=>xs.length?round(Math.max(...xs)):null;
const queryTime=(r,pattern)=>Object.entries(r.metrics?.queries||{}).filter(([key])=>pattern.test(key)).reduce((n,[,v])=>n+v.ms,0);
const scenarios=report.scenarios.map(s=>{
 const frames=report.instrumentation.samples.filter(f=>f.phase===s.name),checkouts=s.results.flatMap(r=>r.metrics?.checkouts||[]);
 const admissions=s.results.flatMap(r=>r.metrics?.admissions||[]);
 const auditBlocked=frames.filter(f=>f.sessions.some(x=>x.query==='audit-prepare'&&x.waitType==='Lock'&&x.blockers.length));
 const centralBlocked=frames.filter(f=>f.sessions.some(x=>x.query==='authority-lock'&&x.waitType==='Lock'&&x.blockers.length));
 const examples=[];
 for(const f of frames){for(const row of f.sessions){if(row.query!=='audit-prepare'||row.waitType!=='Lock'||!row.blockers.length)continue;
  if(examples.length<3)examples.push({waiter:{role:row.role,wait:row.wait,request:row.request},blockers:row.blockers.map(pid=>{
   const b=f.sessions.find(x=>x.pid===pid);return b?{role:b.role,state:b.state,wait:b.wait,query:b.query,request:b.request}:null;
  })});}}
 return {name:s.name,samples:s.samples,successes:s.successes,errors:s.errors,p50Ms:s.p50Ms,p95Ms:s.p95Ms,
  successThroughputPerSecond:round(s.successes/(s.elapsedMs/1000)),drainMs:s.drainMs,
  authorityTransactions:s.results.map(r=>r.metrics?.authorityTransactions),
  queryCount:s.results.map(r=>r.metrics?.queryCount),
  meanMetadataMs:mean(s.results.map(r=>queryTime(r,/\/metadata$/))),meanApplicationSelectionMs:mean(s.results.map(r=>queryTime(r,/application-selection$/))),
  meanAuditPrepareMs:mean(s.results.map(r=>queryTime(r,/audit-prepare$/))),meanCentralLockCallMs:mean(s.results.map(r=>queryTime(r,/authority-lock$/))),
  physicalCheckouts:Object.fromEntries(['authority','tenant'].map(group=>{const xs=checkouts.filter(c=>c.role?.startsWith(group));return[group,{count:xs.length,maxWaitMs:max(xs.map(x=>x.waitMs)),maxHeldMs:max(xs.map(x=>x.holdMs).filter(x=>x!==null)),maxWaitingAtEntry:max(xs.map(x=>x.waiting)),maxPoolTotalAtEntry:max(xs.map(x=>x.total))}];})),
  logicalAdmissions:{count:admissions.length,maxWaitMs:max(admissions.map(a=>a.ms)),errors:admissions.filter(a=>a.error)},
  sampledFrames:frames.length,maxActive:max(frames.flatMap(f=>f.managers.map(m=>m.active))),maxQueued:max(frames.flatMap(f=>f.managers.map(m=>m.queued))),
  framesQueued:frames.filter(f=>f.managers.some(m=>m.queued>0)).length,auditBlockedFrames:auditBlocked.length,centralBlockedFrames:centralBlocked.length,
  auditWaitEvents:[...new Set(auditBlocked.flatMap(f=>f.sessions.filter(r=>r.query==='audit-prepare'&&r.waitType==='Lock').map(r=>r.wait)))],blockerExamples:examples,
  afterResponseQueryCompletions:s.results.reduce((sum,r)=>sum+Object.values(r.metrics?.afterResponseQueries||{}).reduce((n,v)=>n+v.calls,0),0),
  failedRequests:s.results.filter(r=>r.status!==200).map(r=>({status:r.status,code:r.code,ms:r.ms,failures:r.metrics?.failures,sqlErrors:r.metrics?.sqlErrors,
   auditPrepareMs:round(queryTime(r,/audit-prepare$/)),applicationSelectionMs:round(queryTime(r,/application-selection$/)),admissions:r.metrics?.admissions,
   tenantCheckouts:r.metrics?.checkouts.filter(c=>c.role?.startsWith('tenant'))}))};
});
const summary={status:report.status,startedAt:report.startedAt,finishedAt:report.finishedAt,sampleCount:report.instrumentation.samples.length,
 sampleQueryMeanMs:mean(report.instrumentation.samples.map(s=>s.sampleMs)),sampleQueryMaxMs:max(report.instrumentation.samples.map(s=>s.sampleMs)),
 policies:report.instrumentation.policies,scenarios};
fs.writeFileSync(path.join(path.dirname(source),'summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(scenarios.map(({name,errors,maxActive,maxQueued,auditBlockedFrames,centralBlockedFrames,sampledFrames,meanMetadataMs,meanAuditPrepareMs,physicalCheckouts})=>
 ({name,errors,maxActive,maxQueued,auditBlockedFrames,centralBlockedFrames,sampledFrames,meanMetadataMs,meanAuditPrepareMs,physicalCheckouts})),null,2));
