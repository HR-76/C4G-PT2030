'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const normative=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../context/references/opportunity-v2/evidence/eu-11145.json'),'utf8'));
function transport(){
 let selected='UNCHANGED',barrier=null,titleUpdated=false;
 const calls=[];
 const variant=(id='11145')=>{const value=structuredClone(normative.results[0]);value.metadata.callccm2Id=[id];return value;};
 async function fetchImpl(url,options){
  assert.equal(new URL(url).origin,'https://api.tech.ec.europa.eu');assert.equal(options.method,'POST');
  const query=await options.body.get('query').text(),parsed=JSON.parse(query);
  let id;const visit=value=>{if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){if(key==='callccm2Id'&&!Array.isArray(item))id=String(item);else visit(item);}};visit(parsed);
  // The exact source lookup has a term. Discovery uses only the allowed list
  // query and is deliberately small, still processed by production P3 logic.
  id=id||null;calls.push({mode:selected,lookup:Boolean(id),externalIdentifier:id?'CASCADE:'+id:null});
  if(barrier&&id){const wait=barrier;barrier=null;await wait();}
  if(selected==='ERROR'&&id)return new Response('{"invalid":true}',{status:200,headers:{'content-type':'application/json'}});
  const rows=[];
  if(id){
   const item=variant(id);
   if(titleUpdated&&id==='11145'){item.content+=' — isolated safe factual update';item.metadata.callTitle=[item.content];}
   if(selected==='ROLLBACK'&&id==='11145'){item.content+=' with transaction failure';item.metadata.callTitle=[item.content];}
   if(selected==='LOSS')delete item.metadata.budget;
   rows.push(item);
  }else if(selected==='NEW')rows.push(variant('9911145'));
  return new Response(JSON.stringify({...normative,results:rows,totalResults:rows.length,pageNumber:1,pageSize:25}),{status:200,headers:{'content-type':'application/json'}});
 }
 return {fetchImpl,calls,select(value){assert(['UNCHANGED','CHANGED','NEW','LOSS','ERROR','ROLLBACK'].includes(value));selected=value;if(value==='CHANGED')titleUpdated=true;},pauseNextLookup(wait){barrier=wait;}};
}
async function queue(central,connection,report){
 const target=new URL('postgresql://127.0.0.1');target.port=String(connection.port);target.username=connection.user;target.password=connection.password;target.pathname='/registered_central';
 const {PgBoss}=await import('../../../backend/node_modules/pg-boss/dist/index.js');
 const boss=new PgBoss({connectionString:target.toString(),supervise:false,schedule:false});await boss.start();await boss.createQueue('eu-writer-proof-refresh');await boss.stop();
 const version=Number((await central.query('SELECT version FROM pgboss.version')).rows[0].version);
 report.queue={realPgBoss:true,schemaVersion:version};
 return require('../../../backend/src/async/adapters/pgBossQueueAdapter').createPgBossQueueAdapter({connectionString:target.toString(),queueMap:{'funding_tenders.refresh':'eu-writer-proof-refresh'},inspectSchema:async()=>({schema:'pgboss',schemaVersion:version})});
}
async function head(central,id){return(await central.query('SELECT o.opportunity_id,o.current_revision_id,o.revision_number,o.row_version,o.current_schema_version,o.content_digest,r.snapshot FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id WHERE o.opportunity_id=$1',[id])).rows[0];}
async function legacyReviewFixture(central,fixture){
 const {randomUUID}=require('node:crypto'),opportunityId=randomUUID(),revisionId=randomUUID();
 const snapshot={...fixture.legacy.snapshot,title:'Second synthetic legacy opportunity',provenanceId:randomUUID()};
 const c=await central.connect();try{await c.query('BEGIN');
  await c.query("INSERT INTO opportunity_catalog.opportunity(opportunity_id,current_revision_id,revision_number,row_version,lifecycle_state,validation_state,title,funder_name,quality_score,quality_bucket,content_digest,normalization_version,quality_rule_version) VALUES($1,$2,1,1,'ACTIVE','PENDING_REVIEW',$3,$4,0,'LOW',$5,'opportunity-normalization-v1','opportunity-quality-v1')",[opportunityId,revisionId,snapshot.title,snapshot.funderName,'b'.repeat(64)]);
  await c.query("INSERT INTO opportunity_catalog.revision(revision_id,opportunity_id,revision_number,row_version,snapshot,normalized_projection,quality_projection,content_digest) VALUES($1,$2,1,1,$3,'{}','{}',$4)",[revisionId,opportunityId,snapshot,'b'.repeat(64)]);
  await c.query("INSERT INTO opportunity_catalog.funding_identity(external_identifier,opportunity_id,last_source_fields,observed_at,last_run_id) VALUES('CASCADE:9911146',$1,$2,clock_timestamp(),$3)",[opportunityId,snapshot,fixture.legacyRunId]);
  await c.query('COMMIT');
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 return {opportunityId,revisionId,snapshot};
}
async function runCycle({central,repository,worker,actor,source='EU_FUNDING_TENDERS'}){
 const run=await repository.enqueue(actor.id,require('node:crypto').randomUUID(),source);
 const results=[];
 for(let step=0;step<16;step++){
  results.push(await worker.runOnce());
  const pending=Number((await central.query("SELECT count(*) AS n FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING')")).rows[0].n);
  if(pending===0)return {run,results,runs:(await central.query('SELECT r.* FROM opportunity_catalog.funding_run r LEFT JOIN opportunity_catalog.funding_batch b USING(run_id) WHERE r.run_id=$1 OR b.cycle_id=$1 ORDER BY r.created_at,r.run_id',[run.runId])).rows};
 }
 throw Error('EU_WRITER_CYCLE_DID_NOT_DRAIN');
}
module.exports={transport,queue,head,runCycle,legacyReviewFixture};
