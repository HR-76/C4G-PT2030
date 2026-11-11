'use strict';
// Disposable PostgreSQL proof. Never connects to a configured APP database.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {Client}=require('../../../backend/node_modules/pg');
const refresh=require('../../../backend/src/fundingTenders/refresh');
const detail=require('../../../backend/src/fundingTenders/discoveryDetails');
const root=path.resolve(__dirname,'../../..'),id=randomUUID(),name='c4g-eu-conflict-'+id;
const reportFile=path.join(root,'output','eu-conflict-diagnostics-gate-'+id,'verification.json');
const sha=file=>createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}).trim();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 fs.mkdirSync(path.dirname(reportFile),{recursive:false});
 const report={kind:'eu-conflict-diagnostics-pg-proof-v1',id,status:'IN_PROGRESS',isolated:true,habitualEnvironmentAccess:false,
  startedAt:new Date().toISOString(),postgresImage:'postgres:18-alpine',checks:[],inputs:Object.fromEntries([
   'backend/src/fundingTenders/source.js','backend/src/fundingTenders/conflictDiagnostics.js',
   'backend/src/fundingTenders/refresh.js','backend/src/fundingTenders/discoveryDetails.js',
   'backend/src/fundingTenders/resolutions.js','test/integration/funding-tenders/conflict-diagnostics-proof.cjs'
  ].map(file=>[file,sha(file)]))};
 const password=randomBytes(32).toString('hex');let containerId=null,client=null;
 const check=(name,condition)=>{assert(condition,name);report.checks.push(name);};
 try{
  containerId=docker(['run','--detach','--pull','never','--name',name,'--label','c4g.test=eu-conflict-diagnostics','--label','c4g.test.id='+id,
   '--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD='+password,'postgres:18-alpine']);
  check('OWN_CONTAINER_ID',/^[a-f0-9]{64}$/.test(containerId));
  const inspect=docker(['inspect','--format','{{.Name}}|{{index .Config.Labels "c4g.test"}}|{{index .Config.Labels "c4g.test.id"}}',containerId]);
  check('OWN_CONTAINER_SCOPE',inspect==='/'+name+'|eu-conflict-diagnostics|'+id);
  const published=docker(['port',containerId,'5432/tcp']);
  const match=/^127\.0\.0\.1:(\d+)$/.exec(published);
  check('LOOPBACK_ONLY',Boolean(match));
  const port=Number(match[1]);let connected=false;
  for(let n=0;n<30;n++){
   client=new Client({host:'127.0.0.1',port,database:'postgres',user:'postgres',password,connectionTimeoutMillis:1000});
   try{await client.connect();connected=true;break;}catch{await client.end().catch(()=>{});client=null;await sleep(500);}
  }
  check('PG_READY',connected);
  const version=(await client.query('SHOW server_version')).rows[0].server_version;
  check('PG18',version.startsWith('18.'));
  await client.query(`CREATE SCHEMA opportunity_catalog;
    CREATE TABLE opportunity_catalog.funding_batch(
      run_id uuid PRIMARY KEY,cycle_id uuid NOT NULL,input_cursor jsonb NOT NULL,
      next_cursor jsonb CHECK(next_cursor IS NULL OR jsonb_typeof(next_cursor)='object' AND octet_length(next_cursor::text)<=2048));
    CREATE TABLE opportunity_catalog.funding_refresh_target(
      cycle_id uuid NOT NULL,external_identifier text NOT NULL,state text NOT NULL,
      run_id uuid,observed_at timestamptz,received integer,
      PRIMARY KEY(cycle_id,external_identifier));`);
  check('PHYSICAL_JSONB_LIMIT',true);
  const observation='2026-10-31T16:34:00.000Z';
  const make=async(phase='KNOWN')=>{
   const run={run_id:randomUUID(),checkpoint:{cycle_id:randomUUID(),input_cursor:{phase,externalIdentifier:'CASCADE:17045'}}};
   await client.query('INSERT INTO opportunity_catalog.funding_batch(run_id,cycle_id,input_cursor) VALUES($1,$2,$3)',
    [run.run_id,run.checkpoint.cycle_id,run.checkpoint.input_cursor]);
   await client.query("INSERT INTO opportunity_catalog.funding_refresh_target(cycle_id,external_identifier,state) VALUES($1,$2,'PENDING')",
    [run.checkpoint.cycle_id,'CASCADE:17045']);return run;
  };
  const known=await make();
  await client.query('BEGIN');
  check('KNOWN_STAGES_NO_RECORDS',(await refresh.stage(client,known,{outcome:'CONFLICT',conflictReasons:['SOURCE_VARIANTS_DIVERGE'],received:2,observedAt:observation},{canonicalV2:true})).length===0);
  await client.query('COMMIT');
  const persisted=(await client.query('SELECT next_cursor FROM opportunity_catalog.funding_batch WHERE run_id=$1',[known.run_id])).rows[0].next_cursor;
  check('KNOWN_CAUSE_DURABLE',persisted.phase==='KNOWN_RESULT'&&persisted.outcome==='CONFLICT'&&persisted.conflictReasons?.join()==='SOURCE_VARIANTS_DIVERGE');
  check('KNOWN_TARGET_DURABLE',(await client.query('SELECT state FROM opportunity_catalog.funding_refresh_target WHERE cycle_id=$1',[known.checkpoint.cycle_id])).rows[0].state==='CONFLICT');
  await client.query('BEGIN');
  await assert.rejects(refresh.stage(client,known,{outcome:'CONFLICT',conflictReasons:['LOOKUP_TRUNCATED'],received:1,observedAt:observation},{canonicalV2:true}),{code:'FUNDING_CHECKPOINT_INVALID'});
  await client.query('ROLLBACK');
  check('REPLAY_RETAINS_CAUSE',(await client.query('SELECT next_cursor FROM opportunity_catalog.funding_batch WHERE run_id=$1',[known.run_id])).rows[0].next_cursor.conflictReasons.join()==='SOURCE_VARIANTS_DIVERGE');
  const wrong=await make('OTHER');
  await client.query('BEGIN');
  await assert.rejects(refresh.stage(client,wrong,{outcome:'CONFLICT',conflictReasons:['STATUS_UNRECOGNIZED'],received:1,observedAt:observation},{canonicalV2:true}),{code:'FUNDING_CHECKPOINT_INVALID'});
  await client.query('ROLLBACK');
  check('PHASE_MISMATCH_ROLLBACK',(await client.query('SELECT state FROM opportunity_catalog.funding_refresh_target WHERE cycle_id=$1',[wrong.checkpoint.cycle_id])).rows[0].state==='PENDING');
  check('NO_ORPHAN_DIAGNOSTIC',(await client.query('SELECT next_cursor FROM opportunity_catalog.funding_batch WHERE run_id=$1',[wrong.run_id])).rows[0].next_cursor===null);
  const candidate={run_id:randomUUID(),checkpoint:{cycle_id:randomUUID(),input_cursor:{phase:'DISCOVERY_DETAIL',externalIdentifier:'NEW'}}};
  await client.query('INSERT INTO opportunity_catalog.funding_batch(run_id,cycle_id,input_cursor) VALUES($1,$2,$3)',[candidate.run_id,candidate.checkpoint.cycle_id,candidate.checkpoint.input_cursor]);
  await client.query('BEGIN');
  check('DETAIL_STAGES_NO_RECORDS',(await detail.stage(client,candidate,{outcome:'CONFLICT',conflictReasons:['CANONICAL_TITLE_CONFLICT'],received:1,observedAt:observation},{enrichmentEnabled:true})).length===0);
  await client.query('COMMIT');
  const detailProof=(await client.query('SELECT next_cursor FROM opportunity_catalog.funding_batch WHERE run_id=$1',[candidate.run_id])).rows[0].next_cursor;
  check('DETAIL_CAUSE_DURABLE',detailProof.phase==='DISCOVERY_DETAIL_RESULT'&&detailProof.conflictReasons?.join()==='CANONICAL_TITLE_CONFLICT');
  check('NO_UNPLANNED_TABLES',(await client.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='opportunity_catalog'")).rows[0].n===2);
  report.status='PASS';report.postgresVersion=version;
 }catch(error){report.status='FAIL';report.failure=/^[A-Z0-9_]{3,100}$/.test(error.code||'')?error.code:'EU_CONFLICT_DIAGNOSTICS_GATE_FAILED';process.exitCode=1;}
 finally{
  if(client)await client.end().catch(()=>{});
  if(containerId){
   try{const inspect=docker(['inspect','--format','{{.Name}}|{{index .Config.Labels "c4g.test"}}|{{index .Config.Labels "c4g.test.id"}}',containerId]);
    assert.equal(inspect,'/'+name+'|eu-conflict-diagnostics|'+id);docker(['rm','--force','--volumes',containerId]);
    report.cleanup=true;
   }catch{report.cleanup=false;report.status='FAIL';process.exitCode=1;}
  }
  report.completedAt=new Date().toISOString();fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,cleanup:report.cleanup===true,
   evidence:path.relative(root,reportFile).replaceAll('\\','/'),failure:report.failure||null}));
 }
}
if(require.main===module)main().catch(()=>{console.error('EU_CONFLICT_DIAGNOSTICS_GATE_FAILED');process.exitCode=1;});
