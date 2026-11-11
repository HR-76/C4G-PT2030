'use strict';
const path=require('node:path'),{isDeepStrictEqual}=require('node:util');
const {cloneData,deepFreeze}=require('./data');
const {createActivationAuthorityV2,humanContext}=require('./activationAuthority');
const {createAuditEvent}=require('../../audit/event'),{createAppendService}=require('../../audit/appendService'),{PostgresAppendRepository}=require('../../audit/postgresAppendRepository'),{isUuidV7}=require('../../audit/uuidV7');
const {assertSupportedPostgresMajor}=require('../../security/centralMigrationPreflight');
const {assertCentralMarker,validateAppliedMigrationLedger}=require('../../../scripts/runCentralMigrations');
const {assertCentralSchema}=require('../../security/centralSchemaManifest');
const pkg=require('../../security/opportunityEuReconciliationMigrationPackage');
const state=require('./euRunReconciliationState'),plans=require('./euRunReconciliationPlan');
const ROOT=path.resolve(__dirname,'../../../..');
function fail(code='OPPORTUNITY_V2_RECONCILIATION_INVALID'){throw Object.assign(Error(code),{code});}
function requestTime(id){return parseInt(id.replaceAll('-','').slice(0,12),16);}
function validateRequest(raw,plan,execute=false,now=Date.now()){
 const input=cloneData(raw,{maxBytes:4096}),keys=['planId','requestId','previewDigest',...(execute?['approvalEventId','approvalEventHash']:[])];
 if(!input||Array.isArray(input)||Object.keys(input).length!==keys.length||!keys.every(k=>Object.hasOwn(input,k))||input.planId!==plan.planId||!isUuidV7(input.requestId)||execute&&(!isUuidV7(input.approvalEventId)||!state.SHA.test(input.approvalEventHash)))fail();
 if(input.previewDigest!==plan.previewDigest)fail('OPPORTUNITY_V2_RECONCILIATION_CHANGED');const at=requestTime(input.requestId);if(at<Date.parse(plan.createdAt)||at>now+5000)fail();return deepFreeze(input);
}
function reconciliationEvent(plan,input,actorId,execute=false){return createAuditEvent({trustedContext:{scope:'PLATFORM',organizationId:null,tenantId:null,operationAuthority:'CENTRAL',operationCode:'OPPORTUNITY_CENTRAL_MANAGE',source:'EU_EXPIRED_RECONCILIATION',channel:'APPLICATION',synchronous:false},
 input:{eventCode:'SENSITIVE_ACTION_ALLOWED',actor:{type:'HUMAN',id:actorId,membershipId:null,serviceActorCode:null,supportGrantId:null},subject:null,resource:{type:'EU_EXPIRED_RECONCILIATION',id:plan.planId},decision:'ACCEPT',outcome:'SUCCESS',observedAt:new Date(requestTime(input.requestId)).toISOString(),correlationId:input.requestId,causationId:execute?input.approvalEventId:null,idempotencyKey:plans.hash(`eu-expired-reconciliation-${execute?'apply':'approval'}\0${input.requestId}`),streamType:'OPERATIONS',payload:{detailCode:execute?'EU_EXPIRED_RECONCILIATION_APPLIED':'EU_EXPIRED_RECONCILIATION_APPROVED',policyVersion:'eu-expired-reconciliation-v1',catalogVersion:'f12-events-v2',scopeType:'EU_EXPIRED_RECONCILIATION',scopeDigest:plan.previewDigest,semanticDigest:plans.hash(plan)}},uuid:()=>input.requestId});}
