'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const LOCK='SELECT pg_advisory_xact_lock(43001306,1)',DATABASE='c4g_f13_authority_synthetic_central';
const revision='043_opportunity_eu_writer_v2';
function fixture({limited=true,coordinatorFailure=null}={}){
 const state={drift:null,committed:false,locked:false,releaseLock:null,queries:[],checkpoints:[],loads:[],coordinators:0};
 const sourceRoot=path.resolve('output/ab-test-synthetic-source');
 const options={host:'127.0.0.1',port:15432,database:DATABASE};
 const identity=owner=>({database:DATABASE,session_user:owner?'proof_admin':'c4g_authority_runtime',current_user:owner?'proof_admin':'c4g_authority_runtime',limited:!owner&&limited});
 function classify(sql){return sql.includes('writer_permit')?'writer':sql.includes('funding_run')?'catalog':sql.includes('ADD COLUMN')?'schema':'authority';}
 async function query(sql,values,kind){
  state.queries.push({sql,values,kind});
  if(sql.includes('current_database()'))return {rows:[identity(kind==='owner')]};
  if(sql==='SELECT pg_backend_pid() AS pid')return {rows:[{pid:7191}]};
  if(sql.includes('FROM pg_stat_activity')){assert.deepEqual(Array.from(values),[7191]);return {rows:[{n:state.locked?1:0}]};}
  if(sql==='BEGIN')return {rows:[]};
  if(sql===LOCK){if(kind==='owner'){state.locked=true;return {rows:[]};}return new Promise(resolve=>{state.releaseLock=()=>resolve({rows:[]});});}
  if(sql==='ROLLBACK'||sql==='COMMIT'){if(kind==='owner'){state.drift=null;state.locked=false;state.releaseLock?.();}return {rows:[]};}
  if(sql.startsWith('REVOKE ')||sql.endsWith(' NOINHERIT')){state.committed=false;return {rows:[]};}
  if(/^(ALTER|GRANT) /.test(sql)){if(kind==='owner-pool')state.committed=true;else state.drift=classify(sql);return {rows:[]};}
  throw Error('Unexpected SQL in unit fixture');
 }
 function client(kind){return {query:(sql,values)=>query(sql,values,kind),release(){},on(){},removeListener(){}};}
 const pool=kind=>({options:{...options},query:(sql,values)=>query(sql,values,kind==='owner'?'owner-pool':kind),async connect(){return client(kind);}});
 const ownerPool=pool('owner');ownerPool.query=(sql,values)=>query(sql,values,sql.includes('current_database()')?'owner':'owner-pool');
 const readerPool=pool('reader'),authorityPool=pool('authority');
 const schema={async assertCentralSchema(c,v){assert.equal(v,revision);state.checkpoints.push(c);if(state.drift||state.committed){const code={schema:'CENTRAL_SCHEMA_DRIFT',authority:'AUTHORITY_SECURITY_DRIFT',catalog:'CATALOG_SECURITY_DRIFT',writer:'EU_WRITER_SECURITY_DRIFT'}[state.drift||'authority'];throw Object.assign(Error(code),{code});}return 'fresh-candidate-fingerprint';}};
 const coordinator={createAuthorityCoordinator({pool}){state.coordinators++;return {async withAuthority(callback){const c=await pool.connect();try{if(coordinatorFailure)throw coordinatorFailure;await schema.assertCentralSchema(c,revision);await c.query(LOCK);if(state.committed)throw Object.assign(Error('AUTHORITY_SECURITY_DRIFT'),{code:'AUTHORITY_SECURITY_DRIFT'});return await callback();}finally{c.release();}}};}};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'integration/central-snapshot-ab/authority-drift.cjs'),'utf8'),{
  module,exports:module.exports,process,URL,setTimeout,clearTimeout,require(name){state.loads.push(name);if(name==='node:path')return path;
   if(name===path.join(sourceRoot,'backend/src/security/centralSchemaManifest.js'))return schema;
   if(name===path.join(sourceRoot,'backend/src/security/authorityCoordinator.js'))return coordinator;
   throw Error('Legacy metadata/SQL adapter must not be imported: '+name);
  }
 },{filename:'authority-drift.cjs'});
 return {state,api:module.exports,args:{sourceRoot,ownerPool,readerPool,authorityPool,revision,permitSecret:'s'.repeat(40),ownership:{isolated:true,runId:'a'.repeat(32),centralDatabase:DATABASE}}};
}
test('actual candidate collector replaces the historical seven-query textual contract',async()=>{
 const f=fixture();const report=await f.api.validateMetadataDrift(f.args);
 assert.equal(report.status,'PASS');assert.equal(report.transactional.length,5);assert.equal(report.postLock.length,2);
 assert(report.transactional.every(row=>row.rejected===true&&row.restored===true));
 assert(report.postLock.every(row=>row.realBlockedAuthorityTransactions===1&&row.mutationAfterPreflight===true&&row.functionalCallbackExecuted===false&&row.restored===true));
 assert(f.state.checkpoints.length>=19);assert.equal(f.state.coordinators,2);
 assert.equal(f.state.loads.filter(name=>name.endsWith('centralSchemaManifest.js')).length,1);
 assert.equal(f.state.loads.filter(name=>name.endsWith('authorityCoordinator.js')).length,1);
 assert(!f.state.loads.some(name=>name.endsWith('metadata.cjs')));assert.equal(report.cleanupErrors.length,0);
});
test('fixture ownership is refused before importing runtime or issuing SQL',async()=>{
 const f=fixture();f.args.ownership.isolated=false;
 await assert.rejects(()=>f.api.validateMetadataDrift(f.args),{code:'METADATA_OWNED_FIXTURE_REQUIRED'});
 assert.equal(f.state.queries.length,0);assert(!f.state.loads.some(name=>name.endsWith('centralSchemaManifest.js')));
});
test('a real limited-login identity is required before a candidate checkpoint',async()=>{
 const f=fixture({limited:false});
 await assert.rejects(()=>f.api.validateMetadataDrift(f.args),{code:'METADATA_RUNTIME_ROLE_REQUIRED'});
 assert.equal(f.state.checkpoints.length,0);
});
test('coordinator failures preserve evidence and release the owned blocker',async()=>{
 const error=Object.assign(Error('SYNTHETIC_COORDINATOR_FAILURE'),{code:'SYNTHETIC_COORDINATOR_FAILURE'}),f=fixture({coordinatorFailure:error});
 await assert.rejects(()=>f.api.validateMetadataDrift(f.args),actual=>actual===error&&actual.metadataDriftReport.status==='FAIL');
 assert.equal(f.state.locked,false);assert.equal(f.state.committed,false);
 assert(f.state.queries.some(row=>row.kind==='owner'&&row.sql==='ROLLBACK'));
});
