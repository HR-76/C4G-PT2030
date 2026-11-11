'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),https=require('node:https'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Readable}=require('node:stream');
const express=require('../../../backend/node_modules/express');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const {startBrowserEgressBlocker}=require('./browser-budget');
const {createApplicationSliceRouter}=require('../../../backend/src/routes/applicationSliceRoutes');
const {createApplicationDocumentTransport}=require('../../../backend/src/documents/applicationTransport');
const {createDownloadStaging}=require('../../../backend/src/documents/downloadStaging');
test('Chrome uses product navigation to receive only the fully verified same-origin attachment',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'c4g-download-browser-')),stage=createDownloadStaging({directory});
 const bytes=Buffer.from('synthetic browser document'),sha=crypto.createHash('sha256').update(bytes).digest('hex');let release,reading,ended=false;
 const begun=new Promise(r=>reading=r),wait=new Promise(r=>release=r);
 const row={state:'AVAILABLE',scan_state:'CLEAN',confirmed_at:new Date(),object_id:'object',observed_size:bytes.length,sha256:sha,display_filename:'synthetic.pdf'};
 const transport=createApplicationDocumentTransport({accessPort:{},repositoryFactory:()=>({findVersion:async()=>row}),storageFactory:()=>({head:async()=>({size:bytes.length,etag:'opaque'}),readRange:async({etag})=>{assert.equal(etag,'opaque');return Readable.from((async function*(){reading();await wait;yield bytes;ended=true})())}}),auditFactory:()=>({accept:async()=>{}}),reconciliationFactory:()=>({}),jobs:{},clock:()=>new Date(),downloadStaging:stage});
 const app=express(),next=(req,res,n)=>n(),uuid='11111111-1111-4111-8111-111111111111';
 app.get('/',(req,res)=>res.type('html').send(`<button id="download">Download</button><script type="module">import {navigateDocumentDownload} from '/navigation.js';document.querySelector('button').onclick=()=>navigateDocumentDownload('/api/applications/${uuid}/documents/versions/${uuid}/download',()=>{document.body.dataset.error='true'})</script>`));
 app.get('/navigation.js',(req,res)=>res.type('js').send(fs.readFileSync('frontend/src/api/documentNavigation.js','utf8')));
 app.use('/api/applications',createApplicationSliceRouter({express,authenticate:next,organizationMiddleware:{requireServerSession:next,resolveOrganizationContext:next,requireOrganizationContext:next},service:{execute:async()=>({organizationId:'A',versionId:uuid})},documentAccessPort:transport}));
 const server=https.createServer({cert:fs.readFileSync('.tmp/f2-integration/localhost.crt'),key:fs.readFileSync('.tmp/f2-integration/localhost.key')},app);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const blocker=await startBrowserEgressBlocker();let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true,proxy:blocker.proxy});const page=await browser.newPage();let successResponses=0;
  page.on('response',r=>{if(r.url().endsWith('/download')&&r.status()===200)successResponses++});
  await page.goto(`https://localhost:${server.address().port}`);const received=page.waitForEvent('download');await page.click('#download');await begun;
  assert.equal(successResponses,0);assert.equal(ended,false);release();const download=await received;assert.equal(await download.failure(),null);
  const content=fs.readFileSync(await download.path());assert.equal(crypto.createHash('sha256').update(content).digest('hex'),sha);assert.equal(content.length,bytes.length);assert(ended);
  // Chrome background requests may be attempted; the proxy refuses every external CONNECT.
  assert.equal(new URL(download.url()).origin,`https://localhost:${server.address().port}`);
 }finally{release();await browser?.close();await blocker.close();server.closeAllConnections();await new Promise(r=>server.close(r));stage.close();fs.rmSync(directory,{recursive:true,force:true});}
});