function createEuRunReconciliation({pool,policyVersion,recentMfaRequirement,workspaceRoot=ROOT}){
 if(!pool?.connect)throw new TypeError('Central pool is required.');const authority=createActivationAuthorityV2({policyVersion,recentMfaRequirement}),append=createAppendService({appendPort:new PostgresAppendRepository()});
 async function transaction(planId,rawContext,execute,work){
  const context=humanContext(rawContext);if(!context)fail('OPPORTUNITY_V2_AUTHORITY_DENIED');const client=await pool.connect();
  try{await client.query('BEGIN');const originalRole=(await client.query("SELECT current_setting('role') AS role")).rows[0]?.role;if(typeof originalRole!=='string'||!originalRole.length)fail('OPPORTUNITY_V2_RECONCILIATION_UNAVAILABLE');await client.query('LOCK TABLE opportunity_catalog.funding_run IN EXCLUSIVE MODE');
   await assertSupportedPostgresMajor(client);await assertCentralMarker(client);const ledger=(await client.query('SELECT version,checksum_sha256,irreversible FROM public.c4g_schema_migration ORDER BY version')).rows;validateAppliedMigrationLedger(ledger,'reconciliation refused');const version=ledger.at(-1)?.version;
   if(!(execute?[pkg.entry.version]:[pkg.CENTRAL_BASELINE,pkg.entry.version]).includes(version))fail('OPPORTUNITY_V2_RECONCILIATION_BASELINE_CHANGED');await assertCentralSchema(client,version);
   await client.query('SET LOCAL ROLE c4g_opportunity_central_runtime');const actorId=await authority.assertAdministrator(client,context),loaded=plans.loadReconciliationPlan(workspaceRoot,planId);
   await client.query("SELECT family FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS' FOR SHARE");
   // Before 044 there is no reconciliation read helper. Use the already
   // admitted physical pool's own read privileges; never add async SELECT to
   // the generic catalog role just to make preparation work.
   await client.query(originalRole==='none'?'SET LOCAL ROLE NONE':`SET LOCAL ROLE "${originalRole.replaceAll('"','""')}"`);
   const result=await work(client,loaded,actorId,context);
   if(!isDeepStrictEqual(loaded,plans.loadReconciliationPlan(workspaceRoot,planId)))fail('OPPORTUNITY_V2_RECONCILIATION_CHANGED');await client.query('SET LOCAL ROLE c4g_opportunity_central_runtime');await authority.assertAdministrator(client,context);await client.query('COMMIT');return deepFreeze(result);
  }catch(e){await client.query('ROLLBACK').catch(()=>{});if(e.code?.startsWith('OPPORTUNITY_V2_'))throw e;if(e.message?.startsWith('OPPORTUNITY_V2_RECONCILIATION_'))fail(e.message);if(e.code==='23505'||e.code==='AUDIT_DIGEST_MISMATCH')fail('OPPORTUNITY_V2_IDEMPOTENCY_CONFLICT');fail('OPPORTUNITY_V2_RECONCILIATION_UNAVAILABLE');}finally{client.release();}
 }
 async function assertPreview(client,plan){const observed=await state.assertReconciliationPreviewState(client,{cycleId:plan.cycleId,runId:plan.runId,sourceFence:plan.source.fence,previewDigest:plan.previewDigest});if(!isDeepStrictEqual(observed.preview,plan.preview))fail('OPPORTUNITY_V2_RECONCILIATION_STATE_CHANGED');return observed;}
 async function record(client,plan,input,actorId,execute){await client.query('SET LOCAL ROLE c4g_opportunity_central_runtime');const port={query(sql,values){return client.query(sql.replace('audit.prepare_append_v1','audit.prepare_platform_append_v1').replace('audit.append_event_v1','audit.append_platform_event_v1'),values);}};const result=await append.append(reconciliationEvent(plan,input,actorId,execute),port);if(!['APPENDED','DUPLICATE'].includes(result?.status))fail('OPPORTUNITY_V2_RECONCILIATION_UNAVAILABLE');return result;}
 const get=(planId,context)=>transaction(planId,context,false,async(client,{plan,previewDigest})=>{await assertPreview(client,plan);return {plan,previewDigest,scope:'EXPIRED_RUN_RECONCILIATION',source:plan.preview.source};});
 const approve=(raw,context)=>transaction(raw?.planId,context,false,async(client,{plan},actorId)=>{const input=validateRequest(raw,plan);await assertPreview(client,plan);const event=await record(client,plan,input,actorId,false);return {planId:plan.planId,previewDigest:plan.previewDigest,requestId:input.requestId,actorId,eventId:event.eventId,eventHash:event.eventHash,expiresAt:plan.expiresAt,scope:'RECONCILIATION_ONLY',replayed:event.status==='DUPLICATE'};});
 const execute=(raw,context)=>transaction(raw?.planId,context,true,async(client,{plan},actorId,trusted)=>{
  const input=validateRequest(raw,plan,true),event=await record(client,plan,input,actorId,true);
  // The helper checks both real ledger events, persisted authority and the full
  // preview under the same transaction. No raw actor or scope comes from HTTP.
  await client.query('SET LOCAL ROLE c4g_eu_reconciliation_runtime');
  const applied=(await client.query('SELECT opportunity_catalog.reconcile_eu_expired_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb,$6::text,$7::text,$8::uuid,$9::text,$10::uuid,$11::text,$12::timestamptz) AS receipt',[plan.planId,input.requestId,actorId,trusted.sessionId,JSON.stringify(plan.preview),plan.previewDigest,JSON.stringify(plan),input.approvalEventId,input.approvalEventHash,event.eventId,event.eventHash,plan.expiresAt])).rows[0]?.receipt;
  if(!applied?.result||typeof applied.replayed!=='boolean')fail('OPPORTUNITY_V2_RECONCILIATION_UNAVAILABLE');return {planId:plan.planId,previewDigest:plan.previewDigest,requestId:input.requestId,actorId,cycleId:plan.cycleId,runId:plan.runId,sourceFence:plan.source.fence,...applied};
 });
 return Object.freeze({get,approve,execute});
}
module.exports={...state,...plans,validateRequest,reconciliationEvent,createEuRunReconciliation};
