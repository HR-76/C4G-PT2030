'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const verifier=require('../scripts/eu-reconciliation-verify.cjs');
const id='019a4030-0000-7000-8000-000000000001';
test('verification accepts only before or after for the fixed installation artifact',()=>{
 assert.deepEqual(verifier.args(['--before',`--execution=output/opportunity-eu-reconciliation-${id}/installation.json`]),{before:true,relative:`output/opportunity-eu-reconciliation-${id}/installation.json`});
 for(const a of [['--resume'],['--after','--execution=../installation.json'],['--before',`--execution=output/opportunity-eu-reconciliation-${id}/installation.json`,'--force']])assert.throws(()=>verifier.args(a));
});
function rows(){const p={run:{fence:1,status:'RUNNING',result_count:0,lease_until:'expired',finished_at:null,error_code:null,eu_source_fence:5},cycle:{status:'RUNNING',finished_at:null,error_code:null,review_count:137},inbox:{fence:2,state:'PROCESSING',lease_until:'expired',completed_at:null,result_code:null},execution:{fence:0,state:'QUEUED',lease_until:null,updated_at:'before',result_code:null}},at='2026-10-31T18:00:00+00:00';return {p,after:{run:{...p.run,fence:2,status:'ERROR',lease_until:null,finished_at:at,error_code:'FUNDING_EXECUTION_EXPIRED'},cycle:{...p.cycle,status:'ERROR',finished_at:at,error_code:'FUNDING_EXECUTION_EXPIRED'},inbox:{...p.inbox,fence:3,state:'FAILED',lease_until:null,completed_at:at,result_code:'EXPIRED'},execution:{...p.execution,fence:1,state:'EXPIRED',lease_until:null,updated_at:at,result_code:'EXPIRED'}}};}
test('terminal proof permits only the four exact expiry transitions and preserves counts and source epoch',()=>{
 const {p,after}=rows();assert.equal(verifier.assertTerminalRows(p,after),true);
 for(const change of [v=>v.run.result_count++,v=>v.run.eu_source_fence++,v=>v.cycle.review_count=0,v=>v.inbox.state='COMPLETED',v=>v.execution.updated_at='2026-10-31T18:00:01Z']){const v=structuredClone(after);change(v);assert.throws(()=>verifier.assertTerminalRows(p,v));}
});
test('preservation excludes only the bound four rows and two new administrative receipts',()=>{
 const p={planId:id,runId:id,cycleId:id,preview:{inbox:{consumer:'funding-central-v1',job_type:'funding_tenders.refresh',job_version:1,idempotency_key:id},execution:{execution_id:id}}};
 assert.equal(verifier.tableFilter('opportunity_catalog','funding_refresh_target',p).where,'');
 assert.deepEqual(verifier.tableFilter('opportunity_catalog','funding_run',p).values,[id]);
 assert.equal(verifier.tableFilter('async_exec','outbox',p).where,'');
 assert.equal(verifier.tableFilter('opportunity_catalog','eu_expired_permit_v1',p).values[0],id);
 assert(verifier.tableFilter('async_exec','inbox',p).where.includes('job_version'));
});
test('historical audit proof refuses any changed or missing event while allowing verified append-only events',()=>{
 const old=[{eventId:id,eventHash:'a'.repeat(64)}];assert.equal(verifier.assertHistoricalAudit(old,[...old,{eventId:'another',eventHash:'b'.repeat(64)}]),true);
 assert.throws(()=>verifier.assertHistoricalAudit(old,[]));assert.throws(()=>verifier.assertHistoricalAudit(old,[{eventId:id,eventHash:'b'.repeat(64)}]));
});
test('11145 proof uses the real canonical digest and SQL numeric, currency and seven deadline projections',async()=>{
 const snapshot=require('../context/references/opportunity-v2/examples/eu-11145.json'),digest=require('../backend/src/opportunities/v2/digests').contentDigestV2(snapshot);
 let currency='NOT_FOUND',dates=snapshot.schedule.deadlines.value;
 const client={async query(sql){if(sql.includes('UNION SELECT'))return {rows:[{opportunity_id:id}]};if(sql.includes('JOIN opportunity_catalog.revision r'))return {rows:[{opportunity_id:id,current_revision_id:id,row_version:'5',current_schema_version:2,content_digest:digest,snapshot}]};if(sql.includes('revision_allocation_v2'))return {rows:[{amount_canonical:'120000',amount:'120000.00000000',sql_type:'numeric',currency_state:currency,currency_code:null}]};if(sql.includes('revision_deadline_v2'))return {rows:dates.map(payload=>({payload}))};throw Error('unexpected SQL');}};
 const result=await verifier.head11145(client);assert.equal(result.amount,120000);assert.equal(result.rowVersion,5);assert.equal(result.deadlineCount,7);assert.match(result.snapshotDigest,/^[a-f0-9]{64}$/);
 currency='CONFIRMED';await assert.rejects(()=>verifier.head11145(client));currency='NOT_FOUND';dates=dates.slice(1);await assert.rejects(()=>verifier.head11145(client));
});
test('audit binding uses the actual critical event shape and rejects approval under another plan',()=>{
 const service=require('../backend/src/opportunities/v2/euRunReconciliation'),plan={planId:id,previewDigest:'a'.repeat(64)},event={...service.reconciliationEvent(plan,{requestId:id},id).event,streamId:'PLATFORM:OPERATIONS'};
 assert.doesNotThrow(()=>verifier.auditBinding(event,plan,id,'EU_EXPIRED_RECONCILIATION_APPROVED'));
 assert.throws(()=>verifier.auditBinding(event,{...plan,previewDigest:'b'.repeat(64)},id,'EU_EXPIRED_RECONCILIATION_APPROVED'));
});
