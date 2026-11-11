'use strict';
const assert=require('node:assert/strict');
const {Pool}=require('../../../backend/node_modules/pg');
const runner=require('../../../backend/scripts/runCentralMigrations');
const {manifest,migrationSql}=require('../../../backend/src/security/centralMigrationManifest');
const security=require('../../../backend/src/security/authoritySecurityManifest');
const schema=require('../../../backend/src/security/centralSchemaManifest');
(async()=>{
 const url=new URL(process.env.F13_EDITORIAL_ADMIN_URL);if(url.hostname!=='127.0.0.1'||url.port!=='5588'||process.env.F13_EDITORIAL_DISPOSABLE_PROOF!=='C4G_F13_EDITORIAL_DISPOSABLE_V1')throw Error('Disposable only');
 const pool=new Pool({connectionString:url.toString()});
 try{
  await pool.query('CREATE ROLE c4g_central_owner NOLOGIN;CREATE ROLE c4g_central_runtime NOLOGIN');
  await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
  await runner.applyCentralMigrationsWithManifest(pool,Object.freeze(manifest.slice(0,-1)),migrationSql);
  const c=await pool.connect();try{await c.query('BEGIN');await c.query(migrationSql('014_pq1_decision_lookup','up').sql);
   console.log('014 AUTHORITY',security.digest(await security.authoritySecuritySnapshot(c)));console.log('014 SCHEMA',schema.schemaFingerprint(await schema.centralSchemaSnapshot(c)));
   await c.query(migrationSql('014_pq1_decision_lookup','down').sql);await security.assertAuthoritySecurity(c,'013_pq1_effective_lookup');await c.query('ROLLBACK');console.log('013 EMPTY_UP_DOWN PASS');
  }finally{await c.query('ROLLBACK');c.release();}
  if(process.env.PQ1_CAPTURE!=='1'){await runner.applyCentralMigrations(pool);await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(pool);await runner.rollbackCentralMigration(pool,'014');await runner.applyCentralMigrations(pool);console.log('013 RUNNER_PREFLIGHT_DOWN_UP PASS');}
 }finally{await pool.end();}
})().catch(e=>{console.error(e.code||'FAIL',e.message);process.exitCode=1;});
