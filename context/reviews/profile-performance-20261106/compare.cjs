'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=(dir,file)=>JSON.parse(fs.readFileSync(path.join(root,dir,file),'utf8').replace(/^\uFEFF/,''));
const runs=['a1','b1','b2','a2'].map(name=>{
 const directory='profile-'+name+'-20261106';
 const result=read(directory,'results.json'),config=read(directory,'run-config.json'),sources=read(directory,'sources.json');
 assert.equal(result.status,'COMPLETE');assert.equal(result.integrity.unchanged,true);assert.equal(result.pages.length,12);
 assert(result.pages.every(p=>Number.isFinite(p.ms)&&!p.error&&(p.requests||[]).every(r=>r.status<400)));
 return {name,directory,result,config,sources};
});
for(const run of runs){
 assert.deepEqual(run.config.images,runs[0].config.images);
 assert.deepEqual(run.sources.filter(s=>!s.path.startsWith('.tmp/')),runs[0].sources.filter(s=>!s.path.startsWith('.tmp/')));
}
for(const [left,right] of [[0,3],[1,2]])assert.deepEqual(runs[left].sources,runs[right].sources);
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),n=sorted.length;return n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2};
const rows=[];
for(const mode of ['load','navigation'])for(const route of ['/dashboard','/perfil-organizacao','/candidaturas','/notificacoes']){
 const stats=variant=>{const values=runs.filter(r=>r.result.variant===variant).flatMap(r=>r.result.pages.filter(p=>p.mode===mode&&p.route===route).map(p=>p.ms));return {n:values.length,medianMs:median(values),minMs:Math.min(...values),maxMs:Math.max(...values),valuesMs:values}};
 const before=stats('A'),after=stats('B');
 const settled=variant=>median(runs.filter(r=>r.result.variant===variant).flatMap(r=>r.result.pages.filter(p=>p.mode===mode&&p.route===route).map(p=>p.settledMs)));
 rows.push({mode,route,before,after,reductionPercent:100*(1-after.medianMs/before.medianMs),...(mode==='load'?{settledMedianMs:{before:settled('A'),after:settled('B')}}:{})});
}
const security=read('profile-security-final-20261106','results.json');
assert.equal(security.status,'COMPLETE');assert.equal(security.integrity.unchanged,true);
for(const kind of ['browse','profile']){assert.equal(security.concurrent[kind].length,4);assert(security.concurrent[kind].every(r=>r.status===200&&(kind==='browse'?r.total===1000:r.complete)))}
assert.equal(security.profileAudit.equal,true);
const bundles=run=>run.sources.filter(s=>s.path.startsWith('.tmp/')).map(s=>({...s,path:s.path.replace(/combined-build-[AB]/,'combined-build')}));
assert.deepEqual(bundles(runs[0]),bundles(runs[1]));
const summary={runs:runs.map(r=>({name:r.name,directory:r.directory,variant:r.result.variant,startedAt:r.result.startedAt,finishedAt:r.result.finishedAt})),images:runs[0].config.images,totalPageMeasurements:48,rows,securityChecks:security.checks,concurrent:security.concurrent};
fs.writeFileSync(path.join(__dirname,'comparison.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(rows,null,2));
