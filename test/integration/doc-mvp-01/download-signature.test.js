'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),https=require('node:https'),fs=require('node:fs'),crypto=require('node:crypto');
const {S3Client}=require('../../../backend/node_modules/@aws-sdk/client-s3');
const {createR2Storage}=require('../../../backend/src/documents/r2Storage');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
const {readDownload}=require('./download-response');
const {startBrowserEgressBlocker}=require('./browser-budget');
test('actual SDK presign requires If-Match; native303 cannot supply it',async()=>{
 const body=Buffer.from('synthetic exact authorized version'),sha=crypto.createHash('sha256').update(body).digest('hex'),etag='"synthetic-etag-a"';
 const tls={cert:fs.readFileSync('.tmp/f2-integration/localhost.crt'),key:fs.readFileSync('.tmp/f2-integration/localhost.key')};let issued,currentEtag=etag;const observations=[];
 // Controlled verifier: enforces exact issued signature and its required signed
 // header. It is deliberately not described as an implementation of R2/SigV4.
 const destination=https.createServer(tls,(req,res)=>{if(req.url==='/favicon.ico'){res.writeHead(404);res.end();return;}const parsed=new URL(req.url,'https://localhost'),signature=parsed.searchParams.get('X-Amz-Signature');
  const headerPresent=req.headers['if-match']===etag;const code=signature!==issued.signature||!headerPresent?'SignatureDoesNotMatch':currentEtag!==etag?'PreconditionFailed':null;
  observations.push({headerPresent,status:code==='SignatureDoesNotMatch'?403:code?412:200,code});
  if(code){res.writeHead(code==='SignatureDoesNotMatch'?403:412,{'Content-Type':'application/xml'});res.end(`<Error><Code>${code}</Code><Message>Controlled rejection</Message></Error>`);return;}
  res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':body.length,'Content-Disposition':'attachment; filename="synthetic.bin"'});res.end(body);
 });await new Promise(r=>destination.listen(0,'127.0.0.1',r));
 const client=new S3Client({endpoint:`https://localhost:${destination.address().port}`,region:'auto',forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:'LOCAL_SYNTHETIC_KEY',secretAccessKey:'LOCAL_SYNTHETIC_SECRET'},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
 client.send=async command=>{assert.equal(command.constructor.name,'HeadObjectCommand');return{ContentLength:body.length,Metadata:{sha256:sha},ContentType:'application/octet-stream',ETag:etag};};
 const storage=createR2Storage({enabled:true,jurisdiction:'eu',endpoint:'https://synthetic.eu.r2.cloudflarestorage.com',documentsBucket:'synthetic-documents',quarantineBucket:'synthetic-quarantine',bucketAccess:'PRIVATE',capabilities:{layerCValidated:true}},
 {organizationId:'00000000-0000-4000-8000-000000000001',credentials:{accessKeyId:'LOCAL_SYNTHETIC_KEY',secretAccessKey:'LOCAL_SYNTHETIC_SECRET'},client});
 const capability=await storage.createDownloadCapability({objectId:'00000000-0000-4000-8000-000000000002',expiresAt:new Date(Date.now()+300000).toISOString()});
 const parsed=new URL(capability.url);issued={signature:parsed.searchParams.get('X-Amz-Signature')};const signedHeaders=parsed.searchParams.get('X-Amz-SignedHeaders').split(';');assert(signedHeaders.includes('if-match'));assert.equal(capability.headers['If-Match'],etag);
 const api=https.createServer(tls,(req,res)=>{if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<a id="download" href="/download" referrerpolicy="no-referrer">Download</a>');return;}if(req.url!=='/download'){res.writeHead(404);res.end();return;}res.writeHead(303,{Location:capability.url,'Referrer-Policy':'no-referrer','Cache-Control':'no-store'});res.end();});
 await new Promise(r=>api.listen(0,'127.0.0.1',r));const blocker=await startBrowserEgressBlocker(),browser=await chromium.launch({channel:'chrome',headless:true,proxy:blocker.proxy});
 try{
  const good=await readDownload(capability.url,{expectedBytes:body.length,expectedSha256:sha,headers:capability.headers});assert.deepEqual(good.body,body);
  const page=await browser.newPage();await page.goto(`https://localhost:${api.address().port}`);const response=page.waitForResponse(r=>r.url().startsWith(`https://localhost:${destination.address().port}`));await page.click('#download');assert.equal((await response).status(),403);assert.equal(observations.at(-1).headerPresent,false);
  await assert.rejects(readDownload(capability.url,{expectedBytes:body.length,expectedSha256:sha}),e=>e.diagnostic.provider.code==='SignatureDoesNotMatch');
  currentEtag='"synthetic-etag-b"';await assert.rejects(readDownload(capability.url,{expectedBytes:body.length,expectedSha256:sha,headers:capability.headers}),e=>e.diagnostic.status===412&&e.diagnostic.provider.code==='PreconditionFailed');
  assert.deepEqual(observations.map(x=>x.status),[200,403,403,412]);
  console.log(JSON.stringify({proof:'LOCAL_CONTROLLED_SIGNATURE_HEADER_CONTRACT',signedHeaders,observations,bodySha256:sha,nativeNavigationAddsIfMatch:false}));
 }finally{await browser.close();await blocker.close();client.destroy();await storage.shutdown();api.closeAllConnections();destination.closeAllConnections();await new Promise(r=>api.close(r));await new Promise(r=>destination.close(r));}
});
