'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=path.resolve(process.argv[2]||'context/reviews/dashboard-c1-stages/results.json');
const report=JSON.parse(fs.readFileSync(source,'utf8'));
const scenario=report.scenarios.find(s=>s.name==='dashboard-c1');
assert(scenario);assert.equal(scenario.errors,0);assert.equal(scenario.results.length,4);
const round=n=>Math.round(n*100)/100,mean=xs=>round(xs.reduce((a,b)=>a+b,0)/xs.length);
function union(events,max=Infinity){
 const spans=events.map(e=>[Math.max(0,e[0]),Math.min(max,e[1])]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
 let total=0,start=null,end=null;
 for(const[a,b]of spans){if(start===null){start=a;end=b;}else if(a<=end)end=Math.max(end,b);else{total+=end-start;start=a;end=b;}}
 return round(total+(start===null?0:end-start));
}
const expected=['report','privateSummary','centralSummary','dashboardContext'];
const rows=scenario.results.map(r=>{
 const t=r.metrics.stageTrace;assert(t?.captureEvents);assert(t.responseMs>0);
 const stages=t.spans.filter(s=>s.kind==='stage');assert.deepEqual(stages.map(s=>s.name),expected);
 assert(stages.every(s=>s.endMs!==null&&!s.failed));
 for(let i=1;i<stages.length;i++)assert(stages[i].startMs>=stages[i-1].endMs-0.02,'stage overlap');
 assert.equal(Object.values(t.stages).reduce((n,s)=>n+s.queries,0),r.metrics.queryCount);
 assert.equal(t.queryEvents.length,r.metrics.queryCount);
 assert.equal(Object.values(t.stages).reduce((n,s)=>n+s.authorityTransactions,0),r.metrics.authorityTransactions);
 const sqlSum=t.queryEvents.reduce((n,e)=>n+e[1]-e[0],0),sqlUnion=union(t.queryEvents,t.responseMs);
 return {httpMs:r.ms,responseMs:t.responseMs,sqlSumMs:round(sqlSum),sqlUnionMs:sqlUnion,overlapMs:round(sqlSum-sqlUnion),
  outsideQueryMs:round(t.responseMs-sqlUnion),metadataUnionMs:union(t.queryEvents.filter(e=>e[4]==='metadata'),t.responseMs),
  stages:[...expected,'request-outside-stages'].map(name=>{
   const s=t.stages[name],span=stages.find(s=>s.name===name),events=t.queryEvents.filter(e=>e[2]===name);
   assert(s);const wall=span?span.ms:t.responseMs-stages.reduce((n,s)=>n+s.ms,0);
   const checkpoints={};for(const c of t.spans.filter(c=>c.kind==='checkpoint'&&c.stage===name)){
    const target=checkpoints[c.name] ||= {calls:0,ms:0};target.calls++;target.ms+=c.ms;
   }
   return {name,wallMs:round(wall),queries:s.queries,authorityTransactions:s.authorityTransactions,
    authorityProtocolCalls:s.roles['authority/authority-protocol']?.calls||0,sqlSumMs:round(events.reduce((n,e)=>n+e[1]-e[0],0)),
    sqlUnionMs:union(events,t.responseMs),metadataSumMs:round(Object.entries(s.roles).filter(([k])=>k.endsWith('/metadata')).reduce((n,[,v])=>n+v.ms,0)),
    checkpoints,roles:s.roles};
  })};
});
const numeric=['httpMs','responseMs','sqlSumMs','sqlUnionMs','overlapMs','outsideQueryMs','metadataUnionMs'];
const output={source:path.relative(process.cwd(),source).replaceAll('\\','/'),status:report.status,samples:rows.length,
 verified:{stageOrder:true,noStageOverlap:true,queryCountsMatchOriginal:true,authorityTransactionCountsMatchOriginal:true,allQueryIntervalsPresent:true},
 means:Object.fromEntries(numeric.map(k=>[k,mean(rows.map(r=>r[k]))])),
 stages:[...expected,'request-outside-stages'].map(name=>{
  const data=rows.map(r=>r.stages.find(s=>s.name===name));
  const keys=[...new Set(data.flatMap(s=>Object.keys(s.checkpoints)))];
  return {name,wallMeanMs:mean(data.map(s=>s.wallMs)),queries:[...new Set(data.map(s=>s.queries))],authorityTransactions:[...new Set(data.map(s=>s.authorityTransactions))],authorityProtocolCalls:[...new Set(data.map(s=>s.authorityProtocolCalls))],
   sqlSumMeanMs:mean(data.map(s=>s.sqlSumMs)),sqlUnionMeanMs:mean(data.map(s=>s.sqlUnionMs)),metadataSumMeanMs:mean(data.map(s=>s.metadataSumMs)),
   checkpoints:Object.fromEntries(keys.map(k=>[k,{calls:[...new Set(data.map(s=>s.checkpoints[k]?.calls||0))],meanInclusiveMs:mean(data.map(s=>s.checkpoints[k]?.ms||0))}]))};
 }),individual:rows,limits:['Observer adds ALS/hash/Promise/timestamp overhead; no isolated estimate of that overhead.','SQL intervals measure driver calls, not PostgreSQL CPU time.','Nested checkpoint spans are inclusive and must not be added to parent spans.','Outside-query time is a residual, not exclusively JavaScript CPU or network time.','Warmup excluded; C1 has four samples.']};
fs.writeFileSync(path.join(path.dirname(source),'stages-summary.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({verified:output.verified,means:output.means,stages:output.stages},null,2));
