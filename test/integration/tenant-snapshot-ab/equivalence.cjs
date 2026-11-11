'use strict';
// Functional, owned-fixture proof. No mutation is included in timing samples.
const path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const DATABASE='c4g_f13_authority_synthetic_central';
const REVISIONS=['042_opportunity_eu_source_control_v2','043_opportunity_eu_writer_v2'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>Object.assign(new Error(code),{code});
function endpoint(pool){
  if(!pool?.options||typeof pool.query!=='function'||typeof pool.connect!=='function')throw fail('AB_OWNED_FIXTURE_REQUIRED');
  let {host,port,database,connectionString}=pool.options;
  if(connectionString){
    let u;try{u=new URL(connectionString);}catch{throw fail('AB_OWNED_FIXTURE_REQUIRED');}
    const db=decodeURIComponent(u.pathname.slice(1));
    if(!['postgres:','postgresql:'].includes(u.protocol)||u.search||u.hash||(host&&host!==u.hostname)||(port&&Number(port)!==Number(u.port))||(database&&database!==db))throw fail('AB_OWNED_FIXTURE_REQUIRED');
    host=u.hostname;port=u.port;database=db;
  }
  if(host!=='127.0.0.1'||database!==DATABASE||!Number.isInteger(Number(port))||Number(port)<=0||Number(port)>65535||[5432,5433].includes(Number(port)))throw fail('AB_OWNED_FIXTURE_REQUIRED');
  return JSON.stringify({host,port:Number(port),database});
}
function assertFixture(fixture,revision){
  if(fixture?.ownership?.isolated!==true||!/^[a-f0-9]{32}$/.test(fixture.ownership.runId||'')||fixture.ownership.centralDatabase!==DATABASE||!REVISIONS.includes(revision)||typeof fixture.central?.permitSecret!=='string'||fixture.central.permitSecret.length<32)throw fail('AB_OWNED_FIXTURE_REQUIRED');
  const target=endpoint(fixture.central.pool);
  if([fixture.reader,fixture.central.authorityPool].some(p=>endpoint(p)!==target))throw fail('AB_OWNED_FIXTURE_REQUIRED');
}
async function captureBaseSql(schema){
  const sentinel=Error('capture');let sql;
  try{await schema.centralSchemaSnapshot({query:async text=>{sql=text;throw sentinel;}});}catch(e){if(e!==sentinel)throw e;}
  if(typeof sql!=='string'||!sql.trimStart().startsWith('SELECT'))throw fail('AB_BASE_SQL_CAPTURE_FAILED');
  return sql;
}
function compareSnapshots(a,b){
  const bytesA=JSON.stringify(a),bytesB=JSON.stringify(b);
  if(bytesA!==bytesB)throw Object.assign(fail('AB_SNAPSHOT_MISMATCH'),{fingerprints:{A:sha(bytesA),B:sha(bytesB)}});
  return {equal:true,sha256:sha(bytesA),bytes:Buffer.byteLength(bytesA)};
}
function driftCases(){
  const schema='CREATE SCHEMA ab_security_probe';
  const table='CREATE TABLE ab_security_probe.sample(value integer)';
  const third='CREATE ROLE ab_security_third NOLOGIN';
  return [
    {name:'table-structure',sql:['ALTER TABLE public.global_user ADD COLUMN ab_security_probe integer']},
    {name:'public-table',sql:['GRANT SELECT ON public.global_user TO PUBLIC']},
    {name:'third-party-table',sql:[third,'GRANT SELECT ON public.global_user TO ab_security_third']},
    {name:'public-column',sql:['GRANT SELECT(display_name) ON public.global_user TO PUBLIC']},
    {name:'third-party-column',sql:[third,'GRANT SELECT(display_name) ON public.global_user TO ab_security_third']},
    {name:'foreign-table',sql:[schema,table,third,'GRANT SELECT ON ab_security_probe.sample TO c4g_authority_runtime','GRANT UPDATE ON ab_security_probe.sample TO PUBLIC,ab_security_third']},
    {name:'foreign-column-table',sql:[schema,table,third,'GRANT SELECT(value) ON ab_security_probe.sample TO c4g_authority_runtime','GRANT UPDATE(value) ON ab_security_probe.sample TO PUBLIC,ab_security_third']},
    {name:'foreign-column-view',sql:[schema,'CREATE VIEW ab_security_probe.sample AS SELECT 1 AS value',third,'GRANT SELECT(value) ON ab_security_probe.sample TO c4g_authority_runtime','GRANT SELECT(value) ON ab_security_probe.sample TO PUBLIC,ab_security_third']},
    {name:'foreign-function',sql:[schema,third,'CREATE FUNCTION ab_security_probe.sample() RETURNS integer LANGUAGE SQL AS $$SELECT 1$$','GRANT EXECUTE ON FUNCTION ab_security_probe.sample() TO c4g_authority_runtime,ab_security_third']},
    {name:'owned-function',sql:[schema,'CREATE FUNCTION ab_security_probe.sample() RETURNS integer LANGUAGE SQL AS $$SELECT 1$$','ALTER FUNCTION ab_security_probe.sample() OWNER TO c4g_authority_owner']},
    {name:'foreign-schema',sql:[schema,third,'GRANT USAGE ON SCHEMA ab_security_probe TO c4g_authority_runtime','GRANT CREATE ON SCHEMA ab_security_probe TO PUBLIC,ab_security_third']},
    {name:'owned-schema',sql:[schema,'ALTER SCHEMA ab_security_probe OWNER TO c4g_authority_owner']},
    {name:'owned-null-acl',sql:[schema,table,'ALTER TABLE ab_security_probe.sample OWNER TO c4g_authority_owner'],catalog:'SELECT relacl IS NULL AS valid FROM pg_class WHERE oid=\'ab_security_probe.sample\'::regclass'},
    {name:'owned-empty-acl',sql:[schema,table,'ALTER TABLE ab_security_probe.sample OWNER TO c4g_authority_owner','REVOKE ALL ON ab_security_probe.sample FROM c4g_authority_owner'],catalog:'SELECT relacl IS NOT NULL AND cardinality(relacl)=0 AS valid FROM pg_class WHERE oid=\'ab_security_probe.sample\'::regclass',allowUnchanged:true},
    {name:'owned-sequence',sql:[schema,'CREATE SEQUENCE ab_security_probe.sample','ALTER SEQUENCE ab_security_probe.sample OWNER TO c4g_authority_owner','GRANT USAGE ON SEQUENCE ab_security_probe.sample TO PUBLIC']},
    {name:'membership',sql:[third,'GRANT c4g_authority_coordinator TO ab_security_third']},
    {name:'role-attribute',sql:['ALTER ROLE c4g_authority_runtime INHERIT']},
    {name:'multiple-grantors',sql:[schema,table,third,'CREATE ROLE ab_security_grantor NOLOGIN','GRANT USAGE ON SCHEMA ab_security_probe TO ab_security_grantor','GRANT SELECT ON ab_security_probe.sample TO ab_security_grantor WITH GRANT OPTION','GRANT SELECT ON ab_security_probe.sample TO c4g_authority_runtime','GRANT SELECT ON ab_security_probe.sample TO ab_security_third WITH GRANT OPTION','SET LOCAL ROLE ab_security_grantor','GRANT SELECT ON ab_security_probe.sample TO ab_security_third','RESET ROLE'],catalog:`SELECT count(*)=2 AND count(DISTINCT is_grantable)=2 AS valid FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid='ab_security_probe.sample'::regclass AND r.rolname='ab_security_third' AND a.privilege_type='SELECT'`},
    {name:'not-null-canonical',sql:['CREATE TABLE public.ab_security_probe(value integer NOT NULL)']},
    {name:'not-null-quoted',sql:['CREATE TABLE public.ab_security_probe("Quoted column" integer NOT NULL)'],unsupported:true},
    {name:'not-null-no-inherit',sql:['CREATE TABLE public.ab_security_probe(value integer NOT NULL NO INHERIT)'],unsupported:true},
    {name:'not-null-not-valid',sql:['CREATE TABLE public.ab_security_probe(value integer)','ALTER TABLE public.ab_security_probe ADD CONSTRAINT ab_probe_nn NOT NULL value NOT VALID'],unsupported:true}
  ];
}
const safeCode=e=>/^[A-Z0-9_]{1,80}$/.test(e?.code||'')?e.code:/^Central schema drift detected/.test(e?.message||'')?'CENTRAL_SCHEMA_DRIFT':e?.message==='UNSUPPORTED_NOT_NULL_CONSTRAINT'?'UNSUPPORTED_NOT_NULL_CONSTRAINT':'AB_EQUIVALENCE_FAILED';
async function outcome(work){try{return {value:await work()};}catch(e){const code=safeCode(e);if(!['CENTRAL_SCHEMA_DRIFT','AUTHORITY_SECURITY_DRIFT','UNSUPPORTED_NOT_NULL_CONSTRAINT'].includes(code))throw e;return {refused:code};}}
async function runEquivalence({fixture,rootA,rootB,revision,onProgress=()=>{}}){
  assertFixture(fixture,revision);
  const modules=Object.fromEntries(Object.entries({A:rootA,B:rootB}).map(([arm,root])=>[arm,{schema:require(path.join(root,'backend/src/security/centralSchemaManifest.js')),security:require(path.join(root,'backend/src/security/authoritySecurityManifest.js')),root}]));
  const report={schemaVersion:1,status:'RUNNING',revision,runId:fixture.ownership.runId,baseline:[],plans:[],transactional:[],postLockProofs:[],limits:['Owner prepares transactional drift; all snapshot comparisons execute SET LOCAL ROLE c4g_authority_runtime. Baselines and post-lock proof use a real limited login.','No sorting or normalization is applied to JSON comparisons. Existing unsupported NOT NULL semantics must remain refusals.','An owned object with an explicit empty ACL contributes no privilege rows in the existing authority contract; equivalence preserves this behavior.']};
  const notify=stage=>onProgress({stage,revision,cases:report.transactional.length});
  async function baseline(){
    const c=await fixture.reader.connect();
    try{
      const row=(await c.query(`SELECT current_database() AS database,session_user,current_user,NOT(rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit) AND rolcanlogin AS limited FROM pg_roles WHERE rolname=current_user`)).rows[0];
      assert(row.database===DATABASE&&row.session_user==='c4g_authority_runtime'&&row.current_user===row.session_user&&row.limited===true,'AB_LIMITED_LOGIN_REQUIRED');
      const snapshots={};for(const [arm,m]of Object.entries(modules)){snapshots[arm]=await m.schema.centralSchemaSnapshot(c);assert.equal(m.schema.schemaFingerprint(snapshots[arm]),m.schema.EXPECTED_CENTRAL_SCHEMA_SHA256_BY_VERSION[revision]);await m.schema.assertCentralSchema(c,revision);}
      return compareSnapshots(snapshots.A,snapshots.B);
    }finally{c.release();}
  }
  try{
    for(let i=0;i<2;i++)report.baseline.push(await baseline());await notify('baseline-parity');
    const c=await fixture.reader.connect();
    try{for(const [arm,m]of Object.entries(modules))for(const [kind,sql]of [['central',await captureBaseSql(m.schema)],['security',m.security.SQL]]){
      const plan=(await c.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql)).rows[0]['QUERY PLAN'];report.plans.push({arm,kind,sqlSha256:sha(sql),plan});
    }}finally{c.release();}
    for(const item of driftCases()){
      const result={case:item.name,status:'RUNNING',restored:false},client=await fixture.central.pool.connect();report.transactional.push(result);
      try{
        await client.query('BEGIN');for(const sql of item.sql)await client.query(sql);
        if(item.catalog){assert.equal((await client.query(item.catalog)).rows[0]?.valid,true,'AB_EDGE_CASE_NOT_ESTABLISHED');result.catalogStateConfirmed=true;}
        await client.query('SET LOCAL ROLE c4g_authority_runtime');assert.equal((await client.query('SELECT current_user')).rows[0]?.current_user,'c4g_authority_runtime');
        const states={};for(const [arm,m]of Object.entries(modules))states[arm]={security:await m.security.authoritySecuritySnapshot(client),schema:await outcome(()=>m.schema.centralSchemaSnapshot(client)),guard:await outcome(()=>m.schema.assertCentralSchema(client,revision))};
        result.security=compareSnapshots(states.A.security,states.B.security);
        if(item.unsupported){assert.equal(states.A.schema.refused,'UNSUPPORTED_NOT_NULL_CONSTRAINT');assert.equal(states.B.schema.refused,states.A.schema.refused);result.schemaRefusal=states.A.schema.refused;}
        else{assert(!states.A.schema.refused&&!states.B.schema.refused);result.schema=compareSnapshots(states.A.schema.value,states.B.schema.value);}
        assert.equal(states.A.guard.refused,states.B.guard.refused,'AB_GUARD_OUTCOME_MISMATCH');
        if(!item.allowUnchanged)assert(states.A.guard.refused,'AB_DRIFT_NOT_REFUSED');
        result.guard=states.A.guard.refused||'UNCHANGED_EXISTING_CONTRACT';
        if(item.name==='multiple-grantors'){
          const rows=states.A.security.objects.filter(x=>x.schema_name==='ab_security_probe'&&x.grantee==='ab_security_third'&&x.privilege_type==='SELECT');assert.equal(rows.length,2);assert.equal(new Set(rows.map(x=>x.is_grantable)).size,2);result.duplicateGrantorsPreserved=true;
        }
      }finally{try{await client.query('ROLLBACK');}finally{client.release();}}
      await baseline();result.restored=true;result.status='PASS';await notify('drift-'+item.name);
    }
    for(const [arm,m]of Object.entries(modules)){
      const proof=await require('./authority-drift.cjs').validateMetadataDrift({sourceRoot:m.root,ownerPool:fixture.central.pool,readerPool:fixture.reader,authorityPool:fixture.central.authorityPool,revision,permitSecret:fixture.central.permitSecret,ownership:fixture.ownership,onProgress:async p=>{await onProgress({...p,arm});}});
      report.postLockProofs.push({arm,proof});assert.equal(proof.status,'PASS');
    }
    report.finalBaseline=await baseline();report.status='PASS';return report;
  }catch(error){report.status='FAIL';report.failure={code:safeCode(error),case:report.transactional.at(-1)?.case,...(error.fingerprints?{fingerprints:error.fingerprints}:{})};if(error.metadataDriftReport)report.failedPostLockProof=error.metadataDriftReport;error.equivalenceReport=report;throw error;}
}
module.exports={runEquivalence,assertFixture,captureBaseSql,compareSnapshots,driftCases};
