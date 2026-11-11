'use strict';
const assert=require('node:assert/strict');
function splitConstraints(sql){
 const start=sql.indexOf('(SELECT COALESCE(json_agg(catalog_row)',sql.indexOf('AS "columns"'));
 const end=sql.indexOf(' AS "constraints"',start);
 const section=sql.slice(start,end),a=section.indexOf('FROM (')+6,z=section.lastIndexOf(') AS catalog_row)');
 const original=section.slice(a,z);
 assert(original.includes('AS constraint_type,'));
 const unordered=original.slice(0,original.lastIndexOf('ORDER BY c.relname, con.conname')).trim();
 const columns=unordered.replace(' END AS table_name, con.conname',' END AS table_name, c.relname AS sort_name, con.conname');
 const regular=columns.replace(/CASE WHEN con\.contype='n'[\s\S]*?END AS definition/,'pg_catalog.pg_get_constraintdef(con.oid, true) AS definition')
  .replace(/\s*LEFT JOIN pg_catalog\.pg_attribute nn ON con\.contype='n' AND nn\.attrelid = con\.conrelid AND nn\.attnum = con\.conkey\[1\]/,'');
 const body=`SELECT table_name,constraint_name,constraint_type,definition FROM ((${regular} AND con.contype<>'n') UNION ALL (${columns} AND con.contype='n')) scoped_constraints ORDER BY sort_name,constraint_name`;
 return sql.slice(0,start)+section.slice(0,a)+body+section.slice(z)+sql.slice(end);
}
function functionDetails(sql){
 const marker=')\nSELECT jsonb_build_object(';
 assert(sql.includes(marker));
 return sql.replace(marker,`), function_details AS MATERIALIZED (
 SELECT p.oid,pg_get_function_identity_arguments(p.oid) signature,
  pg_get_userbyid(p.proowner) owner,pg_get_functiondef(p.oid) definition
 FROM protected_functions p
 WHERE EXISTS(SELECT 1 FROM function_privileges a WHERE a.function_oid=p.oid)
)
SELECT jsonb_build_object(`)
 .replace('pg_get_function_identity_arguments(p.oid) signature,\n    pg_get_userbyid(p.proowner) owner','f.signature,\n    f.owner')
 .replace('pg_get_functiondef(p.oid) definition,p.prosecdef security_definer','f.definition,p.prosecdef security_definer')
 .replace('FROM protected_functions p JOIN function_privileges a ON a.function_oid=p.oid','FROM protected_functions p JOIN function_details f ON f.oid=p.oid JOIN function_privileges a ON a.function_oid=p.oid');
}
async function capture(work){let sql;const stop=Error('CAPTURE');try{await work({query:async s=>{sql=s;throw stop;}});}catch(e){if(e!==stop)throw e;}return sql;}
async function diagnose({catalog,db}){
 const core=require('../../../backend/src/security/centralSchemaManifest');
 const original=require('../../../backend/test/support/admissionQueriesBaseline.json').core;
 const authority=require('../../../backend/test/support/admissionQueriesBaseline.json').authority;
 const rows=[];
 {const c=await catalog.catalogPool.connect();try{
  await c.query('BEGIN READ ONLY');
  for(const field of ['tables','columns','constraints','indexes','triggers','triggerFunctions','authoritySequence']){
   const plan=(await c.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT "'+field+'" FROM ('+original+') selected')).rows[0]['QUERY PLAN'][0];
   rows.push({component:'fieldCost',field,executionMs:plan['Execution Time'],plan});
  }
  for(const type of ['n','c','f','p','u','t']){
   const filtered=original.replace('ORDER BY c.relname, con.conname',"AND con.contype='"+type+"' ORDER BY c.relname, con.conname");
   const plan=(await c.query('EXPLAIN (ANALYZE,FORMAT JSON) SELECT constraints FROM ('+filtered+') selected')).rows[0]['QUERY PLAN'][0];
   rows.push({component:'constraintCost',type,executionMs:plan['Execution Time'],plan});
  }
 }finally{await c.query('ROLLBACK');c.release();}}

 {const c=await catalog.catalogPool.connect();try{
   await c.query('BEGIN READ ONLY');
   const reader=await capture(c=>require('../../../backend/src/security/catalogReaderSecurity').catalogReaderSnapshot(c));
   const combined=original+",CASE WHEN EXISTS(SELECT 1 FROM pg_sequence WHERE seqrelid=to_regclass('public.authority_epoch_seq')) THEN ("+authority+") ELSE NULL END AS authority_security,("+reader+") AS catalog_reader";
   const expected=await core.centralSchemaSnapshot(c);
   const samples=[];
   for(let i=0;i<6;i++)for(const arm of i%2?['B','A']:['A','B']){
    const start=performance.now();let snapshot;
    if(arm==='A')snapshot=await core.centralSchemaSnapshot(c);
    else {const q=(await c.query(combined,['c4g_catalog_reader'])).rows[0];snapshot={tables:q.tables,columns:q.columns,constraints:require('../../../backend/src/security/postgresCatalogCompatibility').canonicalConstraints(q.constraints),indexes:q.indexes};if(q.authoritySequence.length){snapshot.authoritySequence=q.authoritySequence;snapshot.authoritySecurity=q.authority_security;}if(q.triggers.length)snapshot.triggers=q.triggers;if(q.triggerFunctions.length)snapshot.triggerFunctions=q.triggerFunctions;if(q.catalog_reader)snapshot.catalogReader=q.catalog_reader;}
    const ms=performance.now()-start;assert.equal(JSON.stringify(snapshot),JSON.stringify(expected));samples.push({arm,executionMs:ms});
   }
   rows.push({component:'completeCore',variant:'singleStatement',identical:true,samples});
 }finally{await c.query('ROLLBACK');c.release();}}

 for(const [component,pool,baseline,variants] of [
  ['core',catalog.catalogPool,original,{checkExpr:original.replace("ELSE pg_catalog.pg_get_constraintdef(con.oid, true) END AS definition","WHEN con.contype='c' AND con.convalidated AND NOT con.connoinherit AND NOT con.condeferrable AND NOT con.condeferred AND con.conbin IS NOT NULL AND COALESCE((to_jsonb(con)->>'conenforced')::boolean,true) THEN 'CHECK ('||pg_catalog.pg_get_expr(con.conbin,con.conrelid,true)||')' ELSE pg_catalog.pg_get_constraintdef(con.oid, true) END AS definition"),rowJson:original.replace('to_jsonb(con)','row_to_json(con)'),split:splitConstraints(original),splitRowJson:splitConstraints(original).replace('to_jsonb(con)','row_to_json(con)')}],
  ['authority',db.central.authorityPool,authority,{functionDetails:functionDetails(authority)}]
 ]){
  const c=await pool.connect();try{
   await c.query('BEGIN READ ONLY');await c.query("SET LOCAL statement_timeout='10s'");
   const expected=(await c.query(baseline)).rows;
   for(const [variant,sql] of Object.entries(variants)){
    assert.notEqual(sql,baseline);assert.deepEqual((await c.query(sql)).rows,expected);
    const samples=[];
    for(let i=0;i<4;i++)for(const [arm,query] of i%2?[['B',sql],['A',baseline]]:[['A',baseline],['B',sql]]){
     const plan=(await c.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query)).rows[0]['QUERY PLAN'][0];
     samples.push({arm,executionMs:plan['Execution Time'],planningMs:plan['Planning Time']});
    }
    rows.push({component,variant,identical:true,samples});
   }
  }finally{await c.query('ROLLBACK');c.release();}
 }
 rows.push(await require('./admission-digest-experiment.cjs').diagnose(catalog.catalogPool));
 rows.push(await require('./admission-digest-experiment.cjs').diagnose(catalog.catalogPool,true));
 rows.push(await require('./admission-vector-experiment.cjs').diagnose(catalog.catalogPool));
 rows.push(await require('./authority-compact-experiment.cjs').diagnose(catalog.catalogPool));
 rows.push(await require('./catalog-tuples-experiment.cjs').diagnose(catalog.catalogPool));
 return rows;
}
module.exports={splitConstraints,functionDetails,diagnose};
