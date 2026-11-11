'use strict';
const assert=require('node:assert/strict');
const {Pool}=require('../../../backend/node_modules/pg');
const {applyCentralMigrations}=require('../../../backend/scripts/runCentralMigrations');
const {manifest}=require('../../../backend/src/security/centralMigrationManifest');

const ORG='abababab-abab-4bab-8bab-abababababab';
const OUTBOX='abababab-abab-4bab-8bab-ababababab01';
const EXECUTION='abababab-abab-4bab-8bab-ababababab02';
const DEAD='abababab-abab-4bab-8bab-ababababab03';
const MODERN='abababab-abab-4bab-8bab-ababababab04';
const DIGEST='a'.repeat(64);

async function tx(pool,work){const client=await pool.connect();try{await client.query('BEGIN');const value=await work(client);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}}

async function main(){
 const source=new URL(process.env.F12_GATE_URL);source.pathname='/f12_synthetic_legacy';
 const pool=new Pool({connectionString:source.toString(),max:2});
 try{
  const envelope={envelopeVersion:2,jobType:'opportunity.duplicate.scan',jobVersion:1,payloadVersion:1,
   executionId:EXECUTION,organizationId:ORG,actor:{type:'SERVICE',id:'legacy'},operationCode:'OPPORTUNITY_DUPLICATE_SCAN_JOB',
   idempotencyKey:'legacy-published',correlationId:EXECUTION,causationId:EXECUTION,createdAt:'2030-01-01T00:00:00.000Z',deadlineAt:'2030-01-02T00:00:00.000Z',payload:{legacy:true},observability:{version:2,traceparent:'00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',links:[]}};
  await pool.query(`INSERT INTO async_exec.outbox(outbox_id,organization_id,logical_id,envelope,digest_sha256,state,available_at,published_at) VALUES($1,$2,'legacy-published',$3,$4,'PUBLISHED',clock_timestamp(),clock_timestamp())`,[OUTBOX,ORG,envelope,DIGEST]);
  await pool.query(`INSERT INTO async_exec.execution(execution_id,organization_id,outbox_id,job_type,state,attempt,deadline_at,result_code) VALUES($1,$2,$3,'opportunity.duplicate.scan','DEAD_LETTER',3,clock_timestamp()+'1 day'::interval,'PERMANENT')`,[EXECUTION,ORG,OUTBOX]);
  await pool.query(`INSERT INTO async_exec.dead_letter(dead_letter_id,execution_id,organization_id,job_type,envelope_version,job_version,payload_version,classification,attempts,correlation_id,causation_id,digest_sha256,detail_code) VALUES($1,$2,$3,'opportunity.duplicate.scan',2,1,1,'PERMANENT',3,$2,$2,$4,'LEGACY')`,[DEAD,EXECUTION,ORG,DIGEST]);
  const lineageIndex=manifest.findIndex(entry=>entry.version==='007_f9_execution_lineage');
  assert.notEqual(lineageIndex,-1);
  assert.deepEqual(await applyCentralMigrations(pool),manifest.slice(lineageIndex).map(entry=>entry.version));
  const legacy=(await pool.query(`SELECT e.attempt,e.lineage_version,o.state AS outbox_state,o.lineage_version AS outbox_lineage,d.lineage_version AS dead_lineage FROM async_exec.execution e JOIN async_exec.outbox o ON o.outbox_id=e.outbox_id JOIN async_exec.dead_letter d ON d.execution_id=e.execution_id WHERE e.execution_id=$1`,[EXECUTION])).rows[0];
  assert.deepEqual(legacy,{attempt:3,lineage_version:0,outbox_state:'PUBLISHED',outbox_lineage:0,dead_lineage:0});
  await pool.query(`INSERT INTO async_exec.execution(execution_id,organization_id,job_type,state,attempt,deadline_at,lineage_version,delivery_kind,root_execution_id,content_digest,envelope_digest) VALUES($1,$2,'opportunity.duplicate.scan','QUEUED',1,clock_timestamp()+'1 day'::interval,1,'INITIAL',$1,$3,$3)`,[MODERN,ORG,DIGEST]);
  assert.equal((await pool.query('SELECT lineage_version FROM async_exec.execution WHERE execution_id=$1',[MODERN])).rows[0].lineage_version,1);
  assert.deepEqual(await applyCentralMigrations(pool),[]);
  process.stdout.write(`${JSON.stringify({legacyLineage:true,attemptPreserved:3,publishedOutboxPreserved:true,deadLetterPreserved:true,modernLineage:true,canonicalRunner:true,idempotent:true})}\n`);
 }finally{await pool.end();}
}
main().catch(error=>{process.stderr.write(`${error.stack||error}\n`);process.exitCode=1;});
