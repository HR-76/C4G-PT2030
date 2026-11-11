'use strict';
// Diagnostic gates for an explicitly owned fixture. No mutation belongs to M/H.
const path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const REVISION='034_application_snapshot_v2';
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>Object.assign(Error(code),{code});
const safeCode=error=>[error?.internalCode,error?.code,error?.message].find(x=>/^[A-Z][A-Z0-9_]{0,79}$/.test(x||''))||'TENANT_AB_PROOF_FAILED';
function endpoint(pool){
 if(!pool?.options||typeof pool.query!=='function'||typeof pool.connect!=='function')throw fail('TENANT_AB_OWNED_FIXTURE_REQUIRED');
 let {host,port,database,connectionString}=pool.options;
 if(connectionString){let u;try{u=new URL(connectionString);}catch{throw fail('TENANT_AB_OWNED_FIXTURE_REQUIRED');}
  const db=decodeURIComponent(u.pathname.slice(1));
  if(!['postgres:','postgresql:'].includes(u.protocol)||u.search||u.hash||(host&&host!==u.hostname)||(port&&Number(port)!==Number(u.port))||(database&&database!==db))throw fail('TENANT_AB_OWNED_FIXTURE_REQUIRED');
  host=u.hostname;port=u.port;database=db;
 }
 if(host!=='127.0.0.1'||!Number.isInteger(Number(port))||Number(port)<1024||Number(port)>65535||[5432,5433].includes(Number(port)))throw fail('TENANT_AB_OWNED_FIXTURE_REQUIRED');
 return {host,port:Number(port),database};
}
function assertTenantFixture(fixture){
 if(fixture?.ownership?.isolated!==true||!/^[a-f0-9]{32}$/.test(fixture.ownership.runId||'')||fixture.ownership.centralDatabase!=='c4g_f13_authority_synthetic_central'||!Array.isArray(fixture.tenants)||fixture.tenants.length!==2)throw fail('TENANT_AB_OWNED_FIXTURE_REQUIRED');
 const central=endpoint(fixture.central?.pool),identities=new Set();
 if(central.database!==fixture.ownership.centralDatabase)throw fail('TENANT_AB_OWNED_FIXTURE_REQUIRED');
 for(let index=0;index<2;index++){
  const tenant=fixture.tenants[index],credentials=tenant?.credentials,organization=tenant?.organizationId;
  if(tenant?.index!==index||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(organization||'')||tenant.identity?.tenantId!==organization||typeof tenant.identity?.databaseGenerationId!=='string'||identities.has(organization))throw fail('TENANT_AB_OWNED_FIXTURE_REQUIRED');
  identities.add(organization);const owner=endpoint(tenant.pool),suffix=organization.replaceAll('-','');
  if(owner.host!==central.host||owner.port!==central.port||owner.database!=='c4g_onb_'+suffix||!credentials||credentials.host!==owner.host||Number(credentials.port)!==owner.port||credentials.database!==owner.database||credentials.login!=='c4g_onb_api_'+suffix||typeof credentials.password!=='string'||!credentials.password||credentials.ssl!==false)throw fail('TENANT_AB_OWNED_FIXTURE_REQUIRED');
 }
}
function loadTenant(root){
 const base=path.resolve(root,'backend/src/security');
 const entry=require(path.join(base,'tenantMigrationManifest.js')).registeredManifest.find(x=>x.version===REVISION);
 if(!entry||!/^[a-f0-9]{64}$/.test(entry.schemaFingerprint))throw fail('TENANT_AB_REVISION_REQUIRED');
 return {schema:require(path.join(base,'tenantSchemaFingerprint.js')),runtime:require(path.join(base,'tenantRuntimeMetadata.js')),entry};
}
function createLimitedPool(root,tenant){
 const {Pool}=require(path.resolve(root,'backend/node_modules/pg')),{host,port,database,login,password,ssl}=tenant.credentials;
 return new Pool({host,port:Number(port),database,user:login,password,ssl,max:1});
}
async function verifyLimited(client,tenant){
 const row=(await client.query(`SELECT current_database() AS database,session_user,current_user,
  NOT(rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit) AND rolcanlogin AS limited,
  pg_has_role(session_user,'c4g_tenant_api_capabilities','MEMBER') AS api_member,
  NOT pg_has_role(session_user,'pg_read_all_data','MEMBER') AS no_broad_reader,
  current_setting('transaction_read_only') AS read_only FROM pg_roles WHERE rolname=current_user`)).rows[0];
 if(!row||row.database!==tenant.credentials.database||row.session_user!==tenant.credentials.login||row.current_user!==row.session_user||row.limited!==true||row.api_member!==true||row.no_broad_reader!==true||row.read_only!=='on')throw fail('TENANT_AB_LIMITED_LOGIN_REQUIRED');
}
function compareSnapshots(a,b){
 const x=JSON.stringify(a),y=JSON.stringify(b);
 if(x!==y)throw fail('TENANT_AB_SNAPSHOT_MISMATCH');
 return {equal:true,sha256:sha(x),bytes:Buffer.byteLength(x)};
}
async function captureBase(schema){
 const sentinel=Error('capture');let sql,values;
 try{await schema.tenantSchemaSnapshot({async query(text,params){sql=text;values=params;throw sentinel;}});}catch(error){if(error!==sentinel)throw error;}
 if(typeof sql!=='string'||!sql.trimStart().startsWith('SELECT')||!Array.isArray(values))throw fail('TENANT_AB_SQL_CAPTURE_FAILED');
 return {sql,values};
}
function driftCases(){
 return [
  {name:'not-null-canonical',sql:['CREATE TABLE c4g_app.ab_probe(value integer NOT NULL)']},
  {name:'not-null-quoted',sql:['CREATE TABLE c4g_app.ab_probe("Quoted column" integer NOT NULL)'],unsupported:true},
  {name:'not-null-no-inherit',sql:['CREATE TABLE c4g_app.ab_probe(value integer NOT NULL NO INHERIT)'],unsupported:true},
  {name:'not-null-not-valid',sql:['CREATE TABLE c4g_app.ab_probe(value integer)','ALTER TABLE c4g_app.ab_probe ADD CONSTRAINT ab_probe_nn NOT NULL value NOT VALID'],unsupported:true},
  {name:'not-null-partition',sql:['CREATE TABLE c4g_app.ab_parent(value integer NOT NULL) PARTITION BY RANGE(value)','CREATE TABLE c4g_app.ab_probe PARTITION OF c4g_app.ab_parent FOR VALUES FROM(0) TO(10)']},
  {name:'not-null-inherited',sql:['CREATE TABLE c4g_app.ab_parent(value integer NOT NULL)','CREATE TABLE c4g_app.ab_probe() INHERITS(c4g_app.ab_parent)'],unsupported:true},
  {name:'conventional-constraints',sql:['CREATE TABLE c4g_app.ab_parent(id integer PRIMARY KEY)','CREATE TABLE c4g_app.ab_probe(id integer PRIMARY KEY,parent_id integer REFERENCES c4g_app.ab_parent(id),value integer UNIQUE,CHECK(value>0))']},
  {name:'public-table-acl',sql:['GRANT SELECT ON organizational_scope.scope TO PUBLIC']},
  {name:'public-column-acl',sql:['GRANT SELECT(scope_id) ON organizational_scope.scope TO PUBLIC']},
  {name:'runtime-role',sql:['ALTER ROLE c4g_organizational_scope_runtime LOGIN']},
  {name:'table-owner',sql:['ALTER TABLE organizational_scope.scope OWNER TO c4g_tenant_owner']},
  {name:'rls-disabled',sql:['ALTER TABLE organizational_scope.scope DISABLE ROW LEVEL SECURITY']},
  {name:'rls-not-forced',sql:['ALTER TABLE organizational_scope.scope NO FORCE ROW LEVEL SECURITY']},
  {name:'policy-change',sql:['CREATE POLICY ab_probe ON organizational_scope.scope FOR SELECT TO PUBLIC USING(true)']},
  {name:'metadata-executor-role',sql:['ALTER ROLE c4g_f4_metadata_executor INHERIT']}
 ];
}
async function refused(work){
 try{return {value:await work()};}catch(error){const code=safeCode(error);if(!['UNSUPPORTED_NOT_NULL_CONSTRAINT','F4_METADATA_DRIFT','TENANT_SCHEMA_FINGERPRINT_MISMATCH'].includes(code))throw error;return {refused:code};}
}
async function provePostFunctionDrift({tenant,module,pool,arm,baseSql,baseline}){
 const result={arm,tenantIndex:tenant.index,status:'RUNNING',mutationAfterFunction:false,snapshotCount:0,restrictedFunctionCalls:0,functionalCallbackExecuted:false,rejected:null,restored:false};
 const owner=tenant.pool;
 assert.equal((await owner.query("SELECT rolinherit FROM pg_roles WHERE rolname='c4g_f4_metadata_executor'")).rows[0]?.rolinherit,false,'TENANT_AB_ROLE_BASELINE_CHANGED');
 let client,changed=false,began=false,primary;
 try{
  client=await pool.connect();await client.query('BEGIN TRANSACTION READ ONLY');began=true;await verifyLimited(client,tenant);
  const observed={async query(...args){
   const sql=typeof args[0]==='string'?args[0]:args[0]?.text;
   if(sql===baseSql)result.snapshotCount++;
   const value=await client.query(...args);
   if(sql==='SELECT c4g_system.runtime_metadata_v1($1::uuid,$2::uuid) AS metadata'){
    result.restrictedFunctionCalls++;assert.equal(result.restrictedFunctionCalls,1);assert.equal(result.snapshotCount,1);
    // Commit the role drift on another owned connection after the real restricted
    // function has returned, before preflight's independent second snapshot.
    changed=true;await owner.query('ALTER ROLE c4g_f4_metadata_executor INHERIT');result.mutationAfterFunction=true;
   }
   return value;
  }};
  try{await module.runtime.observeTenantRuntimeMetadata(observed,tenant.identity);result.functionalCallbackExecuted=true;}
  catch(error){result.rejected=safeCode(error);}
  assert.equal(result.rejected,'TENANT_SCHEMA_FINGERPRINT_MISMATCH');assert.equal(result.functionalCallbackExecuted,false);
  assert.equal(result.mutationAfterFunction,true);assert.equal(result.snapshotCount,2);assert.equal(result.restrictedFunctionCalls,1);
 }catch(error){primary=error;}
 finally{
  let rollbackFailure;
  const cleanupError=error=>{(result.cleanupFailures||=[]).push({code:safeCode(error)});primary||=error;};
  try{if(began)await client.query('ROLLBACK');}catch(error){rollbackFailure=error;cleanupError(error);}
  try{client?.release(rollbackFailure);}catch(error){cleanupError(error);}
  try{if(changed)await owner.query('ALTER ROLE c4g_f4_metadata_executor NOINHERIT');}catch(error){cleanupError(error);}
 }
 try{
  assert.equal((await owner.query("SELECT rolinherit FROM pg_roles WHERE rolname='c4g_f4_metadata_executor'")).rows[0]?.rolinherit,false);
  await baseline();result.restored=true;
 }catch(error){if(primary)result.restorationFailure={code:safeCode(error)};else primary=error;}
 if(primary){result.status='FAIL';primary.postFunctionReport=result;throw primary;}
 result.status='PASS';return result;
}
async function runTenantEquivalence({fixture,rootA,rootB,onProgress=()=>{},load=loadTenant,createPool=createLimitedPool}={}){
 assertTenantFixture(fixture);if(typeof onProgress!=='function')throw fail('TENANT_AB_ARGUMENTS_INVALID');
 const modules={A:load(rootA),B:load(rootB)};
 assert.equal(modules.A.entry.schemaFingerprint,modules.B.entry.schemaFingerprint,'TENANT_AB_CONTRACT_CHANGED');
 const expected=modules.A.entry.schemaFingerprint,started=performance.now();
 const report={schemaVersion:1,status:'RUNNING',tenantRevision:REVISION,tenants:[],limits:[
  'Mutation comparisons use a fixture owner transaction and SET LOCAL ROLE to the exact limited login; clean baselines and post-function proof use a real limited login.',
  'No sorting or normalization is applied to serialized snapshots. Existing unsupported NOT NULL semantics remain refusals.',
  'The query adapter forwards every actual statement and inserts one committed role mutation after the restricted function. No verifier or fingerprint is mocked.',
  'EXPLAIN profiles and mutations are outside all timed populations.'
 ]};
 try{
  for(const tenant of fixture.tenants){
   const row={tenantIndex:tenant.index,baseline:null,finalBaseline:null,sqlHashes:{},transactional:[],postFunctionProofs:[],plans:[]};report.tenants.push(row);
   const pool=createPool(rootA,tenant);
   async function baseline(){
    const c=await pool.connect();let began=false;
    try{
     await c.query('BEGIN TRANSACTION READ ONLY');began=true;await verifyLimited(c,tenant);const snapshots={};
     for(const [arm,m]of Object.entries(modules)){
      const hashes=[],observed={query:(...args)=>{hashes.push(sha(typeof args[0]==='string'?args[0]:args[0].text));return c.query(...args);}};
      snapshots[arm]=await m.schema.tenantSchemaSnapshot(observed);assert.equal(hashes.length,25,'TENANT_AB_SECURITY_READ_COUNT_CHANGED');
      assert.equal(m.schema.tenantSchemaFingerprint(snapshots[arm]),expected,'TENANT_AB_FINGERPRINT_MISMATCH');
      if(row.sqlHashes[arm])assert.deepEqual(hashes,row.sqlHashes[arm]);else row.sqlHashes[arm]=hashes;
      const evidence=await m.runtime.observeTenantRuntimeMetadata(c,tenant.identity);assert.equal(evidence.currentVersion,REVISION);assert.equal(evidence.schemaFingerprint,expected);
     }
     assert.notEqual(row.sqlHashes.A[0],row.sqlHashes.B[0],'TENANT_AB_BASE_SQL_UNCHANGED');assert.deepEqual(row.sqlHashes.A.slice(1),row.sqlHashes.B.slice(1),'TENANT_AB_SECURITY_SQL_CHANGED');
     return compareSnapshots(snapshots.A,snapshots.B);
    }finally{try{if(began)await c.query('ROLLBACK');}finally{c.release();}}
   }
   try{
    row.baseline=await baseline();assert.deepEqual(await baseline(),row.baseline);await onProgress({stage:'tenant-baseline-parity',tenantIndex:tenant.index,status:'PASS'});
    const bases={A:await captureBase(modules.A.schema),B:await captureBase(modules.B.schema)};
    const profiler=await pool.connect();let began=false;
    try{await profiler.query('BEGIN TRANSACTION READ ONLY');began=true;await verifyLimited(profiler,tenant);
     for(const arm of ['A','B']){const b=bases[arm],plan=(await profiler.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+b.sql,b.values)).rows[0]?.['QUERY PLAN'];assert(Array.isArray(plan)&&plan.length===1,'TENANT_AB_EXPLAIN_INVALID');row.plans.push({arm,sqlSha256:sha(b.sql),plan});}
    }finally{try{if(began)await profiler.query('ROLLBACK');}finally{profiler.release();}}
    for(const item of driftCases()){
     const result={case:item.name,status:'RUNNING',restored:false},owner=await tenant.pool.connect();row.transactional.push(result);let began=false;
     try{
      await owner.query('BEGIN');began=true;for(const sql of item.sql)await owner.query(sql);
      // This role is a validated fixture-derived identifier, never caller SQL.
      await owner.query('SET LOCAL ROLE "'+tenant.credentials.login+'"');assert.equal((await owner.query('SELECT current_user')).rows[0]?.current_user,tenant.credentials.login);
      const states={};for(const [arm,m]of Object.entries(modules))states[arm]={schema:await refused(()=>m.schema.tenantSchemaSnapshot(owner)),guard:await refused(()=>m.runtime.observeTenantRuntimeMetadata(owner,tenant.identity))};
      if(item.unsupported){assert.equal(states.A.schema.refused,'UNSUPPORTED_NOT_NULL_CONSTRAINT');assert.equal(states.B.schema.refused,states.A.schema.refused);result.schemaRefusal=states.A.schema.refused;}
      else{assert(!states.A.schema.refused&&!states.B.schema.refused);result.schema=compareSnapshots(states.A.schema.value,states.B.schema.value);assert.notEqual(result.schema.sha256,expected,'TENANT_AB_MUTATION_NOT_OBSERVED');}
      assert.equal(states.A.guard.refused,states.B.guard.refused,'TENANT_AB_GUARD_OUTCOME_MISMATCH');assert(states.A.guard.refused,'TENANT_AB_DRIFT_NOT_REFUSED');result.guard=states.A.guard.refused;
     }finally{try{if(began)await owner.query('ROLLBACK');}finally{owner.release();}}
     await baseline();result.restored=true;result.status='PASS';await onProgress({stage:'tenant-drift-'+item.name,tenantIndex:tenant.index,status:'PASS'});
    }
    for(const arm of ['A','B']){
     const proof=await provePostFunctionDrift({tenant,module:modules[arm],pool,arm,baseSql:bases[arm].sql,baseline});row.postFunctionProofs.push(proof);
     await onProgress({stage:'tenant-post-function-drift',tenantIndex:tenant.index,arm,status:'PASS'});
    }
    row.finalBaseline=await baseline();assert.deepEqual(row.finalBaseline,row.baseline);
   }finally{await pool.end();}
  }
  report.status='PASS';return report;
 }catch(error){report.status='FAIL';report.failure={code:safeCode(error)};if(error.postFunctionReport)report.failedPostFunctionProof=error.postFunctionReport;error.tenantEquivalenceReport=report;throw error;}
 finally{report.totalDurationMs=performance.now()-started;}
}
module.exports={REVISION,sha,fail,safeCode,assertTenantFixture,loadTenant,createLimitedPool,verifyLimited,compareSnapshots,captureBase,driftCases,provePostFunctionDrift,runTenantEquivalence};
