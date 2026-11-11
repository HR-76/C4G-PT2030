'use strict';
const core=require('../../../backend/src/security/centralSchemaManifest');
const schema=require('../../../backend/src/opportunities/catalogRead/readSchema');
const authority=require('../../../backend/src/security/authoritySecurityManifest');
async function capture(work){let sql;const stop=Error('CAPTURE_ONLY');try{await work({query:async text=>{sql=text;throw stop;}});}catch(e){if(e!==stop)throw e;}if(!sql?.trim().startsWith('SELECT'))throw Error('READ_ONLY_DIAGNOSTIC_REQUIRED');return sql;}
async function diagnose({catalog,db}){
 const result=[];
 {const c=await catalog.catalogPool.connect();try{
  await c.query('BEGIN READ ONLY');let legacyCalls=0,newCalls=0;
  const start=performance.now();const legacy=await require('./legacy-reader-metadata.cjs').catalogReaderSnapshot({query:(...args)=>{legacyCalls++;return c.query(...args)}});const legacyMs=performance.now()-start;
  const nextStart=performance.now();const current=await require('../../../backend/src/security/catalogReaderSecurity').catalogReaderSnapshot({query:(...args)=>{newCalls++;return c.query(...args)}});const currentMs=performance.now()-nextStart;
  require('node:assert/strict').deepEqual(current,legacy);result.push({component:'readerMetadataBatch',metadataIdentical:true,legacyCalls,newCalls,legacyMs,currentMs});
 }finally{await c.query('ROLLBACK');c.release();}}

 for(const [component,pool,sql] of [
  ['coreSchema',catalog.catalogPool,await capture(c=>core.centralSchemaSnapshot(c))],
  ['catalogSchema',catalog.catalogPool,await capture(c=>schema.fingerprint(c))],
  ['lockedAuthority',db.central.authorityPool,authority.SQL]
 ]){
  const c=await pool.connect();try{
   await c.query('BEGIN READ ONLY');await c.query("SET LOCAL statement_timeout='10s'");
   const settings=(await c.query("SELECT current_setting('jit') AS jit,current_setting('jit_above_cost') AS jit_above_cost")).rows[0];
   const plan=(await c.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql)).rows[0]['QUERY PLAN'][0];
   const slow=[];function walk(n){if(n['Actual Total Time']>1)slow.push({node:n['Node Type'],subplan:n['Subplan Name']||null,relation:n['Relation Name']||null,ms:n['Actual Total Time'],rows:n['Actual Rows'],loops:n['Actual Loops']});for(const p of n.Plans||[])walk(p);}walk(plan.Plan);
   result.push({component,settings,executionMs:plan['Execution Time'],planningMs:plan['Planning Time'],jit:plan.JIT||null,slowest:slow.sort((a,b)=>b.ms-a.ms).slice(0,6)});
   if(component==='coreSchema'){
    const counts=(await c.query(`SELECT con.contype,count(*)::int AS n,count(*) FILTER(WHERE con.conkey IS NULL)::int AS missing_keys,count(*) FILTER(WHERE array_lower(con.conkey,1)=1)::int AS one_based,count(*) FILTER(WHERE con.convalidated AND con.conislocal AND con.coninhcount=0)::int AS normal FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(ARRAY['public','async_exec','audit','opportunity_catalog']) GROUP BY con.contype ORDER BY con.contype`)).rows;
    result.at(-1).constraintCounts=counts;
    const candidate=sql.replace("LEFT JOIN pg_catalog.pg_attribute nn ON con.contype='n' AND nn.attrelid = con.conrelid AND nn.attnum = con.conkey[1]", "LEFT JOIN LATERAL (SELECT a.attnum,a.attisdropped,a.attname FROM pg_catalog.pg_attribute a WHERE con.contype='n' AND a.attrelid=con.conrelid AND a.attnum=con.conkey[1] OFFSET 0) nn ON true");
    require('node:assert/strict').notEqual(candidate,sql);
    require('node:assert/strict').deepEqual((await c.query(candidate)).rows,(await c.query(sql)).rows);
    const alternate=(await c.query('EXPLAIN (ANALYZE,FORMAT JSON) '+candidate)).rows[0]['QUERY PLAN'][0];
    result.push({component:'coreIndexedAttributeCandidate',metadataIdentical:true,executionMs:alternate['Execution Time'],planningMs:alternate['Planning Time']});
   }
   if(component==='coreSchema'&&Number((await c.query('SHOW server_version_num')).rows[0].server_version_num)>=180000){
    const candidate=sql.replace("COALESCE((to_jsonb(con)->>'conenforced')::boolean,false)",'con.conenforced');
    const originalRows=(await c.query(sql)).rows,candidateRows=(await c.query(candidate)).rows;
    require('node:assert/strict').deepEqual(candidateRows,originalRows);
    const alternate=(await c.query('EXPLAIN (ANALYZE,FORMAT JSON) '+candidate)).rows[0]['QUERY PLAN'][0];
    result.push({component:'coreDirectEnforcementCandidate',metadataIdentical:true,executionMs:alternate['Execution Time'],planningMs:alternate['Planning Time']});
   }
  }finally{await c.query('ROLLBACK');c.release();}
 }
 result.push({component:'admissionSqlExperiments',variants:await require('./admission-sql-experiments.cjs').diagnose({catalog,db})});
 result.push({component:'metadataTransportProof',proof:await require('./metadata-transport-proof.cjs').run(db.central.pool)});
 result.push({component:'catalogQueryPlanComparison',proof:await require('./catalog-plan-proof.cjs').diagnose(catalog.catalogPool)});
 return result;
}
module.exports={diagnose};
