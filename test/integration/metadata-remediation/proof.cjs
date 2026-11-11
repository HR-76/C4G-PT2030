'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const current=require('../../../backend/src/security/authoritySecurityManifest');
const schema=require('../../../backend/src/security/centralSchemaManifest');
const filename=path.resolve(__dirname,'../../../backend/src/security/authoritySecurityManifest.js');
const reference=new Module(filename,module);reference.filename=filename;reference.paths=Module._nodeModulePaths(path.dirname(filename));
reference._compile(fs.readFileSync(path.join(__dirname,'authority.before.cjs.txt'),'utf8'),filename);
const old=reference.exports;
async function run(central){
 const c=await central.pool.connect(),checks=[];
 const compare=async()=>{
  const a=await old.authoritySecuritySnapshot(c),b=await current.authoritySecuritySnapshot(c);
  assert.equal(JSON.stringify(b),JSON.stringify(a));
  assert.equal(JSON.stringify(await current.authoritySecuritySnapshot(c,{compact:true})),JSON.stringify(a));
  assert.equal(JSON.stringify(await schema.centralSchemaSnapshot(c,{compactAuthority:true})),JSON.stringify(await schema.centralSchemaSnapshot(c,{compactAuthority:false})));
  return current.digest(b);
 };
 try{
  const baseline=await compare();
  const version=(await c.query('SELECT version FROM public.c4g_schema_migration ORDER BY version DESC LIMIT 1')).rows[0].version;
  const core=await schema.centralSchemaSnapshot(c);
  assert.equal(await schema.assertCentralSchema(c,version),schema.schemaFingerprint(core));
  checks.push('BASELINE_BYTES_COMPACT_AND_REGISTERED_FINGERPRINT');
  for(const [name,sql] of [
   ['PUBLIC_FUNCTION_ACL','GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA authority_api TO PUBLIC'],
   ['PUBLIC_COLUMN_ACL','GRANT SELECT(display_name) ON public.organization TO PUBLIC'],
   ['RUNTIME_ROLE_FLAGS','ALTER ROLE c4g_authority_runtime INHERIT'],
   ['FOREIGN_FUNCTION_AND_THIRD_PARTY',"CREATE ROLE metadata_probe; CREATE SCHEMA metadata_probe; CREATE FUNCTION metadata_probe.probe(x integer) RETURNS integer LANGUAGE sql AS 'SELECT x+1'; GRANT EXECUTE ON FUNCTION metadata_probe.probe(integer) TO c4g_authority_coordinator,metadata_probe"],
   ['FUNCTION_DEFINITION',"CREATE FUNCTION public.authority_metadata_probe(x integer) RETURNS integer LANGUAGE sql AS 'SELECT x+1'"],
   ['SCHEMA_ACL','GRANT CREATE ON SCHEMA authority_api TO PUBLIC'],
   ['EMPTY_FUNCTION_ACL',"CREATE FUNCTION public.authority_metadata_probe(x integer) RETURNS integer LANGUAGE sql AS 'SELECT x+1'; REVOKE ALL ON FUNCTION public.authority_metadata_probe(integer) FROM PUBLIC,proof_admin"],
  ]){
   await c.query('BEGIN');
   try{
    await c.query(sql);
    await c.query('SET LOCAL ROLE c4g_authority_runtime');
    const changed=await compare();
    // An empty ACL intentionally contributes no function rows, matching A.
    if(name!=='EMPTY_FUNCTION_ACL'){
     assert.notEqual(changed,baseline);
     await assert.rejects(current.assertAuthoritySecurity(c,version));
    }
    await c.query('RESET ROLE');checks.push(name);
   }finally{await c.query('ROLLBACK');}
   assert.equal(await compare(),baseline);
  }
  await c.query('BEGIN');
  try{
   await c.query('SELECT pg_advisory_xact_lock(43001306,1)');
   assert.equal(await compare(),baseline);
   await c.query('GRANT CREATE ON SCHEMA authority_api TO PUBLIC');
   assert.notEqual(await compare(),baseline);
   await assert.rejects(current.assertAuthoritySecurity(c,version));
   checks.push('FRESH_DRIFT_AFTER_LOCK_SAME_CONNECTION');
  }finally{await c.query('ROLLBACK');}
  const plans={};
  for(const [variant,sql] of [['A',old.SQL],['B',current.SQL]])plans[variant]=(await c.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql)).rows[0]['QUERY PLAN'];
  let coreSql;
  await schema.centralSchemaSnapshot({query(sql,...args){if(sql.includes('AS "tables"'))coreSql=sql;return c.query(sql,...args);}});
  plans.core=(await c.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+coreSql)).rows[0]['QUERY PLAN'];
  const runtime=await central.authorityPool.connect();
  const samples=[];
  try{
   for(let i=0;i<10;i++){await old.authoritySecuritySnapshot(runtime);await current.authoritySecuritySnapshot(runtime);}
   for(let i=0;i<60;i++)for(const variant of i%2?['B','A']:['A','B']){
    const start=performance.now();const snapshot=await(variant==='A'?old:current).authoritySecuritySnapshot(runtime,{compact:variant==='B'});
    const ms=performance.now()-start;assert.equal(current.digest(snapshot),baseline);samples.push({pair:i,variant,ms});
   }
  }finally{runtime.release();}
  return {status:'PASS',version,checks,samples,plans,limits:['Local PostgreSQL17 synthetic fixture; no production latency claim.','No metadata or access decision cache.']};
 }finally{c.release();}
}
module.exports={run};
