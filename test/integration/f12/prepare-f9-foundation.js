'use strict';
const {Pool}=require('../../../backend/node_modules/pg');
const {applyCentralMigrationsWithManifest}=require('../../../backend/scripts/runCentralMigrations');
const {manifest,migrationSql}=require('../../../backend/src/security/centralMigrationManifest');
async function main(){const pool=new Pool({connectionString:process.env.F9_TEST_DATABASE_URL,max:2});try{await pool.query(`CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')`);const target=manifest.findIndex(entry=>entry.version==='004_f9_async_execution');if(target<0)throw new Error('F9_CANONICAL_MIGRATION_MISSING');await applyCentralMigrationsWithManifest(pool,manifest.slice(0,target+1),migrationSql);}finally{await pool.end();}}
main().catch(error=>{process.stderr.write(`${error.code||error.name}: ${error.message}\n`);process.exitCode=1;});
