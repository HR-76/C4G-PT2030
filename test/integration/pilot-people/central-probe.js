'use strict';
const {Pool}=require('../../../backend/node_modules/pg'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {applyCentralMigrations}=require('../../../backend/scripts/runCentralMigrations');
const {centralSchemaSnapshot,schemaFingerprint}=require('../../../backend/src/security/centralSchemaManifest');
const {authoritySecuritySnapshot,digest}=require('../../../backend/src/security/authoritySecurityManifest');
const {migrationChecksumPolicy}=require('../../../backend/src/security/centralMigrationManifest');
(async()=>{
 const target=new URL(process.env.F13_S2_ADMIN_URL);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'5594');
 const p=new Pool({connectionString:target.toString()});try{
  await p.query("CREATE ROLE c4g_central_owner NOLOGIN; CREATE ROLE c4g_central_runtime NOLOGIN; CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL); INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
  await require('../../../backend/scripts/runCentralMigrations').applyCentralMigrationsWithManifest(p,Object.freeze(require('../../../backend/src/security/centralMigrationManifest').manifest.filter(e=>e.version<'016')),require('../../../backend/src/security/centralMigrationManifest').migrationSql);
  const beforeSnapshot=await centralSchemaSnapshot(p),before=schemaFingerprint(beforeSnapshot),beforeAuthority=digest(await authoritySecuritySnapshot(p));
  async function admission(){
   const authorityPool={query:(...args)=>p.query(...args),async connect(){const c=await p.connect();await c.query('SET SESSION AUTHORIZATION c4g_authority_runtime');return {query:(...args)=>c.query(...args),release:error=>c.release(error||Error('PROBE_CONNECTION_DISPOSED'))}}};
   const coordinator=require('../../../backend/src/security/authorityCoordinator').createAuthorityCoordinator({pool:authorityPool,permitSecret:'disposable-schema-compatibility-proof-only'});
   await coordinator.snapshotEpochs(['POLICY']);
  }
  await admission();
  const up=fs.readFileSync(path.resolve(__dirname,'../../../backend/database/central/migrations/016_membership_access.up.sql'),'utf8').replace(/\r\n/g,'\n'),down=fs.readFileSync(path.resolve(__dirname,'../../../backend/database/central/migrations/016_membership_access.down.sql'),'utf8').replace(/\r\n/g,'\n');
  await p.query(up);
  // A changed security schema without its matching ledger must still fail closed.
  await assert.rejects(admission);
  console.log(JSON.stringify({version:'016_membership_access',upChecksum:migrationChecksumPolicy(up).checksum,downChecksum:migrationChecksumPolicy(down).checksum,schemaFingerprint:schemaFingerprint(await centralSchemaSnapshot(p)),authoritySecurityFingerprint:digest(await authoritySecuritySnapshot(p))}));
  await p.query(down);const afterSnapshot=await centralSchemaSnapshot(p);function differences(a,b,key='root'){if(JSON.stringify(a)===JSON.stringify(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const k of new Set([...Object.keys(a),...Object.keys(b)]))differences(a[k],b[k],key+'.'+k)}else{const x=String(a),y=String(b);let i=0;while(x[i]===y[i]&&i<x.length)i++;console.log('DIFF',key,i,x.slice(Math.max(0,i-40),i+100),y.slice(Math.max(0,i-40),i+100))}}differences(beforeSnapshot,afterSnapshot);assert.equal(schemaFingerprint(await centralSchemaSnapshot(p)),before);assert.equal(digest(await authoritySecuritySnapshot(p)),beforeAuthority);
  console.log('MEMBERSHIP_CENTRAL_MIGRATION_ROLLBACK_PASS');
  await applyCentralMigrations(p);await admission();console.log('AUTHORITY_ADMISSION_015_016_AND_DRIFT_PASS');
 }finally{await p.end()}
})().catch(e=>{console.error(e.code||e.name,e.message);process.exitCode=1});
