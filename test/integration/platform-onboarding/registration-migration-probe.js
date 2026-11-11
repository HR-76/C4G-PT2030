'use strict';
const {Pool}=require('../../../backend/node_modules/pg'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const migrations=require('../../../backend/src/security/centralMigrationManifest');
(async()=>{
 const url=new URL(process.env.F13_S2_ADMIN_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'5599');
 const pool=new Pool({connectionString:url.toString()});try{
  await pool.query("CREATE ROLE c4g_central_owner NOLOGIN; CREATE ROLE c4g_central_runtime NOLOGIN; CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL); INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
  await require('../../../backend/scripts/runCentralMigrations').applyCentralMigrationsWithManifest(pool,Object.freeze(migrations.manifest.filter(e=>e.version<'024')),migrations.migrationSql);
  const version='024_organization_registration',up=fs.readFileSync(path.resolve(__dirname,`../../../backend/database/central/migrations/${version}.up.sql`),'utf8');await pool.query(up);
  const schema=require('../../../backend/src/security/centralSchemaManifest'),security=require('../../../backend/src/security/authoritySecurityManifest');
  const result={version,irreversible:true,acceptsHistoricalCrlfChecksum:false,schemaFingerprint:schema.schemaFingerprint(await schema.centralSchemaSnapshot(pool)),authoritySecurityFingerprint:security.digest(await security.authoritySecuritySnapshot(pool)),upChecksum:migrations.migrationChecksumPolicy(up).checksum};
  const out=path.resolve(__dirname,'../../../output/playwright/c4g-registration');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,version+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await pool.end();}
})().catch(e=>{console.error(e.code||e.name,e.message);process.exitCode=1;});
