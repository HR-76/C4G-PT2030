'use strict';
const path=require('node:path');
const {isDeepStrictEqual}=require('node:util');
const {createHash}=require('node:crypto');
const {createActivationAuthorityV2}=require('./activationAuthority');
const {loadEuWriterWindowPlan,planDigest}=require('./euWriterWindowPlan');
const {rawSnapshotDigest}=require('./reconciliation');
const {contentDigestV2}=require('./digests');
const {cloneData,deepFreeze}=require('./data');
const {isUuidV7}=require('../../audit/uuidV7');
const {createAuditEvent}=require('../../audit/event');
const {createAppendService}=require('../../audit/appendService');
const {PostgresAppendRepository}=require('../../audit/postgresAppendRepository');
const {assertSupportedPostgresMajor}=require('../../security/centralMigrationPreflight');
const {assertCentralMarker,validateAppliedMigrationLedger}=require('../../../scripts/runCentralMigrations');
const {assertCentralSchema}=require('../../security/centralSchemaManifest');
const {CENTRAL_BASELINE}=require('../../security/opportunityEuWriterMigrationPackage');
const ROOT=path.resolve(__dirname,'../../../..');
const digest=v=>createHash('sha256').update(v).digest('hex');
function fail(code='OPPORTUNITY_V2_WINDOW_INVALID'){throw Object.assign(Error(code),{code});}
function requestTime(id){return parseInt(id.replaceAll('-','').slice(0,12),16);}
function assertWindowLedger(rows){
 try{validateAppliedMigrationLedger(rows,'operational preparation refused');if(rows.at(-1)?.version!==CENTRAL_BASELINE)fail('OPPORTUNITY_V2_WINDOW_BASELINE_CHANGED');return CENTRAL_BASELINE;}catch{fail('OPPORTUNITY_V2_WINDOW_BASELINE_CHANGED');}
}
function approvalInput(raw,plan,now=Date.now()){
 const input=cloneData(raw,{maxBytes:4096});if(!input||Array.isArray(input)||Object.keys(input).length!==3||!['windowId','requestId','planDigest'].every(k=>Object.hasOwn(input,k))||input.windowId!==plan.windowId||!isUuidV7(input.requestId))fail();
 if(input.planDigest!==planDigest(plan))fail('OPPORTUNITY_V2_WINDOW_CHANGED');
 const at=requestTime(input.requestId);if(at<Date.parse(plan.createdAt)||at>now+5000)fail();return deepFreeze(input);
}
function approvalEvent(plan,input,actorId){
 // observedAt is the bounded UUIDv7 request creation time. The ledger supplies
 // acceptedAt from PostgreSQL. Stable intent permits exact replay without a new
 // receipt table or exposing general audit reads to the HTTP runtime role.
 return createAuditEvent({trustedContext:{scope:'PLATFORM',organizationId:null,tenantId:null,operationAuthority:'CENTRAL',operationCode:'OPPORTUNITY_CENTRAL_MANAGE',source:'EU_WRITER_WINDOW_PREPARATION',channel:'APPLICATION',synchronous:false},
 input:{eventCode:'SENSITIVE_ACTION_ALLOWED',actor:{type:'HUMAN',id:actorId,membershipId:null,serviceActorCode:null,supportGrantId:null},subject:null,resource:{type:'EU_WRITER_WINDOW',id:plan.windowId},decision:'ACCEPT',outcome:'SUCCESS',observedAt:new Date(requestTime(input.requestId)).toISOString(),correlationId:input.requestId,causationId:null,idempotencyKey:digest('eu-writer-window-approval\0'+input.requestId),streamType:'OPERATIONS',
 payload:{detailCode:'EU_WRITER_WINDOW_APPROVED',policyVersion:'eu-writer-window-v1',catalogVersion:'f12-events-v2',scopeType:'EU_WRITER_WINDOW',scopeDigest:digest(JSON.stringify({windowId:plan.windowId,package:plan.package,writer:plan.writer,source:plan.source})),semanticDigest:input.planDigest}},uuid:()=>input.requestId});
}
async function assertCurrentWindowState(client,plan){
 await client.query('LOCK TABLE opportunity_catalog.funding_run IN ROW SHARE MODE');
 const locked=(await client.query("SELECT state,fence FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS' FOR SHARE")).rows[0];
 const source=(await client.query('SELECT opportunity_catalog.eu_source_state_v2() AS state')).rows[0]?.state;
 if(!locked||locked.state!=='QUIESCED'||locked.fence!==plan.source.fence||source?.state!=='QUIESCED'||source.fence!==plan.source.fence||['pendingRuns','otherPendingRuns','activeRunLeases','activeInboxLeases','activeOutboxLeases'].some(k=>source[k]!==0))fail('OPPORTUNITY_V2_WINDOW_STATE_CHANGED');
 const row=(await client.query('SELECT o.*,r.snapshot FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id AND r.opportunity_id=o.opportunity_id WHERE o.opportunity_id=$1 FOR SHARE OF o',[plan.expected.opportunityId])).rows[0];
 if(!row||row.lifecycle_state!=='ACTIVE'||row.current_schema_version!==2||row.current_revision_id!==plan.expected.revisionId||Number(row.row_version)!==plan.expected.rowVersion||row.content_digest!==plan.accepted.contentDigest||rawSnapshotDigest(row.snapshot)!==plan.accepted.snapshotDigest||contentDigestV2(row.snapshot)!==plan.accepted.contentDigest)fail('OPPORTUNITY_V2_WINDOW_STATE_CHANGED');
 const identities=(await client.query("SELECT opportunity_id FROM opportunity_catalog.source_identity_v2 WHERE source_namespace='EU_FUNDING_TENDERS' AND external_identifier='CASCADE:11145'")).rows;
 if(identities.length!==1||identities[0].opportunity_id!==plan.expected.opportunityId)fail('OPPORTUNITY_V2_WINDOW_STATE_CHANGED');
 const protectedState=(await client.query("SELECT EXISTS(SELECT 1 FROM opportunity_catalog.funding_identity WHERE opportunity_id=$1 AND (corrections<>'{}'::jsonb OR conflicts<>'[]'::jsonb)) OR EXISTS(SELECT 1 FROM opportunity_catalog.funding_resolution WHERE opportunity_id=$1) AS protected",[plan.expected.opportunityId])).rows[0];
 if(protectedState?.protected!==false)fail('OPPORTUNITY_V2_WINDOW_STATE_CHANGED');
 return true;
}
function createEuWriterWindowApproval({pool,policyVersion,recentMfaRequirement,workspaceRoot=ROOT}){
 if(!pool?.connect)throw new TypeError('Central pool is required.');
 const authority=createActivationAuthorityV2({policyVersion,recentMfaRequirement}),append=createAppendService({appendPort:new PostgresAppendRepository()});
 async function transaction(windowId,context,work){
  const client=await pool.connect();try{
   await client.query('BEGIN');
   // The normal physical preflight components run on this transaction client.
   // Holding the run-table lock serializes the 043 ALTER TABLE before checking
   // the ledger, closing the gap between an external preflight and approval.
   await client.query('LOCK TABLE opportunity_catalog.funding_run IN ROW SHARE MODE');
   await assertSupportedPostgresMajor(client);await assertCentralMarker(client);
   const currentVersion=assertWindowLedger((await client.query('SELECT version,checksum_sha256,irreversible FROM public.c4g_schema_migration ORDER BY version')).rows);
   const fingerprint=await assertCentralSchema(client,currentVersion);
   await client.query('SET LOCAL ROLE c4g_opportunity_central_runtime');
   const actorId=await authority.assertAdministrator(client,context),loaded=loadEuWriterWindowPlan(workspaceRoot,windowId);
   if(currentVersion!==loaded.plan.baseline.centralVersion||fingerprint!==loaded.plan.baseline.centralFingerprint)fail('OPPORTUNITY_V2_WINDOW_BASELINE_CHANGED');
   await assertCurrentWindowState(client,loaded.plan);
   const result=await work(client,loaded,actorId);
   const current=loadEuWriterWindowPlan(workspaceRoot,windowId);if(!isDeepStrictEqual(current,loaded))fail('OPPORTUNITY_V2_WINDOW_CHANGED');
   await authority.assertAdministrator(client,context);await client.query('COMMIT');return deepFreeze(result);
  }catch(e){await client.query('ROLLBACK').catch(()=>{});if(e.code?.startsWith('OPPORTUNITY_V2_'))throw e;if(e.code==='23505'||e.message==='AUDIT_DIGEST_MISMATCH')fail('OPPORTUNITY_V2_IDEMPOTENCY_CONFLICT');fail('OPPORTUNITY_V2_WINDOW_UNAVAILABLE');}finally{client.release();}
 }
 async function get(windowId,context){return transaction(windowId,context,async(client,loaded)=>({...loaded,scope:'PREPARATION_ONLY',liveChecks:{central:true,source:true,head:true,tenant:false},limitations:['Tenant baseline and backup are verified by hashed evidence; execution must revalidate them.','This approval does not install, configure or resume the writer.']}));}
 async function approve(raw,context){return transaction(raw?.windowId,context,async(client,{plan},actorId)=>{
  const input=approvalInput(raw,plan),candidate=approvalEvent(plan,input,actorId);
  const platform={query(sql,values){return client.query(sql.replace('audit.prepare_append_v1','audit.prepare_platform_append_v1').replace('audit.append_event_v1','audit.append_platform_event_v1'),values);}};
  const result=await append.append(candidate,platform);if(!result||!['APPENDED','DUPLICATE'].includes(result.status))fail('OPPORTUNITY_V2_WINDOW_UNAVAILABLE');
  return {windowId:plan.windowId,planDigest:input.planDigest,requestId:input.requestId,actorId,eventId:result.eventId,eventHash:result.eventHash,expiresAt:plan.expiresAt,scope:'PREPARATION_ONLY',replayed:result.status==='DUPLICATE'};
 });}
 return Object.freeze({get,approve});
}
module.exports={createEuWriterWindowApproval,approvalInput,approvalEvent,assertCurrentWindowState,assertWindowLedger};
