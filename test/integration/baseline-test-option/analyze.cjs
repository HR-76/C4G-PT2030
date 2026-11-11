'use strict';
// Offline aggregation of existing isolated browse-browser reports only.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const DAY=24*60*60*1000,WINDOW=30*DAY;
function analyze(entries,{startMs,nowMs}){
 if(!Number.isFinite(startMs)||!Number.isFinite(nowMs))throw TypeError('Explicit valid start and clock required');
 const days=Array.from({length:30},()=>({runs:0,successfulRuns:0,failedRuns:0,loads:[]}));
 const hashes=new Set(),ids=new Set();let outside=0;
 for(const entry of entries){
  if(entry.id){if(ids.has(entry.id))throw TypeError('Duplicate report');ids.add(entry.id);}
  const report=entry.report,at=Date.parse(report?.startedAt);
  if(!Number.isFinite(at))throw TypeError('Report start missing');
  if(at<startMs||at>=startMs+WINDOW){outside++;continue;}
  const day=days[Math.floor((at-startMs)/DAY)];day.runs++;
  if(!/^[a-f0-9]{64}$/.test(entry.sourceHash||''))throw TypeError('Source hash missing');hashes.add(entry.sourceHash);
  const loads=(report.pages||[]).filter(p=>p.route==='/candidaturas'&&p.mode==='load');
  const valid=entry.cleanup==='PASS'&&entry.variant==='B'&&report.status==='COMPLETE'&&report.integrity?.unchanged===true&&!report.cleanupError&&loads.length===3&&loads.every(p=>Number.isFinite(p.ms)&&p.ms>=0&&!p.error&&Array.isArray(p.requests)&&p.requests.some(r=>/^\/api\/applications\/browse(?:-page)?$/.test(r.path)&&r.status===200)&&p.requests.every(r=>Number.isInteger(r.status)&&r.status<400));
  if(!valid){day.failedRuns++;continue;}
  day.successfulRuns++;day.loads.push(...loads.map(p=>p.ms));
 }
 const all=days.flatMap(d=>d.loads).sort((a,b)=>a-b),covered=days.filter(d=>d.runs>0).length,success=days.reduce((n,d)=>n+d.successfulRuns,0),failed=days.reduce((n,d)=>n+d.failedRuns,0);
 const closed=nowMs>=startMs+WINDOW,complete=closed&&covered===30&&failed===0&&hashes.size===1&&days.every(d=>d.successfulRuns>=1);
 return {status:complete?'COMPLETE':'INSUFFICIENT_EVIDENCE',window:{start:new Date(startMs).toISOString(),end:new Date(startMs+WINDOW).toISOString(),closed},coverage:{daysWithRuns:covered,expectedDays:30,successfulRuns:success,failedRuns:failed,outsideWindow:outside,sourceVersions:hashes.size},opening:{samples:all.length,p95Ms:complete&&all.length>=90?all[Math.ceil(.95*all.length)-1]:null},days:days.map((d,index)=>({day:index+1,runs:d.runs,successfulRuns:d.successfulRuns,failedRuns:d.failedRuns,samples:d.loads.length})),limitations:['Only synthetic isolated browser-opening measurements; no production availability, API SLO, security, accessibility or recovery claims.','One run per day is a sampling policy, not continuous availability monitoring.','Unknown or missed days remain uncovered.']};
}
function main(args){
 if(args.length<2)throw TypeError('Usage: node analyze.cjs <ISO-start> <report-directory>...');
 const startMs=Date.parse(args[0]);if(!Number.isFinite(startMs))throw TypeError('Invalid start');
 const read=(dir,name)=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8').replace(/^\uFEFF/,''));
 const entries=args.slice(1).map(dir=>{const config=read(dir,'run-config.json'),cleanup=read(dir,'cleanup.json');if(!Array.isArray(config.images)||config.images.length!==2||!config.wrapperHash)throw TypeError('Invalid run configuration');return {id:fs.realpathSync(dir),report:read(dir,'results.json'),variant:config.variant,cleanup:cleanup.status,sourceHash:createHash('sha256').update(fs.readFileSync(path.join(dir,'sources.json'))).update(JSON.stringify({variant:config.variant,images:config.images,wrapperHash:config.wrapperHash})).digest('hex')};});
 process.stdout.write(JSON.stringify(analyze(entries,{startMs,nowMs:Date.now()}),null,2)+'\n');
}
if(require.main===module){try{main(process.argv.slice(2))}catch(error){process.stderr.write('BASELINE_ANALYSIS_INVALID: '+error.message+'\n');process.exitCode=1;}}
module.exports={analyze};
