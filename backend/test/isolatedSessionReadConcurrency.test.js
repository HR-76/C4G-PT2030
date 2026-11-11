'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),{runInThisContext}=require('node:vm');
const lookup='SELECT sess FROM "public"."application_session_store" WHERE sid = $1 AND expire >= to_timestamp($2)';
function fixture(){
 const sqls=[],cap={async admit(){sqls.push('ADMIT');return {};},async verifyLocked(){sqls.push('VERIFY_LOCKED');}};
 const file=path.resolve(__dirname,'../src/security/authorityCoordinator.js'),real=createRequire(file),module={exports:{}};
 const req=id=>id==='../opportunities/catalogRead/isolatedAdmission'?{isIsolatedAdmission:v=>v===cap}:id==='./authorityProtocolQueries'?{execute:async(_c,sql)=>{sqls.push('WORK:'+sql);return {rows:[]};}}:real(id);
 runInThisContext('(function(require,module,exports){'+fs.readFileSync(file,'utf8')+'\n})',{filename:file})(req,module,module.exports);
 const pool={query(){},async connect(){return {
  on(){},removeListener(){},release(){},
  async query(sql){sqls.push(sql);return {rows:sql.includes('c4g_database_identity')?[{valid:true}]:[]};}
 };}};
 return {sqls,cap,pool,create:module.exports.createAuthorityCoordinator};
}
test('isolated exact session lookup uses read-only shared lock and still verifies admission under lock',async()=>{
 const f=fixture(),c=f.create({pool:f.pool,permitSecret:'x'.repeat(32),isolatedCatalogAdmission:f.cap,isolatedSessionReadConcurrency:true});
 await c.pool.query(lookup,['synthetic',123]);
 assert(f.sqls.includes('BEGIN READ ONLY'));assert(f.sqls.includes('SELECT pg_advisory_xact_lock_shared(43001306,1)'));
 assert(f.sqls.indexOf('ADMIT')<f.sqls.indexOf('BEGIN READ ONLY'));assert(f.sqls.indexOf('VERIFY_LOCKED')>f.sqls.indexOf('SELECT pg_advisory_xact_lock_shared(43001306,1)'));
 assert(f.sqls.indexOf('VERIFY_LOCKED')<f.sqls.findIndex(x=>x.startsWith('WORK:')));
});
test('default, other SELECTs and authority callbacks retain exclusive read-write coordination',async()=>{
 for(const [enabled,sql] of [[false,lookup],[true,'SELECT sess FROM public.application_session_store WHERE sid=$1'],[true,lookup+'; SELECT 1']]){
  const f=fixture(),c=f.create({pool:f.pool,permitSecret:'x'.repeat(32),isolatedCatalogAdmission:f.cap,isolatedSessionReadConcurrency:enabled});
  await c.pool.query(sql,['synthetic',123]);assert(f.sqls.includes('BEGIN'));assert(f.sqls.includes('SELECT pg_advisory_xact_lock(43001306,1)'));assert(!f.sqls.includes('BEGIN READ ONLY'));
 }
 const f=fixture(),c=f.create({pool:f.pool,permitSecret:'x'.repeat(32),isolatedCatalogAdmission:f.cap,isolatedSessionReadConcurrency:true});
 await c.withAuthority(async()=>{});assert(f.sqls.includes('SELECT pg_advisory_xact_lock(43001306,1)'));
});
test('shared session lookup cannot be enabled without the isolated admission capability',()=>{
 const f=fixture();assert.throws(()=>f.create({pool:f.pool,permitSecret:'x'.repeat(32),isolatedSessionReadConcurrency:true}),/Isolated admission required/);
});
