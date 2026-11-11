'use strict';
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const esbuild=require('../../../frontend/node_modules/esbuild'),{chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const root=path.resolve(__dirname,'../../..'),work=path.join(root,'frontend/src/pages/Applications/ApplicationWork.jsx'),gate=path.join(root,'frontend/src/pages/Opportunities/CatalogExposureGate.jsx');
const sources=new Map([[work,fs.readFileSync(work,'utf8')],[gate,fs.readFileSync(gate,'utf8')]]);
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function replaceOnce(input,old,value){assert.equal(input.split(old).length,2,'EXPECTED_SOURCE_NOT_FOUND');return input.replace(old,value)}
function before(file,text){
 text=text.replace(/\r\n/g,'\n');
 if(file===gate){text=replaceOnce(text,'        const confirmedRevision = revision\n','');text=replaceOnce(text,'        setState(previous => previous.available && previous.revision === confirmedRevision && !previous.checking && previous.scope === scope\n          ? previous : { available: true, revision: confirmedRevision, checking: false, scope })','        setState({ available: true, revision, checking: false, scope })');}
 if(file===work){
  text=replaceOnce(text,"import { useEffect, useMemo, useRef, useState } from 'react'","import { useEffect, useRef, useState } from 'react'");
  text=text.replace(/^  const responsibleNames=useMemo\(.*\n/m,'').replace(/^  const openTaskCounts=useMemo\(.*\n/m,'');assert(!text.includes('const responsibleNames='));assert(!text.includes('const openTaskCounts='));
  text=replaceOnce(text,'responsibleNames.get(id)', 'responsibles.find(r=>r.membershipId===id)?.name');
  text=replaceOnce(text,'openTaskCounts.get(p.membershipId)||0',"openTasks.filter(t=>t.responsibleMembershipId===p.membershipId).length");
 }
 return text;
}
async function build(variant){
 const plugins=[{name:'isolated-ports-and-baseline',setup(build){
  build.onResolve({filter:/^\.\.\/\.\.\/api\/api$/},()=>({path:'synthetic-api',namespace:'synthetic'}));
  build.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:"export const catalogReadApi=async()=>{throw Error('UNEXPECTED_NETWORK')};export const privateApplicationsApi={work:async()=>({data:window.syntheticWork}),workHistory:async()=>({data:{items:[],nextCursor:null}})}",loader:'js'}));
  build.onLoad({filter:/(ApplicationWork|CatalogExposureGate)\.jsx$/},args=>({contents:variant==='before'?before(args.path,sources.get(args.path)):sources.get(args.path),loader:'jsx',resolveDir:path.dirname(args.path)}));
 }}];
 const result=await esbuild.build({entryPoints:[path.join(__dirname,'remaining-entry.jsx')],bundle:true,write:false,jsx:'automatic',loader:{'.css':'empty'},nodePaths:[path.join(root,'frontend/node_modules')],define:{'process.env.NODE_ENV':'"development"'},plugins});return result.outputFiles[0].contents;
}
(async()=>{
 const bundles={before:await build('before'),after:await build('after')};
 const server=http.createServer((req,res)=>{if(req.url==='/before.js'||req.url==='/after.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundles[req.url.slice(1,-3)])}res.setHeader('Content-Type','text/html');res.end(`<div id="root"></div><script src="/${req.url==='/before'?'before':'after'}.js"></script>`)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;const runs=[];
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  for(const variant of ['before','after','after','before']){
   const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/${variant}`);
   await page.getByText('Conteúdo autorizado sintético').waitFor();await page.getByText('Tarefa 499').waitFor();
   await page.waitForFunction(()=>window.measure.polls>=5);const gateResult=await page.evaluate(()=>({polls:window.measure.polls,commits:window.measure.gateCommits.length}));
   await page.evaluate(()=>{window.measure.workCommits=[]});
   for(let i=0;i<6;i++){await page.locator('#bump').click();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))}
   const result=await page.evaluate(()=>({work:window.measure.workCommits,counts:[...document.querySelectorAll('.work-participants li')].map(e=>e.textContent.match(/Tarefas abertas: (\d+)/)?.[1]),actions:document.querySelectorAll('.work-participants button').length}));
   runs.push({variant,gate:gateResult,workUpdates:result.work.length,workDurations:result.work.map(x=>x.duration),participants:result.counts.length,openTotal:result.counts.reduce((a,b)=>a+Number(b),0),editButtons:result.actions});await page.close();
  }
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
 for(const [file,original] of sources)assert.equal(digest(fs.readFileSync(file)),digest(original),'SOURCE_CHANGED_DURING_MEASUREMENT');
 assert(runs.every(x=>x.participants===500&&x.openTotal===333&&x.editButtons===0));
 const out=path.join(root,'context/reviews/remaining-render-isolated-20261110-v2');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({method:'isolated browser A/B/B/A, synthetic ports and accelerated availability polling',sourceHashes:Object.fromEntries([...sources].map(([f,v])=>[path.relative(root,f),digest(v)])),runs},null,2)+'\n');
 console.log(JSON.stringify(runs));
})().catch(e=>{console.error(e.name,e.message);process.exitCode=1});
