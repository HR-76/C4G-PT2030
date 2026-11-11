const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {Pool,assertF4Objects,config,withDatabase}=require('./matrix-support');
const {applyCentralMigrations,applyCentralMigrationsWithManifest,manifest,migrationSql,rollbackCentralMigration,rollbackCentralMigrationWithManifest}=require(path.resolve(__dirname,'../../../backend/scripts/runCentralMigrations'));
const {assertCentralSchema}=require(path.resolve(__dirname,'../../../backend/src/security/centralSchemaManifest'));
const down=fs.readFileSync(path.resolve(__dirname,'../../../backend/database/central/migrations/003_f4_tenant_directory.down.sql'),'utf8');
const admin=new Pool(config('postgres'));
const syntheticEntry=Object.freeze({version:'004_synthetic_later',irreversible:false});const syntheticManifest=Object.freeze([...manifest,syntheticEntry]);
function syntheticLoader(version,direction){if(version!=='004_synthetic_later')return migrationSql(version,direction);const sql=direction==='up'?'CREATE TABLE public.f4_synthetic_004(value integer primary key)':'DROP TABLE public.f4_synthetic_004';const checksum=require('node:crypto').createHash('sha256').update(sql).digest('hex');return{entry:syntheticEntry,sql,checksum,acceptedChecksums:[checksum]};}
(async()=>{try{
 await withDatabase(admin,`c4g_f41_later_${process.pid}`,async pool=>{
  assert.deepEqual(await applyCentralMigrationsWithManifest(pool,syntheticManifest,syntheticLoader),['004_synthetic_later']);
  const before=(await pool.query('SELECT version FROM c4g_schema_migration ORDER BY version')).rows;
  await assert.rejects(()=>rollbackCentralMigrationWithManifest(pool,'003',syntheticManifest,syntheticLoader),/latest applied reversible/);
  assert.deepEqual((await pool.query('SELECT version FROM c4g_schema_migration ORDER BY version')).rows,before);await assertF4Objects(pool);
  assert.equal(await rollbackCentralMigrationWithManifest(pool,'004',syntheticManifest,syntheticLoader),'004_synthetic_later');
  assert.equal((await pool.query("SELECT count(*)::int count FROM c4g_schema_migration WHERE version='004_synthetic_later'")).rows[0].count,0);
  assert.equal((await pool.query("SELECT to_regclass('public.f4_synthetic_004') IS NULL removed")).rows[0].removed,true);
  assert.equal((await pool.query('SELECT version FROM c4g_schema_migration ORDER BY version DESC LIMIT 1')).rows[0].version,'003_f4_tenant_directory');
  await assertCentralSchema(pool,'003_f4_tenant_directory');
  assert.equal(await rollbackCentralMigration(pool,'003'),'003_f4_tenant_directory');
  assert.equal((await pool.query("SELECT count(*)::int count FROM c4g_schema_migration WHERE version='003_f4_tenant_directory'")).rows[0].count,0);
  assert.equal((await pool.query("SELECT to_regclass('public.tenant') IS NULL removed")).rows[0].removed,true);
  assert.equal((await pool.query('SELECT version FROM c4g_schema_migration ORDER BY version DESC LIMIT 1')).rows[0].version,'002_f3_organization_memberships');
  assert.deepEqual(await applyCentralMigrations(pool),['003_f4_tenant_directory']);await assertCentralSchema(pool,'003_f4_tenant_directory');
 });
 await withDatabase(admin,`c4g_f41_mid_down_${process.pid}`,async pool=>{
  const before=(await pool.query('SELECT version,checksum_sha256,irreversible FROM c4g_schema_migration ORDER BY version')).rows;
  const injected=down.replace(/(DROP TABLE[^;]+;)/i,match=>`${match}\nDO $$ BEGIN RAISE EXCEPTION 'deliberate mid-down failure'; END $$;`);
  assert.notEqual(injected,down);const client=await pool.connect();
  try{await client.query('BEGIN');await client.query(injected);assert.fail('Injected down unexpectedly completed.');}catch(error){assert.match(error.message,/deliberate mid-down failure/);await client.query('ROLLBACK');}finally{client.release();}
  await assertF4Objects(pool);await assertCentralSchema(pool,'003_f4_tenant_directory');assert.deepEqual((await pool.query('SELECT version,checksum_sha256,irreversible FROM c4g_schema_migration ORDER BY version')).rows,before);
 });
 console.log('F4.1 rollback atomicity passed for synthetic 004 and deliberate mid-down failure.');
}finally{await admin.end();}})().catch(error=>{console.error(error);process.exitCode=1;});
