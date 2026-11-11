'use strict';
const assert=require('node:assert/strict');
const {Pool}=require('../../../backend/node_modules/pg');
const {applyCentralMigrationsWithManifest,validateAppliedMigrationLedger}=require('../../../backend/scripts/runCentralMigrations');
const {manifest,migrationSql}=require('../../../backend/src/security/centralMigrationManifest');
const {centralSchemaSnapshot,schemaFingerprint}=require('../../../backend/src/security/centralSchemaManifest');
const name='f12_synthetic_central_manifest',failureName='f12_synthetic_central_manifest_failure';
function config(database){const source=new URL(process.env.F12_GATE_URL);source.pathname=`/${database}`;return{connectionString:source.toString(),max:2};}
async function main(){const admin=new Pool(config('postgres'));let pool,failurePool;try{
 for(const role of ['c4g_central_owner','c4g_central_runtime'])await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$`);
 await admin.query(`CREATE DATABASE ${name} ENCODING 'UTF8' TEMPLATE template0`);pool=new Pool(config(name));
 await pool.query(`CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')`);
 const observed={};for(let index=0;index<manifest.length;index+=1){const prefix=manifest.slice(0,index+1);const applied=await applyCentralMigrationsWithManifest(pool,prefix,migrationSql);assert.deepEqual(applied,[manifest[index].version]);observed[manifest[index].version]=schemaFingerprint(await centralSchemaSnapshot(pool));}
 assert.deepEqual(await applyCentralMigrationsWithManifest(pool,manifest,migrationSql),[]);
 const ledger=(await pool.query('SELECT version,checksum_sha256,irreversible FROM public.c4g_schema_migration ORDER BY version')).rows;validateAppliedMigrationLedger(ledger);assert.deepEqual(ledger.map(row=>row.version),manifest.map(entry=>entry.version));
 if(process.env.F12_CAPTURE_FINGERPRINTS==='1')process.stdout.write(`${JSON.stringify(observed,null,2)}\n`);else for(const entry of manifest)assert.equal(observed[entry.version],entry.schemaFingerprint,`fingerprint ${entry.version}`);
 await admin.query(`CREATE DATABASE ${failureName} ENCODING 'UTF8' TEMPLATE template0`);failurePool=new Pool(config(failureName));
 await failurePool.query(`CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')`);
 await applyCentralMigrationsWithManifest(failurePool,manifest.slice(0,-1),migrationSql);
 await assert.rejects(()=>applyCentralMigrationsWithManifest(failurePool,manifest,migrationSql,{afterSql:({entry})=>{if(entry.version===manifest.at(-1).version)throw new Error('F44_AFTER_SQL_BEFORE_LEDGER');}}),/F44_AFTER_SQL_BEFORE_LEDGER/);
 assert.equal(schemaFingerprint(await centralSchemaSnapshot(failurePool)),manifest.at(-2).schemaFingerprint);
 assert.equal((await failurePool.query('SELECT count(*)::int n FROM public.c4g_schema_migration')).rows[0].n,manifest.length-1);
 assert.deepEqual(await applyCentralMigrationsWithManifest(failurePool,manifest,migrationSql),[manifest.at(-1).version]);
 process.stdout.write(`${JSON.stringify({canonicalCentralRunner:true,incremental:true,idempotent:true,ledger:true,rollbackBetweenSqlAndLedger:true,retry:true,versions:manifest.length})}\n`);
 }finally{if(pool)await pool.end();if(failurePool)await failurePool.end();for(const database of [name,failureName]){await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]).catch(()=>{});await admin.query(`DROP DATABASE IF EXISTS ${database}`).catch(()=>{});}await admin.end();}}
main().catch(error=>{process.stderr.write(`${error.code||error.name}: ${error.message}\n${error.stack||''}\n`);process.exitCode=1;});
