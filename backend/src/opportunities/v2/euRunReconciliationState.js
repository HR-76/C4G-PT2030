'use strict';
const {deepFreeze}=require('./data');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const PROPOSED_CHANGES=Object.freeze({runStatus:'ERROR',cycleStatus:'ERROR',errorCode:'FUNDING_EXECUTION_EXPIRED',inboxState:'FAILED',inboxResult:'EXPIRED',executionState:'EXPIRED',outboxState:'PUBLISHED',targetsChanged:false});
function fail(code='OPPORTUNITY_V2_RECONCILIATION_STATE_CHANGED'){throw Object.assign(Error(code),{code});}
// This single statement is also embedded, unchanged, in the registered 044
// helper. PostgreSQL's jsonb text gives the same digest before and after install.
const PREVIEW_SQL=`WITH pending AS (
 SELECT r.* FROM opportunity_catalog.funding_run r JOIN opportunity_catalog.funding_batch b USING(run_id)
 WHERE b.cycle_id=$1 AND r.status IN ('QUEUED','RUNNING')
), chosen AS (SELECT * FROM pending WHERE (SELECT count(*) FROM pending)=1),
published AS (SELECT o.* FROM async_exec.outbox o JOIN chosen r ON o.envelope#>>'{payload,runId}'=r.run_id::text WHERE o.organization_id IS NULL),
payload AS (SELECT jsonb_build_object(
 'cycleId',$1::text,'source',opportunity_catalog.eu_source_state_v2(),
 'run',(SELECT to_jsonb(r) FROM chosen r),
 'cycle',(SELECT to_jsonb(c) FROM opportunity_catalog.funding_cycle c WHERE c.cycle_id=$1),
 'batch',(SELECT to_jsonb(b) FROM opportunity_catalog.funding_batch b JOIN chosen r USING(run_id)),
 'inbox',(SELECT to_jsonb(i) FROM async_exec.inbox i JOIN chosen r ON i.idempotency_key=r.run_id::text WHERE i.organization_id IS NULL AND i.consumer='funding-central-v1' AND i.job_type='funding_tenders.refresh'),
 'outbox',(SELECT to_jsonb(o) FROM published o),
 'execution',(SELECT to_jsonb(e) FROM async_exec.execution e JOIN published o ON e.execution_id=(o.envelope->>'executionId')::uuid WHERE e.organization_id IS NULL),
 'expiry',jsonb_build_object(
 'runExpired',(SELECT r.created_at+interval '5 minutes'<=clock_timestamp() FROM chosen r),
 'runLeaseExpired',(SELECT r.lease_until IS NULL OR r.lease_until<=clock_timestamp() FROM chosen r),
 'inboxLeaseExpired',(SELECT i.lease_until IS NULL OR i.lease_until<=clock_timestamp() FROM async_exec.inbox i JOIN chosen r ON i.idempotency_key=r.run_id::text WHERE i.organization_id IS NULL AND i.consumer='funding-central-v1' AND i.job_type='funding_tenders.refresh'),
 'executionExpired',(SELECT e.deadline_at<=clock_timestamp() AND (e.lease_until IS NULL OR e.lease_until<=clock_timestamp()) FROM async_exec.execution e JOIN published o ON e.execution_id=(o.envelope->>'executionId')::uuid),
 'envelopeExpired',(SELECT (o.envelope->>'deadlineAt')::timestamptz<=clock_timestamp() FROM published o)),
 'counts',jsonb_build_object('pendingInCycle',(SELECT count(*) FROM pending),'outboxes',(SELECT count(*) FROM published),
 'successors',(SELECT count(*) FROM async_exec.execution e JOIN published o ON e.previous_execution_id=(o.envelope->>'executionId')::uuid)),
 'preservation',jsonb_build_object(
 'targets',(SELECT jsonb_build_object('count',count(*),'digest',encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.external_identifier),'[]'::jsonb)::text,'UTF8')),'hex')) FROM opportunity_catalog.funding_refresh_target t WHERE t.cycle_id=$1),
 'archives',(SELECT jsonb_build_object('count',count(*),'digest',encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.run_id,a.external_identifier),'[]'::jsonb)::text,'UTF8')),'hex')) FROM opportunity_catalog.funding_candidate_v2 a JOIN opportunity_catalog.funding_batch b USING(run_id) WHERE b.cycle_id=$1),
 'decisions',(SELECT jsonb_build_object('count',count(*),'digest',encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.run_id,d.external_identifier),'[]'::jsonb)::text,'UTF8')),'hex')) FROM opportunity_catalog.eu_writer_decision_v2 d JOIN opportunity_catalog.funding_batch b USING(run_id) WHERE b.cycle_id=$1),
 'heads',(SELECT jsonb_build_object('count',count(*),'digest',encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.opportunity_id),'[]'::jsonb)::text,'UTF8')),'hex')) FROM opportunity_catalog.opportunity o),
 'revisions',(SELECT jsonb_build_object('count',count(*),'digest',encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.revision_id),'[]'::jsonb)::text,'UTF8')),'hex')) FROM opportunity_catalog.revision r)
 ),'proposedChanges','${JSON.stringify(PROPOSED_CHANGES)}'::jsonb) AS preview)
SELECT preview,encode(sha256(convert_to(preview::text,'UTF8')),'hex') AS preview_digest,clock_timestamp() AS observed_at FROM payload`;
function assertPreview(p){
 const s=p?.source,r=p?.run,i=p?.inbox,e=p?.execution,o=p?.outbox,c=p?.cycle;
 if(!p||!UUID.test(p.cycleId)||s?.state!=='QUIESCED'||!Number.isSafeInteger(s.fence)||s.fence<1||s.writerMode!=='CANONICAL_V2'||s.pendingRuns!==1||s.expiredPendingRuns!==1||s.unrecoverablePendingRuns!==1||['otherPendingRuns','activeRunLeases','activeInboxLeases','activeOutboxLeases','incompatiblePendingRuns'].some(k=>s[k]!==0)
 ||!r||!UUID.test(r.run_id)||r.source_code!=='EU_FUNDING_TENDERS'||r.status!=='RUNNING'||r.eu_writer_mode!=='CANONICAL_V2'||r.eu_writer_policy!==s.writerPolicy||r.eu_writer_mapping_digest!==s.writerMappingDigest||r.eu_source_held!==true
 ||c?.cycle_id!==p.cycleId||c.status!=='RUNNING'||p.batch?.run_id!==r.run_id||p.batch?.cycle_id!==p.cycleId
 ||i?.state!=='PROCESSING'||i.consumer!=='funding-central-v1'||i.idempotency_key!==r.run_id||i.organization_id!==null||i.job_type!=='funding_tenders.refresh'
 ||!['QUEUED','CLAIMED','RUNNING','RETRY_WAIT'].includes(e?.state)||e.execution_id!==i.execution_id||e.organization_id!==null||!executionMatchesOutbox(e,o)
 ||o?.state!=='PUBLISHED'||o.organization_id!==null||o.envelope?.executionId!==e.execution_id||o.envelope?.payload?.runId!==r.run_id||o.envelope?.jobType!=='funding_tenders.refresh'||i.digest_sha256!==o.digest_sha256
 ||!p.expiry||Object.values(p.expiry).some(x=>x!==true)||Object.keys(p.expiry).length!==5||p.counts?.pendingInCycle!==1||p.counts?.outboxes!==1||p.counts?.successors!==0)fail();
 return p;
}
function executionMatchesOutbox(e,o){
 if(!e||!o||e.job_type!==o.envelope?.jobType||Date.parse(e.deadline_at)!==Date.parse(o.envelope?.deadlineAt)||!Number.isFinite(Date.parse(e.deadline_at))||!SHA.test(e.content_digest)||!SHA.test(e.envelope_digest)||e.content_digest!==o.digest_sha256)return false;
 if(['content_digest','envelope_digest','lineage_version','attempt','delivery_kind','root_execution_id','previous_execution_id','replay_request_id'].some(k=>e[k]!==o[k]))return false;
 return e.outbox_id===o.outbox_id||(e.outbox_id===null&&e.delivery_kind==='INITIAL'&&e.lineage_version===1&&e.attempt===1&&e.root_execution_id===e.execution_id&&e.previous_execution_id===null&&e.replay_request_id===null);
}
async function readExpiredRunState(client,{cycleId}){
 if(!UUID.test(cycleId))fail();const row=(await client.query(PREVIEW_SQL,[cycleId])).rows[0];if(!row||!SHA.test(row.preview_digest))fail();assertPreview(row.preview);
 return deepFreeze({preview:row.preview,previewDigest:row.preview_digest,observedAt:new Date(row.observed_at).toISOString()});
}
async function assertReconciliationPreviewState(client,scope){const state=await readExpiredRunState(client,scope);if(state.preview.run.run_id!==scope.runId||state.preview.source.fence!==scope.sourceFence||state.previewDigest!==scope.previewDigest)fail();return state;}
module.exports={UUID,SHA,PROPOSED_CHANGES,PREVIEW_SQL,executionMatchesOutbox,assertPreview,readExpiredRunState,assertReconciliationPreviewState};
