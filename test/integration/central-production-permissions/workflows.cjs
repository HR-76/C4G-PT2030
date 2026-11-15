'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
async function run({pool,caps,ids,sessions,check}) {
 const repository=require('../../../backend/src/fundingTenders/repository').createFundingRepository({pool:caps.authoring});
 const manual=require('../../../backend/src/fundingTenders/manualAuthoring').createCentralManualAuthoring({pool:caps.authoring,repository});
 const input={requestId:randomUUID(),fields:{title:'Production permission gate',funderName:'Synthetic funder',summary:'Isolated test',openingDate:'2026-01-01',closingDate:'2027-01-01'}};
 await check('manual real repository writes and retries atomically',async()=>{
  const result=await manual.create(ids.admin,input,sessions.admin);
  assert.ok(result.opportunityId);
  assert.deepEqual(await manual.create(ids.admin,input,sessions.admin),result);
  await assert.rejects(manual.create(ids.admin,{...input,requestId:randomUUID()},sessions.expiredAdmin),{code:'FUNDING_FORBIDDEN'});
  await assert.rejects(manual.create(ids.orgAdminA,{...input,requestId:randomUUID()},sessions.orgAdminA),{code:'FUNDING_FORBIDDEN'});
 });
 await check('manual audit failure rolls back catalog and receipt',async()=>{
  const broken=require('../../../backend/src/fundingTenders/manualAuthoring').createCentralManualAuthoring({pool:caps.authoring,repository,audit:async()=>{throw Error('synthetic audit failure');}});
  const before=(await pool.query('SELECT count(*)::int n FROM opportunity_catalog.opportunity')).rows[0].n;
  await assert.rejects(broken.create(ids.admin,{...input,requestId:randomUUID()},sessions.admin));
  assert.equal((await pool.query('SELECT count(*)::int n FROM opportunity_catalog.opportunity')).rows[0].n,before);
 });
 // Actual persisted session and actual SQL authority helper, no authority double.
 const now=Date.now(),policyVersion='production-gate-v1';
 const c=await pool.connect();
 try {
  await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  await c.query('INSERT INTO public.application_session_store(sid,sess,expire) VALUES($1,$2,$3)',[sessions.admin,
   {auth:{user:{id:ids.admin},revocationVersion:1,policyVersion,absoluteExpiresAt:now+3600000,evidence:{authTime:Math.floor(now/1000),acr:'1',amr:['pwd'],policyVersion}},cookie:{expires:new Date(now+3600000).toISOString()}},new Date(now+3600000)]);
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 const authority=require('../../../backend/src/opportunities/v2/activationAuthority').createActivationAuthorityV2({policyVersion,recentMfaRequirement:{mfa:false,maxAgeSeconds:86400,amrMode:'any',acceptedAcr:[],acceptedAmr:[]}});
 const objects=new Map();
 const store={async beginWrite({objectId}){return {objectId}},async write(h,stream){const chunks=[];for await(const c of stream)chunks.push(c);objects.set(h.objectId,Buffer.concat(chunks))},async commit(){},async abort(){},async head({objectId}){return {size:objects.get(objectId).length,etag:'isolated'}},async readRange({objectId,start,end}){return [objects.get(objectId).subarray(start,end+1)]},async health(){return {ready:true}},async shutdown(){}};
 const runtime=require('../../../backend/src/portugal2030/uploadRuntime').createCentralImportUploadRuntime({pool:caps.authoring,store,authority,readAuthority:authority,scanner:{async scan(){return {status:'CLEAN'}},async health(){return {ready:true}}}});
 const bytes=fs.readFileSync(path.resolve(__dirname,'../../../backend/test/fixtures/portugal2030/PlanoAnualAvisos_download_140926-1.xlsx'));
 const requestId=randomUUID();let receipt,preview,staged;
 await check('PT2030 readiness and upload with private originals',async()=>{
  assert.equal((await runtime.availability()).available,true);
  receipt=await runtime.upload({userId:ids.admin,sessionId:sessions.admin,requestId,file:{buffer:bytes,filename:'Plano.xlsx',mime:require('../../../backend/src/portugal2030/planXlsxV2').MIME}});
 });
 await check('PT2030 preview and stage with real SQL and session locks',async()=>{
  const args={userId:ids.admin,sessionId:sessions.admin,requestId,sheetName:receipt.sheets[0]};
  preview=await runtime.preview({...args,previewRequestId:randomUUID()});
  assert.ok(preview.rows.length>0);
  staged=await runtime.stage({...args,stageRequestId:randomUUID(),previewDigest:preview.previewDigest});
  assert.ok(staged.importId);
  await assert.rejects(runtime.preview({...args,sessionId:sessions.expiredAdmin,previewRequestId:randomUUID()}),{code:'C4G_ADMIN_REQUIRED'});
 });
 await check('PT2030 review acceptance and replay through real v2 writer',async()=>{
  const args={userId:ids.admin,sessionId:sessions.admin,importId:staged.importId};
  const review=await runtime.review(args);
  const result=await runtime.accept({...args,batchDigest:review.batchDigest});
  assert.ok(result.created>0,JSON.stringify(result));assert.equal(result.failed.length,0,JSON.stringify(result));
  const again=await runtime.review(args);const replay=await runtime.accept({...args,batchDigest:again.batchDigest});
  assert.equal(replay.created,0);assert.equal(replay.failed.length,0);
 });
 await runtime.close();
}
module.exports={run};
