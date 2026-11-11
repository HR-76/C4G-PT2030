'use strict';
const {createActivationAuthorityV2}=require('./activationAuthority');
const {createAcceptedOpportunityV2Repository}=require('./acceptedRepository');
const {createActivationAuditV2}=require('./activationAudit');
const p=require('./activationApproval');
const {rawSnapshotDigest}=require('./reconciliation');
const {readOpportunitySnapshot}=require('./compatibility');
const {deepFreeze}=require('./data');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_READ_BYTES=1024*1024;
function bounded(value){if(Buffer.byteLength(JSON.stringify(value),'utf8')>MAX_READ_BYTES)p.fail('OPPORTUNITY_V2_READ_LIMIT_EXCEEDED');return deepFreeze(value);}
function createActivationReadV2({pool,policyVersion,recentMfaRequirement}){
 const authority=createActivationAuthorityV2({policyVersion,recentMfaRequirement});
 const accepted=createAcceptedOpportunityV2Repository({pool,authorize:authority.authorize,verifyApproval:p.verifyActivationApproval,audit:createActivationAuditV2()});
 async function transaction(context,work){const client=await pool.connect();try{
  await client.query('BEGIN');await client.query('SET LOCAL ROLE c4g_opportunity_central_runtime');
  await authority.assertAdministrator(client,context);const value=await work(client);await authority.assertAdministrator(client,context);
  await client.query('COMMIT');return bounded(value);
 }catch(error){await client.query('ROLLBACK').catch(()=>{});if(error.code?.startsWith('OPPORTUNITY_V2_'))throw error;p.fail('OPPORTUNITY_V2_ACTIVATION_UNAVAILABLE');}finally{client.release();}}
 async function list(query,context){
  if(!query||Array.isArray(query)||Object.keys(query).some(k=>k!=='cursor')||query.cursor!==undefined&&!UUID.test(query.cursor))p.fail('OPPORTUNITY_V2_ACTIVATION_INVALID');
  return transaction(context,async client=>{
   const rows=(await client.query('SELECT * FROM opportunity_catalog.activation_plan_v2 WHERE ($1::uuid IS NULL OR plan_id>$1) ORDER BY plan_id LIMIT 26',[query.cursor||null])).rows;
   return {items:rows.slice(0,25).map(row=>p.planView(row)),nextCursor:rows.length>25?rows[24].plan_id:null};
  });
 }
 async function get(planId,context){
  if(!UUID.test(planId))p.fail('OPPORTUNITY_V2_ACTIVATION_INVALID');
  return transaction(context,async client=>{
   const row=(await client.query('SELECT *,expires_at>clock_timestamp() AS unexpired FROM opportunity_catalog.activation_plan_v2 WHERE plan_id=$1 FOR SHARE',[planId])).rows[0];
   if(!row)p.fail('OPPORTUNITY_V2_PLAN_NOT_FOUND');
   p.verifyPlan(row);const archive=await p.verifyPlanArchive(client,row);
   let previous=null,current=null;
   if(row.expected){
    const saved=(await client.query('SELECT snapshot FROM opportunity_catalog.revision WHERE opportunity_id=$1 AND revision_id=$2 AND row_version=$3',[row.expected.opportunityId,row.expected.revisionId,row.expected.rowVersion])).rows[0];
    if(!saved||rawSnapshotDigest(saved.snapshot)!==row.preview.items[0].accepted?.snapshotDigest)p.fail('OPPORTUNITY_V2_PLAN_INVALID');
    previous={...row.expected,snapshot:readOpportunitySnapshot(saved.snapshot).snapshot};
    const head=(await client.query('SELECT current_revision_id,row_version,lifecycle_state FROM opportunity_catalog.opportunity WHERE opportunity_id=$1',[row.expected.opportunityId])).rows[0];
    current=head?{opportunityId:row.expected.opportunityId,revisionId:head.current_revision_id,rowVersion:Number(head.row_version),lifecycleState:head.lifecycle_state}:null;
   }
   let currentPreviewMatches=false,reasonCode=null;
   try{const fresh=await accepted.previewInTransaction(client,p.commandFor(row,archive,'review:'+planId),context);currentPreviewMatches=fresh.previewDigest===row.preview_digest;if(!currentPreviewMatches)reasonCode='OPPORTUNITY_V2_APPROVAL_STALE';}
   catch(error){if(!['OPPORTUNITY_V2_STALE_REVISION','OPPORTUNITY_V2_IDENTITY_CONFLICT'].includes(error.code))throw error;reasonCode=error.code;}
   return {...p.planView(row),archive:row.archive_locator,expected:row.expected,
    candidate:{snapshot:archive.snapshot,mappingDigest:archive.mappingDigest,snapshotDigest:archive.snapshotDigest},accepted:previous,current,
    review:{currentPreviewMatches,reasonCode,unexpired:row.unexpired===true,canApprove:row.state==='DRAFT'&&row.unexpired===true&&currentPreviewMatches&&row.preview.items[0].action!=='BLOCKED'}};
  });
 }
 return Object.freeze({list,get});
}
module.exports={createActivationReadV2,bounded,MAX_READ_BYTES};
