'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {applyCentralMigrationsWithManifest}=require('../../../backend/scripts/runCentralMigrations');
const migrations=require('../../../backend/src/security/centralMigrationManifest');
const schema=require('../../../backend/src/security/centralSchemaManifest');
const security=require('../../../backend/src/security/authoritySecurityManifest');

const source=new URL(process.env.C4G_SINGLE_MEMBERSHIP_GATE_URL||'');
if(!['localhost','127.0.0.1','::1'].includes(source.hostname)||source.pathname!=='/postgres')throw Error('DISPOSABLE_LOCAL_POSTGRES_REQUIRED');
const database=`c4g_single_membership_${process.pid}`;
const runnerDatabase=`${database}_runner`;
const target=new URL(source);target.pathname=`/${database}`;
const admin=new Pool({connectionString:source.toString(),max:2});
let pool,runner;
const org=()=>({id:randomUUID(),legal:'Synthetic',display:'Synthetic',slug:`synthetic-${randomUUID()}`,type:'COMPANY'});
async function insertOrganization(client,value){await client.query(`INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code,data_residency_code) VALUES($1,$2,$3,$4,$5,'ACTIVE','EUR','USER_OPTIONAL','EU')`,[value.id,value.legal,value.display,value.slug,value.type]);}
async function main(){try{
 for(const role of ['c4g_central_owner','c4g_central_runtime'])await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$`);
 await admin.query(`CREATE DATABASE ${database} ENCODING 'UTF8' TEMPLATE template0`);pool=new Pool({connectionString:target.toString(),max:4});pool.on('error',()=>{});
 await pool.query(`CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')`);
 await pool.query(`CREATE TABLE public.c4g_schema_migration(version text PRIMARY KEY,checksum_sha256 text NOT NULL,irreversible boolean NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`);
 const [a,b,c]=[org(),org(),org()],user=randomUUID(),concurrentUser=randomUUID(),first=randomUUID(),conflict=randomUUID();
 const prior=migrations.manifest.slice(0,-1);for(const entry of prior){
  await pool.query(migrations.migrationSql(entry.version,'up').sql);
  if(entry.version==='002_f3_organization_memberships'){
   for(const value of [a,b,c])await insertOrganization(pool,value);
   await pool.query(`INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Synthetic','single@example.invalid','ACTIVE'),($2,'Concurrent','concurrent@example.invalid','ACTIVE')`,[user,concurrentUser]);
   await pool.query(`INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) VALUES($1,$2,$3,'ORG_ADMIN','ACTIVE',clock_timestamp()),($4,$2,$5,'ORG_ADMIN','ACTIVE',clock_timestamp())`,[first,user,a.id,conflict,b.id]);
  }
 }
 const up=migrations.migrationSql('032_single_organization_membership','up').sql;
 await assert.rejects(pool.query(up),/SINGLE_MEMBERSHIP_EXISTING_CONFLICT/);
 assert.equal((await pool.query(`SELECT to_regclass('public.organization_membership_single_entity_uidx') AS value`)).rows[0].value,null);
 await pool.query(`ALTER TABLE public.organization_membership DISABLE TRIGGER USER`);
 await pool.query(`UPDATE public.organization_membership SET status='REMOVED',removed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`,[conflict]);
 await pool.query(`ALTER TABLE public.organization_membership ENABLE TRIGGER USER`);
 await pool.query(up);
 const fingerprint=schema.schemaFingerprint(await schema.centralSchemaSnapshot(pool));
 const authorityFingerprint=security.digest(await security.authoritySecuritySnapshot(pool));
 await pool.query(`ALTER TABLE public.organization_membership DISABLE TRIGGER USER`);
 await assert.rejects(pool.query(`INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status) VALUES($1,$2,$3,'CONTRIBUTOR','PENDING_PROJECTION')`,[randomUUID(),user,c.id]),error=>error.code==='23505'&&error.constraint==='organization_membership_single_entity_uidx');
 await pool.query(`UPDATE public.organization_membership SET status='REMOVED',removed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`,[first]);
 await pool.query(`INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,suspended_at) VALUES($1,$2,$3,'CONTRIBUTOR','SUSPENDED',clock_timestamp())`,[randomUUID(),user,c.id]);
 const one=await pool.connect(),two=await pool.connect();try{
  await one.query('BEGIN');await two.query('BEGIN');
  await one.query(`INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status) VALUES($1,$2,$3,'CONTRIBUTOR','PENDING_PROJECTION')`,[randomUUID(),concurrentUser,a.id]);
  const competing=two.query(`INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status) VALUES($1,$2,$3,'CONTRIBUTOR','PENDING_PROJECTION')`,[randomUUID(),concurrentUser,b.id]);
  await new Promise(resolve=>setTimeout(resolve,50));await one.query('COMMIT');
  await assert.rejects(competing,error=>error.code==='23505'&&error.constraint==='organization_membership_single_entity_uidx');await two.query('ROLLBACK');
 }finally{await one.query('ROLLBACK').catch(()=>{});await two.query('ROLLBACK').catch(()=>{});one.release();two.release();}
 await pool.query(`ALTER TABLE public.organization_membership ENABLE TRIGGER USER`);
 await admin.query(`CREATE DATABASE ${runnerDatabase} ENCODING 'UTF8' TEMPLATE template0`);const runnerTarget=new URL(source);runnerTarget.pathname=`/${runnerDatabase}`;runner=new Pool({connectionString:runnerTarget.toString(),max:2});runner.on('error',()=>{});
 await runner.query(`CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')`);
 assert.deepEqual(await applyCentralMigrationsWithManifest(runner,migrations.manifest,migrations.migrationSql),migrations.manifest.map(entry=>entry.version));
 assert.equal(schema.schemaFingerprint(await schema.centralSchemaSnapshot(runner)),fingerprint);
 process.stdout.write(`${JSON.stringify({preflightConflict:true,singleMembership:true,removedHistory:true,concurrentInsert:true,canonicalRunner:true,schemaFingerprint:fingerprint,authoritySecurityFingerprint:authorityFingerprint})}\n`);
 }finally{if(pool)await pool.end();if(runner)await runner.end();for(const name of [database,runnerDatabase]){await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]).catch(()=>{});await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(()=>{});}await admin.end();}}
main().catch(error=>{process.stderr.write(`${error.code||error.name}: ${error.message}\n${error.stack||''}\n`);process.exitCode=1;});
