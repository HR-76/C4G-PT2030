'use strict';
const os=require('node:os'),fs=require('node:fs');
const totals=()=>os.cpus().reduce((a,c)=>{a.idle+=c.times.idle;a.total+=Object.values(c.times).reduce((x,y)=>x+y,0);return a;},{idle:0,total:0});
(async()=>{
 const samples=[];let before=totals();
 for(let i=0;i<3;i++){
  await new Promise(r=>setTimeout(r,1000));const after=totals();
  samples.push({cpuPercent:100*(1-(after.idle-before.idle)/(after.total-before.total)),freeBytes:os.freemem()});before=after;
 }
 const result={at:new Date().toISOString(),logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem(),samples,
  pass:samples.every(s=>s.cpuPercent<=25&&s.freeBytes>=4*1024**3)};
 fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({hostIdle:result.pass,maxCpuPercent:Math.max(...samples.map(s=>s.cpuPercent))}));
 if(!result.pass)process.exitCode=2;
})().catch(()=>{console.error('HOST_CHECK_FAILED');process.exitCode=1;});
