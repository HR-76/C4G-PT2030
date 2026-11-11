'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {opportunityPreflight}=require('../src/opportunities/preflight');
const {manifest}=require('../src/security/tenantMigrationManifest');

test('F12 preflight accepts the complete cumulative tenant 033 catalog',async()=>{
  const m=require('../src/security/tenantMigrationManifest');
  const version='033_organizational_opportunity_interests';
  const entry=m.manifest.find(item=>item.version===version);
  const tables=[...new Set(m.manifest.filter(item=>item.ordinal<=entry.ordinal).flatMap(item=>
    [...m.migrationSql(item.version,'up').sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? opportunity_catalog\.([a-z_][a-z0-9_]*)/gi)].map(match=>match[1])))].sort();
  const fallback=fixture(entry);
  const pool={async query(sql){
    if(sql.includes('AS table_name'))return {rows:tables.map(table_name=>({table_name}))};
    if(sql.includes('c.relrowsecurity'))return {rows:[{count:tables.length}]};
    return fallback.query(sql);
  }};
  assert.equal((await opportunityPreflight(pool,'tenant')).ready,true);
});

function fixture(entry,drift,version='170000'){
  const m=require('../src/security/tenantMigrationManifest');
  const tables=entry.ordinal===undefined?[]:[...new Set(m.manifest.filter(item=>item.ordinal<=entry.ordinal).flatMap(item=>
    [...m.migrationSql(item.version,'up').sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? opportunity_catalog\.([a-z_][a-z0-9_]*)/gi)].map(match=>match[1])))];
  if(drift==='extra')tables.push('unexpected_table');
  if(drift==='missing')tables.splice(tables.indexOf('opportunity'),1);
  return {async query(sql){
    if(sql==='SHOW server_version_num')return {rows:[{server_version_num:version}]};
    if(sql.includes('FROM c4g_system.schema_migration'))return {rows:[{migration_id:entry.version}]};
    if(sql.includes('AS table_name'))return {rows:tables.sort().map(table_name=>({table_name}))};
    if(sql.includes('FROM pg_catalog.pg_roles'))return {rows:Array.from({length:3},()=>({rolcanlogin:false,rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolbypassrls:false}))};
    if(sql.includes('pg_get_constraintdef'))return {rows:[{definition:'OPPORTUNITY_CREATED OPPORTUNITY_RECONCILIATION_REQUIRED'}]};
    if(sql.includes('c.relrowsecurity'))return {rows:[{count:tables.length}]};
    if(sql.includes('has_table_privilege'))return {rows:[{allowed:true,destructive:false,foreign_keys:3,indexes:5}]};
    throw new Error('Unexpected preflight query');
  }};
}
for(const entry of manifest.filter(item=>item.ordinal>=12)){
  test(`F12 preflight retains cumulative tables at ${entry.version}`,async()=>{
    assert.equal((await opportunityPreflight(fixture(entry),'tenant')).ready,true);
    for(const drift of ['extra','missing'])await assert.rejects(()=>opportunityPreflight(fixture(entry,drift),'tenant'),/OPPORTUNITY_SCHEMA_DRIFT/);
  });
}
test('F12 preflight rejects an unknown tenant revision',async()=>{
  await assert.rejects(()=>opportunityPreflight(fixture({version:'unknown',capabilities:[]}),'tenant'),/OPPORTUNITY_SCHEMA_DRIFT/);
});
test('F12 preflight admits PostgreSQL 18 and rejects unknown majors', async()=>{
  const entry=manifest.at(-1);
  assert.equal((await opportunityPreflight(fixture(entry,null,'180003'),'tenant')).major,18);
  for(const version of ['160000','190000'])await assert.rejects(()=>opportunityPreflight(fixture(entry,null,version),'tenant'),/OPPORTUNITY_POSTGRES_VERSION_INCOMPATIBLE/);
});

test('Central user migrations retain funding tables and still reject catalog drift',async()=>{
 const inherited=fixture(manifest.at(-1));
 for(const version of ['020_platform_onboarding','021_platform_members','027_platform_billing','032_single_organization_membership','033_funding_coverage','034_funding_temporal_refresh']){
  for(const drift of [null,'missing','extra']){
   const tables=['duplicate_candidate','idempotency_record','opportunity','provenance','revision','funding_run','funding_run_item','funding_identity','funding_observation'];
   if(version>='033_funding_coverage')tables.push('funding_cycle','funding_batch','funding_cycle_seen');
   if(version==='034_funding_temporal_refresh')tables.push('funding_refresh_target');
   if(drift==='missing')tables.pop();if(drift==='extra')tables.push('unexpected_table');
   const pool={async query(sql){
    if(sql.includes('FROM public.c4g_schema_migration'))return {rows:[{version}]};
    if(sql.includes('AS table_name'))return {rows:tables.sort().map(table_name=>({table_name}))};
    return inherited.query(sql);
   }};
   if(drift)await assert.rejects(()=>opportunityPreflight(pool,'central'),/OPPORTUNITY_SCHEMA_DRIFT/);
   else assert.equal((await opportunityPreflight(pool,'central')).ready,true);
  }
 }
});
