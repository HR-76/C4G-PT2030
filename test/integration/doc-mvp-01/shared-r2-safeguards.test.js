'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const sdk=require('../../../backend/node_modules/@aws-sdk/client-s3');
const {startCoordinator,createBudgetClient,KEYS}=require('./shared-r2-budget');
const {createSharedSafeguards}=require('./shared-r2-safeguards');
const {instrumentBudgetClient}=require('./shared-budget-transport');
const {Readable}=require('node:stream');
test('real AWS SDK signs with fake credentials and reaches only the reserved fake handler once',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'c4g-sdk-budget-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const zero=Object.fromEntries(KEYS.map(k=>[k,0])),tokens={functional:crypto.randomUUID(),cleanup:crypto.randomUUID()};
 const coordinator=await startCoordinator({journalPath:path.join(root,'synthetic.jsonl'),port:0,tokens,baseline:zero,limits:{...zero,functionalRequests:2,applicationBytes:5},source:'SYNTHETIC_SDK'});t.after(()=>coordinator.close());
 let physical=0;
 const credentials=Object.freeze({accessKeyId:'synthetic-access-key',secretAccessKey:'synthetic-secret-key'});
 const raw=new sdk.S3Client({region:'auto',endpoint:'https://synthetic.invalid',forcePathStyle:true,credentials:{...credentials},maxAttempts:1,followRegionRedirects:false,
  requestHandler:{async handle(request){physical++;assert(request.headers.authorization);assert.equal(coordinator.snapshot().budget.functionalRequests,physical);
   if(physical===2)throw new Error('SYNTHETIC_TRANSPORT_LOSS');return{response:{statusCode:200,headers:{},body:Readable.from([])}};},destroy(){}}});t.after(()=>raw.destroy());
 const client=instrumentBudgetClient(raw,createBudgetClient({port:coordinator.port,token:tokens.functional}));
 await client.send(new sdk.HeadBucketCommand({Bucket:'synthetic-documents'}));
 await assert.rejects(client.send(new sdk.GetObjectCommand({Bucket:'synthetic-documents',Key:'synthetic',Range:'bytes=0-4'})),/SYNTHETIC_TRANSPORT_LOSS/);
 await assert.rejects(client.send(new sdk.HeadBucketCommand({Bucket:'synthetic-documents'})),/BUDGET_EXHAUSTED/);
 assert.equal(physical,2);assert(Object.isFrozen(credentials));
 const text=fs.readFileSync(path.join(root,'synthetic.jsonl'),'utf8');assert(!text.includes(credentials.secretAccessKey));assert(!text.includes('authorization'));
});
test('API, worker SDK, signed download, inventory and provenance cleanup debit one durable writer',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'c4g-shared-sdk-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const zero=Object.fromEntries(KEYS.map(k=>[k,0])),tokens={functional:crypto.randomUUID(),cleanup:crypto.randomUUID()},proofTag=crypto.randomUUID();
 const coordinator=await startCoordinator({journalPath:path.join(root,'synthetic.jsonl'),port:0,tokens,baseline:zero,limits:{...zero,functionalRequests:20,cleanupRequests:5,applicationBytes:100,objectIntentions:1,completedObjects:1},source:'SYNTHETIC_TRANSPORT'});t.after(()=>coordinator.close());
 const objects=new Map();let physical=0;
 const raw=()=>({config:{maxAttempts:async()=>1},async send(command){physical++;const i=command.input;
  if(command instanceof sdk.PutObjectCommand){assert.equal(i.IfNoneMatch,'*');objects.set(i.Key,{Metadata:i.Metadata,ContentLength:i.ContentLength});return{};}
  if(command instanceof sdk.HeadObjectCommand){if(!objects.has(i.Key))throw Object.assign(new Error('missing'),{name:'NotFound'});return objects.get(i.Key);}
  if(command instanceof sdk.DeleteObjectCommand){objects.delete(i.Key);return{};}return{};
 }});
 const safeguards=createSharedSafeguards({coordinator,tokens,proofTag,buckets:['synthetic-documents','synthetic-quarantine'],origin:'https://synthetic.invalid',parentBudget:zero});
 const api=safeguards.instrumentClient(raw()),worker=instrumentBudgetClient(raw(),createBudgetClient({port:coordinator.port,token:tokens.functional}));
 const objectId=crypto.randomUUID(),Key=`${proofTag}/${objectId}`,Bucket='synthetic-quarantine';
 await safeguards.registerObjectIntent({Bucket,Key,sha256:'a'.repeat(64),size:5});
 await api.send(new sdk.ListObjectsV2Command({Bucket,Prefix:`${proofTag}/`}));
 await api.send(new sdk.PutObjectCommand({Bucket,Key,ContentLength:5,Metadata:{sha256:'a'.repeat(64)},IfNoneMatch:'*'}));
 await worker.send(new sdk.HeadBucketCommand({Bucket}));await worker.send(new sdk.GetObjectCommand({Bucket,Key,Range:'bytes=0-4'}));
 await safeguards.controlledFetch(async(url,init)=>{physical++;assert.equal(init.redirect,'error');return{status:200};},'https://synthetic.invalid/signed-but-never-logged',{}, {expectedBytes:5});
 const unknownKey=`${proofTag}/${crypto.randomUUID()}`;objects.set(unknownKey,{Metadata:{c4gproof:proofTag},ContentLength:5});
 const original=objects.get(Key);objects.set(Key,{...original,Metadata:{...original.Metadata,c4gintent:crypto.randomUUID()}});
 assert.equal((await safeguards.cleanupKnownResources(api,sdk)).status,'PARTIAL');assert(objects.has(Key));
 objects.set(Key,original);
 assert.equal((await safeguards.cleanupKnownResources(api,sdk)).status,'COMPLETE');
 assert.equal(physical,9);assert.equal(coordinator.snapshot().budget.functionalRequests,5);assert.equal(coordinator.snapshot().budget.cleanupRequests,4);
 assert.equal(coordinator.snapshot().budget.applicationBytes,15);assert.equal(objects.size,1);assert(objects.has(unknownKey));
 const log=fs.readFileSync(path.join(root,'synthetic.jsonl'),'utf8');assert(!log.includes('signed-but-never-logged'));assert(!log.includes(tokens.functional));
});
