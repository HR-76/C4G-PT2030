'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),https=require('node:https'),crypto=require('node:crypto');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const {startCoordinator,createBudgetClient,KEYS}=require('./shared-r2-budget');
const {installBrowserBudget,startBrowserEgressBlocker}=require('./browser-budget');
test('real HTTPS browser navigation and redirected requests share atomic reservations',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'doc-browser-budget-')),body=Buffer.from('synthetic download integrity\n');
 const tls={cert:fs.readFileSync('.tmp/f2-integration/localhost.crt'),key:fs.readFileSync('.tmp/f2-integration/localhost.key')};
 let mode='valid',sent=0,receivedBeforeReserve=false,coordinator,origin;
 const target=https.createServer(tls,(req,res)=>{sent++;if(coordinator.snapshot().budget.functionalRequests<sent)receivedBeforeReserve=true;
  if(mode==='redirect'){res.writeHead(302,{Location:'https://127.0.0.1:1/forbidden'});res.end();return;}
  if(mode==='failure'){res.writeHead(503);res.end('unavailable');return;}
  res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="synthetic.txt"','Content-Length':body.length});
  if(mode==='interrupted'){res.write(body.subarray(0,2));setTimeout(()=>res.destroy(),20);}else res.end(body);
 });
 const api=https.createServer(tls,(req,res)=>{
  if(req.url==='/helper.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync('frontend/src/api/documentNavigation.js'));return;}
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<button id="go">Download</button><script type="module">import {navigateDocumentDownload} from "/helper.js";window.errors=[];document.querySelector("button").onclick=()=>navigateDocumentDownload("/api/applications/00000000-0000-4000-8000-000000000001/documents/versions/00000000-0000-4000-8000-000000000002/download",e=>window.errors.push(e.response.status));</script>');return;}
  if(!req.url.startsWith('/api/applications/')){res.writeHead(404);res.end();return;}
  if(mode==='denied'){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'NOT_AUTHORIZED'}}));return;}
  res.writeHead(303,{Location:origin+'/object','Referrer-Policy':'no-referrer','Cache-Control':'no-store'});res.end();
 });
 await new Promise(r=>target.listen(0,'127.0.0.1',r));origin=`https://localhost:${target.address().port}`;
 await new Promise(r=>api.listen(0,'127.0.0.1',r));const apiOrigin=`https://localhost:${api.address().port}`;
 const baseline=Object.fromEntries(KEYS.map(k=>[k,0])),tokens={functional:'local-functional-test',cleanup:'local-cleanup-test'};
 coordinator=await startCoordinator({journalPath:path.join(dir,'synthetic.jsonl'),port:0,tokens,baseline,limits:{...baseline,functionalRequests:5,cleanupRequests:2,applicationBytes:body.length*5},source:'SYNTHETIC'});
 const blocker=await startBrowserEgressBlocker();
 const browser=await chromium.launch({channel:'chrome',headless:true,proxy:blocker.proxy}),context=await browser.newContext({acceptDownloads:true}),page=await context.newPage(),events=[];
 const guard=await installBrowserBudget({context,page,budget:createBudgetClient({port:coordinator.port,token:tokens.functional}),localOrigins:[apiOrigin],remoteOrigin:origin,allowedPath:p=>p==='/object',expectedBytes:body.length,expectedSha256:crypto.createHash('sha256').update(body).digest('hex'),record:e=>events.push(e)});
 try{
  await page.goto(apiOrigin);
  await t.test('303 attachment downloads without CORS and preserves digest',async()=>{const wait=page.waitForEvent('download');await page.click('#go');const download=await wait;const file=path.join(dir,'download');await download.saveAs(file);assert.deepEqual(fs.readFileSync(file),body);assert.equal(await download.failure(),null);assert.equal(sent,1);});
  await t.test('authorization error remains local and creates no reservation',async()=>{mode='denied';await page.click('#go');await page.waitForFunction(()=>window.errors.includes(403));assert.equal(sent,1);});
  await t.test('extra user request is separately reserved',async()=>{mode='valid';const wait=page.waitForEvent('download');await page.click('#go');const d=await wait;await d.saveAs(path.join(dir,'second'));assert.equal(sent,2);});
  await t.test('destination failure is not success',async()=>{mode='failure';await page.click('#go');await page.waitForFunction(()=>window.errors.includes(503));assert.equal(sent,3);});
  await t.test('unexpected redirect is blocked before destination',async()=>{mode='redirect';await page.click('#go');await new Promise(r=>setTimeout(r,300));assert(events.some(e=>e.kind==='BROWSER_BLOCKED'));assert.equal(sent,4);});
  await t.test('interrupted download is not accepted as complete',async()=>{mode='interrupted';let completed=false;page.once('download',()=>{completed=true});await page.click('#go');await new Promise(r=>setTimeout(r,300));assert.equal(completed,false);assert.equal(sent,5);});
  await t.test('exhausted budget blocks before network and conserves uncertainty',async()=>{mode='valid';await page.click('#go');await new Promise(r=>setTimeout(r,300));assert.equal(sent,5);assert.equal(coordinator.snapshot().budget.functionalRequests,5);assert(events.some(e=>e.code==='BUDGET_EXHAUSTED'));});
  assert.equal(receivedBeforeReserve,false);assert(!JSON.stringify(events).includes(origin));assert(!JSON.stringify(events).includes('Location'));
  await t.test('browser egress outside interception cannot bypass the budget',async()=>{const p=await context.newPage();await p.goto('https://blocked.invalid').catch(()=>{});assert(blocker.blocked()>0);await p.close();assert.equal(sent,5);});
 }finally{await guard.close();await browser.close();await blocker.close();await coordinator.close();await new Promise(r=>api.close(r));await new Promise(r=>target.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
