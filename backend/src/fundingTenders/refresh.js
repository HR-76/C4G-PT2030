'use strict';
const {normaliseProgramme}=require('../utils/programmeMapping');
const {selection}=require('./programmes');
function invalid(){throw Object.assign(new Error('FUNDING_CHECKPOINT_INVALID'),{code:'FUNDING_CHECKPOINT_INVALID'});}
async function start(client,cycleId,source,{canonicalV2=false}={}){
 const programmes=[...new Set(selection(source).map(normaliseProgramme))];
 await client.query('UPDATE opportunity_catalog.funding_cycle SET refresh_enabled=true WHERE cycle_id=$1',[cycleId]);
 await client.query(`INSERT INTO opportunity_catalog.funding_refresh_target(cycle_id,external_identifier)
 SELECT $1,f.external_identifier FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id)
 WHERE f.external_identifier !~ '^(POCTEP|INTERREG_EUROPE):' AND ($3::boolean=false OR to_jsonb(o)->>'current_schema_version'='2')
 AND ($2::text[]='{}'::text[] OR f.last_source_fields->>'programmeName'=ANY($2::text[]))`,[cycleId,programmes,canonicalV2]);
 if(canonicalV2)await client.query(`INSERT INTO opportunity_catalog.funding_refresh_target(cycle_id,external_identifier)
 SELECT $1,s.external_identifier FROM opportunity_catalog.source_identity_v2 s JOIN opportunity_catalog.opportunity o USING(opportunity_id)
 JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id AND r.opportunity_id=o.opportunity_id
 WHERE s.source_namespace='EU_FUNDING_TENDERS' AND o.current_schema_version=2 AND r.snapshot->>'schemaVersion'='2' AND ($2::text[]='{}'::text[] OR EXISTS(
 SELECT 1 FROM jsonb_array_elements(CASE WHEN r.snapshot->'programmes'->>'state'='PRESENT' THEN r.snapshot->'programmes'->'value' ELSE '[]'::jsonb END) p
 WHERE p->>'scheme'='EU_FRAMEWORK_PROGRAMME' AND (p->>'sourceId'=ANY($3::text[]) OR p->>'code'=ANY($3::text[]))))
 ON CONFLICT(cycle_id,external_identifier) DO NOTHING`,[cycleId,programmes,selection(source)]);
}
async function next(client,checkpoint,{enrichmentEnabled=false}={}){
 const cycle=(await client.query('SELECT refresh_enabled FROM opportunity_catalog.funding_cycle WHERE cycle_id=$1',[checkpoint.cycle_id])).rows[0];
 if(!cycle?.refresh_enabled)return null;
 const target=(await client.query("SELECT external_identifier FROM opportunity_catalog.funding_refresh_target WHERE cycle_id=$1 AND state IN ('PENDING','DISCOVERED') ORDER BY external_identifier LIMIT 1",[checkpoint.cycle_id])).rows[0];
 return target?{...checkpoint,next_cursor:{phase:'KNOWN',externalIdentifier:target.external_identifier}}:enrichmentEnabled?require('./discoveryDetails').next(client,checkpoint):null;
}
async function discovered(client,checkpoint,records,{enrichmentEnabled=false}={}){
 if(!records.length)return records;
 // Existing records are verified by exact identity before any mutation. An open
 // search hit cannot overwrite an older record when another published version
 // (outside discovery) contradicts it.
 const deferred=await client.query("UPDATE opportunity_catalog.funding_refresh_target SET state='DISCOVERED' WHERE cycle_id=$1 AND external_identifier=ANY($2::text[]) AND state='PENDING' RETURNING external_identifier",[checkpoint.cycle_id,records.map(r=>r.externalIdentifier)]);
 if(enrichmentEnabled){await require('./discoveryDetails').enqueue(client,checkpoint,records);return [];}
 const ids=new Set(deferred.rows.map(row=>row.external_identifier));
 return records.filter(record=>!ids.has(record.externalIdentifier));
}
async function stage(client,run,batch,{resolutionEnabled=false,enrichmentEnabled=false,canonicalV2=false}={}){
 if(run.checkpoint?.input_cursor?.phase===require('./discoveryDetails').PHASE)return require('./discoveryDetails').stage(client,run,batch,{resolutionEnabled,enrichmentEnabled});
 const checkpoint=run.checkpoint,id=checkpoint.input_cursor.externalIdentifier;
 if(!['FOUND','CONFLICT','ABSENT','ERROR'].includes(batch.outcome)||!Number.isSafeInteger(batch.received)||batch.received<0||batch.received>25||!Number.isFinite(Date.parse(batch.observedAt))||batch.outcome==='FOUND'&&batch.record?.externalIdentifier!==id)invalid();
 if(resolutionEnabled&&!canonicalV2)batch=await require('./resolutions').retainResolution(client,id,batch,{enrichmentEnabled});
 const conflictReasons=require('./conflictDiagnostics').validate(batch.outcome,batch.conflictReasons);
 const changed=await client.query("UPDATE opportunity_catalog.funding_refresh_target SET state=$3,run_id=$4,observed_at=$5,received=$6 WHERE cycle_id=$1 AND external_identifier=$2 AND state IN ('PENDING','DISCOVERED') RETURNING external_identifier",[checkpoint.cycle_id,id,batch.outcome==='FOUND'?'STAGED':batch.outcome,run.run_id,batch.observedAt,batch.received]);
 if(changed.rowCount!==1)invalid();
 if(conflictReasons){
  const diagnostic=await client.query(`UPDATE opportunity_catalog.funding_batch
    SET next_cursor=COALESCE(next_cursor,'{}'::jsonb)||jsonb_build_object('phase','KNOWN_RESULT','outcome','CONFLICT','received',$4::integer,'observedAt',$5::text,'conflictReasons',$6::text[])
    WHERE run_id=$1 AND cycle_id=$2 AND input_cursor->>'phase'='KNOWN' AND input_cursor->>'externalIdentifier'=$3 RETURNING run_id`,
  [run.run_id,checkpoint.cycle_id,id,batch.received,batch.observedAt,conflictReasons]);
  if(diagnostic.rowCount!==1)invalid();
 }
 if(batch.outcome!=='FOUND'&&!canonicalV2)await client.query('UPDATE opportunity_catalog.funding_identity SET source_review=$2,source_reviewed_at=$3 WHERE external_identifier=$1',[id,batch.outcome,batch.observedAt]);
 return batch.outcome==='FOUND'?[batch.record]:[];
}
async function finish(client,row,checkpoint,createNext,{enrichmentEnabled=false}={}){
 if(row.status==='ERROR'){
  await client.query("UPDATE opportunity_catalog.funding_refresh_target SET state='ERROR',run_id=$3 WHERE cycle_id=$1 AND external_identifier=$2",[checkpoint.cycle_id,checkpoint.input_cursor.externalIdentifier,row.run_id]);
 }
 await client.query(`UPDATE opportunity_catalog.funding_refresh_target SET state=CASE WHEN $3='ERROR' THEN 'ERROR' ELSE COALESCE((SELECT i.result FROM opportunity_catalog.funding_run_item i WHERE i.run_id=$2 AND i.external_identifier=funding_refresh_target.external_identifier),'ERROR') END WHERE cycle_id=$1 AND run_id=$2 AND state='STAGED'`,[checkpoint.cycle_id,row.run_id,row.status]);
 if(row.eu_writer_mode!=='CANONICAL_V2')await client.query("UPDATE opportunity_catalog.funding_identity f SET source_review=NULL,source_reviewed_at=t.observed_at FROM opportunity_catalog.funding_refresh_target t WHERE t.cycle_id=$1 AND t.run_id=$2 AND t.external_identifier=f.external_identifier AND t.state IN ('UPDATED','UNCHANGED')",[checkpoint.cycle_id,row.run_id]);
 const successor=await next(client,checkpoint,{enrichmentEnabled});
 if(successor&&row.status==='SUCCESS'){await createNext(successor);return;}
 await complete(client,checkpoint.cycle_id,row.error_code);
}
async function complete(client,cycleId,error=null){
 await client.query(`UPDATE opportunity_catalog.funding_cycle c SET status=CASE WHEN $2::text IS NOT NULL OR failed_count>0 THEN 'ERROR'
 WHEN total_changed OR duplicate_count>0 OR (remote_total IS NOT NULL AND received<>remote_total) OR EXISTS(SELECT 1 FROM opportunity_catalog.funding_refresh_target t WHERE t.cycle_id=c.cycle_id AND t.state IN ('CONFLICT','ABSENT','ERROR','PENDING','DISCOVERED','STAGED','REVIEW'))
 OR (${require('./discoveryDetails').requiresReviewSql}) THEN 'PARTIAL' ELSE 'SUCCESS' END,
 error_code=COALESCE($2,CASE WHEN failed_count>0 THEN 'SOURCE_RECORDS_REJECTED' WHEN EXISTS(SELECT 1 FROM opportunity_catalog.funding_refresh_target t WHERE t.cycle_id=c.cycle_id AND t.state IN ('CONFLICT','ABSENT','ERROR','PENDING','DISCOVERED','STAGED','REVIEW')) THEN 'SOURCE_KNOWN_REVIEW_REQUIRED'
 WHEN (${require('./discoveryDetails').requiresReviewSql}) THEN 'SOURCE_DISCOVERY_REVIEW_REQUIRED'
 WHEN total_changed OR duplicate_count>0 OR (remote_total IS NOT NULL AND received<>remote_total) THEN 'SOURCE_COVERAGE_INCONSISTENT' END),finished_at=clock_timestamp() WHERE cycle_id=$1`,[cycleId,error]);
}
async function reconcile(client){
 await client.query(`UPDATE opportunity_catalog.funding_refresh_target t SET state='ERROR',run_id=r.run_id
 FROM opportunity_catalog.funding_batch b JOIN opportunity_catalog.funding_run r USING(run_id)
 WHERE b.cycle_id=t.cycle_id AND b.input_cursor->>'phase'='KNOWN' AND b.input_cursor->>'externalIdentifier'=t.external_identifier
 AND r.status='ERROR' AND t.state IN ('PENDING','DISCOVERED','STAGED') RETURNING t.external_identifier`);
}
module.exports={start,next,discovered,stage,finish,complete,reconcile};
