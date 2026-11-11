'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {ENDPOINT,LIMITS,formData}=require('../../../backend/src/fundingTenders/source');
const {COLLECTION_LIMITS}=require('../../../backend/src/fundingTenders/source11145');
const hash=value=>createHash('sha256').update(value).digest('hex');
function createLive11145Transport({outputDirectory,report}){
 let pendingHold=null;const observations=[];report.publicTransport=observations;
 async function fetchImpl(rawUrl,options){
  const url=new URL(rawUrl),base=new URL(ENDPOINT);assert.equal(url.origin+url.pathname,base.origin+base.pathname);
  assert.deepEqual([...url.searchParams.keys()].sort(),['apiKey','language','pageNumber','pageSize','text']);
  assert.equal(url.searchParams.get('apiKey'),'SEDIA');assert.equal(url.searchParams.get('language'),'en');assert.equal(url.searchParams.get('pageNumber'),'1');assert.equal(url.searchParams.get('pageSize'),String(COLLECTION_LIMITS.pageSize));assert.equal(url.searchParams.get('text'),'***');
  assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert(options.body instanceof FormData);
  const parts=async form=>{const out={};for(const [key,value]of form)out[key]=await value.text();return out;};
  assert.deepEqual(await parts(options.body),await parts(formData('EU_FUNDING_TENDERS','CASCADE:11145')));
  const headers=new Headers(options.headers);assert(!headers.has('authorization'));assert(!headers.has('cookie'));
  const response=await globalThis.fetch(rawUrl,options),clone=response.clone(),reader=clone.body?.getReader();assert(reader,'PUBLIC_RESPONSE_BODY_REQUIRED');
  const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMITS.bytes){reader.cancel().catch(()=>{});response.body?.cancel().catch(()=>{});throw Error('PUBLIC_RESPONSE_LIMIT_EXCEEDED');}chunks.push(Buffer.from(value));}}
  finally{reader.releaseLock();}
  const bytes=Buffer.concat(chunks),ordinal=observations.length+1,file='eu-11145-response-'+String(ordinal).padStart(2,'0')+'.json';
  fs.writeFileSync(path.join(outputDirectory,file),bytes,{flag:'wx'});
  const item={endpoint:ENDPOINT,externalIdentifier:'CASCADE:11145',capturedAt:new Date().toISOString(),status:response.status,bytes:size,sha256:hash(bytes),file,contentType:response.headers.get('content-type'),etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified'),queryDigest:hash(JSON.stringify(await parts(options.body)))};observations.push(item);
  if(pendingHold){const hold=pendingHold;pendingHold=null;hold.entered();await hold.promise;}
  return response;
 }
 return {fetchImpl,observations,holdNext(){assert.equal(pendingHold,null);let entered,release;const arrived=new Promise(resolve=>{entered=resolve;}),promise=new Promise(resolve=>{release=resolve;});pendingHold={entered,promise};return {arrived,release};}};
}
module.exports={createLive11145Transport};
