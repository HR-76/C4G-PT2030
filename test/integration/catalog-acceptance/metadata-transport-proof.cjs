'use strict';
const assert=require('node:assert/strict');
const core=require('../../../backend/src/security/centralSchemaManifest');
const authority=require('../../../backend/src/security/authoritySecurityManifest');
async function run(pool){
 const c=await pool.connect(),checks=[];
 const compare=async()=>{
  const legacy=await core.centralSchemaSnapshot(c),compact=await core.centralSchemaSnapshot(c,{compact:true,nativeConstraints:true});
  assert.equal(JSON.stringify(compact),JSON.stringify(legacy));
  assert.equal(JSON.stringify(await authority.authoritySecuritySnapshot(c,{compact:true})),JSON.stringify(await authority.authoritySecuritySnapshot(c)));
  return core.schemaFingerprint(legacy);
 };
 try{
  const baseline=await compare();
  assert.equal(baseline,require('../../../backend/src/opportunities/catalogRead/readPackage.schema.json').coreFingerprint);
  checks.push({name:'EXACT_BASELINE_BYTES_AND_PINNED_FINGERPRINT',status:'PASS'});
  for(const [name,sql] of [
   ['COLUMN_AND_CONSTRAINT_DRIFT',"CREATE TABLE public.gcni_metadata_probe(id integer NOT NULL,amount integer CHECK(amount>0))"],
   ['PUBLIC_RELATION_GRANT','GRANT SELECT ON public.organization TO PUBLIC'],
   ['PUBLIC_COLUMN_GRANT','GRANT SELECT(display_name) ON public.organization TO PUBLIC'],
   ['ROLE_FLAGS','ALTER ROLE c4g_authority_runtime INHERIT'],
   ['FUNCTION_GRANTS_AND_DEFINITION',"CREATE FUNCTION public.authority_metadata_probe(x integer) RETURNS integer LANGUAGE sql AS 'SELECT x+1'; GRANT EXECUTE ON FUNCTION public.authority_metadata_probe(integer) TO c4g_authority_coordinator"],
   ['FOREIGN_SCHEMA_AUTHORITY_RECIPIENT',"CREATE SCHEMA gcni_metadata_probe;CREATE FUNCTION gcni_metadata_probe.probe(x integer) RETURNS integer LANGUAGE sql AS 'SELECT x+1';GRANT EXECUTE ON FUNCTION gcni_metadata_probe.probe(integer) TO c4g_authority_coordinator"]
  ]){
   await c.query('BEGIN');try{await c.query(sql);assert.notEqual(await compare(),baseline);checks.push({name,status:'PASS'});}finally{await c.query('ROLLBACK');}
   assert.equal(await compare(),baseline);
  }
  await c.query('BEGIN');try{
   await c.query("CREATE FUNCTION public.authority_metadata_probe(x integer) RETURNS integer LANGUAGE sql AS 'SELECT x+1'");
   const before=await compare();await c.query("CREATE OR REPLACE FUNCTION public.authority_metadata_probe(x integer) RETURNS integer LANGUAGE sql AS 'SELECT x+2'");
   assert.notEqual(await compare(),before);checks.push({name:'SAME_CONNECTION_FRESH_FUNCTION_BODY',status:'PASS'});
  }finally{await c.query('ROLLBACK');}
  const major=Math.floor(Number((await c.query('SHOW server_version_num')).rows[0].server_version_num)/10000);
  if(major>=18){
   await c.query('BEGIN');try{
    await c.query('CREATE TABLE public.gcni_metadata_probe("MixedCase" integer NOT NULL)');
    for(const compact of [false,true])await assert.rejects(core.centralSchemaSnapshot(c,{compact,nativeConstraints:compact}),/UNSUPPORTED_NOT_NULL_CONSTRAINT/);
    checks.push({name:'NONCANONICAL_NOT_NULL_REJECTED',status:'PASS'});
   }finally{await c.query('ROLLBACK');}
   await c.query('BEGIN');try{
    await c.query('CREATE TABLE public.gcni_metadata_probe(id integer NOT NULL)');const before=await compare();
    const name=(await c.query("SELECT conname FROM pg_constraint WHERE conrelid='public.gcni_metadata_probe'::regclass AND contype='n'")).rows[0].conname;
    assert.match(name,/^[a-z_0-9]+$/);await c.query('ALTER TABLE public.gcni_metadata_probe RENAME CONSTRAINT '+name+' TO renamed_canonical_nn');
    assert.equal(await compare(),before);checks.push({name:'CANONICAL_NOT_NULL_NORMALIZATION_UNCHANGED',status:'PASS'});
   }finally{await c.query('ROLLBACK');}
  }
  assert.equal(await compare(),baseline);return {status:'PASS',postgresMajor:major,checks};
 }finally{c.release();}
}
module.exports={run};
