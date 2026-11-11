'use strict';
function fail() { throw Object.assign(new Error('FUNDING_CHECKPOINT_INVALID'), {code:'FUNDING_CHECKPOINT_INVALID'}); }
function validateBatch(batch) {
  if (!batch || !Array.isArray(batch.records) || batch.pages !== 1 || ![batch.received,batch.failed,batch.excluded,batch.duplicates].every(n=>Number.isSafeInteger(n)&&n>=0)
    || batch.received>100 || batch.received!==batch.records.length+batch.failed+batch.excluded+batch.duplicates
    || batch.remoteTotal!==null&&(!Number.isSafeInteger(batch.remoteTotal)||batch.remoteTotal<0)
    || !Number.isFinite(Date.parse(batch.observedAt)) || !/^[a-f0-9]{64}$/.test(batch.contract) || !/^\d{4}-\d{2}-\d{2}$/.test(batch.asOf) || Boolean(batch.nextCursor)!==batch.limited) fail();
}
async function load(client, runId) {
  return (await client.query('SELECT * FROM opportunity_catalog.funding_batch WHERE run_id=$1',[runId])).rows[0];
}
async function start(client, runId) {
  await client.query("INSERT INTO opportunity_catalog.funding_cycle(cycle_id,status) VALUES($1,'RUNNING')",[runId]);
  await client.query('INSERT INTO opportunity_catalog.funding_batch(run_id,cycle_id,ordinal) VALUES($1,$1,1)',[runId]);
}
async function stage(client, row, batch) {
  validateBatch(batch);
  const checkpoint=await load(client,row.run_id);
  if(!checkpoint)fail();
  const next=batch.nextCursor;
  if(checkpoint.input_cursor&&(batch.contract!==checkpoint.input_cursor.contract||batch.asOf!==checkpoint.input_cursor.asOf))fail();
  if(next&&(next.contract!==batch.contract||next.asOf!==batch.asOf))fail();
  if(next&&(next.source!==row.source_code||next.nextPage!==(checkpoint.input_cursor?.nextPage||1)+1))fail();
  if(checkpoint.input_cursor&&next&&(next.contract!==checkpoint.input_cursor.contract||next.asOf!==checkpoint.input_cursor.asOf||next.pageSize!==checkpoint.input_cursor.pageSize))fail();
  const records=[];
  for(const record of batch.records){
    const inserted=await client.query('INSERT INTO opportunity_catalog.funding_cycle_seen(cycle_id,external_identifier) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING external_identifier',[checkpoint.cycle_id,record.externalIdentifier]);
    if(inserted.rowCount)records.push(record);
  }
  const duplicates=batch.duplicates+batch.records.length-records.length;
  await client.query('UPDATE opportunity_catalog.funding_batch SET next_cursor=$2 WHERE run_id=$1',[row.run_id,next]);
  await client.query(`UPDATE opportunity_catalog.funding_cycle SET received=received+$2,unique_count=unique_count+$3,
    duplicate_count=duplicate_count+$4,excluded_count=excluded_count+$5,invalid_count=invalid_count+$6,pages=pages+1,
    total_changed=total_changed OR (pages>0 AND remote_total IS DISTINCT FROM $7::integer),remote_total=$7,
    contract_hash=COALESCE(contract_hash,$8),reference_date=COALESCE(reference_date,$9::date) WHERE cycle_id=$1`,
    [checkpoint.cycle_id,batch.received,records.length,duplicates,batch.excluded,batch.failed,batch.remoteTotal,batch.contract,batch.asOf]);
  return records;
}
async function finish(client, row, createNext, refreshEnabled=false, enrichmentEnabled=false) {
  const checkpoint=await load(client,row.run_id);if(!checkpoint)return;
  if(checkpoint.input_cursor?.phase===require('./discoveryDetails').PHASE)return require('./discoveryDetails').finish(client,row,checkpoint,createNext,{enrichmentEnabled});
  if(refreshEnabled&&checkpoint.input_cursor?.phase==='KNOWN')return require('./refresh').finish(client,row,checkpoint,createNext,{enrichmentEnabled});
  const canonical=row.eu_writer_mode==='CANONICAL_V2';
  const cycle=(await client.query(`UPDATE opportunity_catalog.funding_cycle SET created_count=created_count+$2,
    updated_count=updated_count+$3,unchanged_count=unchanged_count+$4,failed_count=failed_count+$5${canonical?',review_count=review_count+$6':''}
    WHERE cycle_id=$1 AND status='RUNNING' RETURNING *`,[checkpoint.cycle_id,row.created_count,row.updated_count,row.unchanged_count,row.failed_count,...(canonical?[row.review_count]:[])])).rows[0];
  if(!cycle)fail();
  if((row.status==='SUCCESS'||row.error_code==='SOURCE_RECORDS_REJECTED')&&checkpoint.next_cursor){
    await createNext(checkpoint);return;
  }
  if(refreshEnabled&&(row.status==='SUCCESS'||row.error_code==='SOURCE_RECORDS_REJECTED')){
    const successor=await require('./refresh').next(client,checkpoint,{enrichmentEnabled});
    if(successor){await createNext(successor);return;}
    return require('./refresh').complete(client,checkpoint.cycle_id,row.error_code);
  }
  const inconsistent=cycle.total_changed||cycle.duplicate_count>0||cycle.remote_total!==null&&cycle.received!==cycle.remote_total;
  const status=row.status==='ERROR'||cycle.failed_count>0?'ERROR':inconsistent?'PARTIAL':'SUCCESS';
  await client.query('UPDATE opportunity_catalog.funding_cycle SET status=$2,error_code=$3,finished_at=clock_timestamp() WHERE cycle_id=$1',
    [checkpoint.cycle_id,status,row.error_code||(cycle.failed_count?'SOURCE_RECORDS_REJECTED':inconsistent?'SOURCE_COVERAGE_INCONSISTENT':null)]);
}
async function reconcile(client,canonicalV2=false) {
  await client.query(`UPDATE opportunity_catalog.funding_cycle c SET status='ERROR',error_code=r.error_code,finished_at=clock_timestamp(),
    (created_count,updated_count,unchanged_count,failed_count)=(SELECT COALESCE(sum(x.created_count),0),COALESCE(sum(x.updated_count),0),COALESCE(sum(x.unchanged_count),0),COALESCE(sum(x.failed_count),0)
      FROM opportunity_catalog.funding_batch z JOIN opportunity_catalog.funding_run x USING(run_id) WHERE z.cycle_id=c.cycle_id AND (z.input_cursor->>'phase') IS DISTINCT FROM 'KNOWN')
    FROM opportunity_catalog.funding_batch b JOIN opportunity_catalog.funding_run r USING(run_id)
    WHERE b.cycle_id=c.cycle_id AND c.status='RUNNING' AND r.status='ERROR' AND r.error_code IS DISTINCT FROM 'SOURCE_RECORDS_REJECTED'`);
  if(canonicalV2)await client.query(`UPDATE opportunity_catalog.funding_cycle c SET review_count=(SELECT COALESCE(sum(r.review_count),0) FROM opportunity_catalog.funding_batch b JOIN opportunity_catalog.funding_run r USING(run_id) WHERE b.cycle_id=c.cycle_id AND (b.input_cursor->>'phase') IS DISTINCT FROM 'KNOWN') WHERE c.status='ERROR' AND EXISTS(SELECT 1 FROM opportunity_catalog.funding_run parent WHERE parent.run_id=c.cycle_id AND parent.eu_writer_mode='CANONICAL_V2')`);
}
// Exclude child batches from the public history, but retain every row in storage.
const history=`SELECT r.*,c.status AS cycle_status,c.finished_at AS cycle_finished_at,c.received AS cycle_received,
 c.created_count AS cycle_created,c.updated_count AS cycle_updated,c.unchanged_count AS cycle_unchanged,c.failed_count AS cycle_failed,(to_jsonb(c)->>'review_count')::integer AS cycle_reviewed,
 c.error_code AS cycle_error,c.pages,c.unique_count,c.duplicate_count,c.excluded_count,c.invalid_count,c.remote_total,c.total_changed
 FROM opportunity_catalog.funding_run r LEFT JOIN opportunity_catalog.funding_batch b ON b.run_id=r.run_id
 LEFT JOIN opportunity_catalog.funding_cycle c ON c.cycle_id=r.run_id
 WHERE b.run_id IS NULL OR b.ordinal=1`;
module.exports={validateBatch,load,start,stage,finish,reconcile,history};
