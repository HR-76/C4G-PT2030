'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const migration=require('../../../backend/src/security/centralMigrationManifest'),schema=require('../../../backend/src/security/centralSchemaManifest'),security=require('../../../backend/src/security/authoritySecurityManifest');
async function run({pool,base,port}){
 await pool.query('CREATE ROLE c4g_central_owner NOLOGIN; CREATE ROLE c4g_central_runtime NOLOGIN');
 await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL); INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
 if(process.env.BILLING_EMAIL_VARIANT==='1'){
  await require('../../../backend/scripts/runCentralMigrations').applyCentralMigrationsWithManifest(pool,migration.catalogReadManifest,migration.migrationSql);
  await pool.query(migration.canonicalizeMigrationSql(fs.readFileSync(path.resolve(__dirname,'../../../backend/database/central/candidates/member_email_delivery.up.sql'),'utf8')));
 }
 await require('../../../backend/scripts/runCentralMigrations').applyCentralMigrationsWithManifest(pool,migration.centralImportManifest,migration.migrationSql);
 await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(pool);
 const sql=fs.readFileSync(path.resolve(__dirname,'../../../backend/database/central/candidates/billing_private_documents.up.sql'),'utf8');
 if(process.env.PDF_CALIBRATE==='1')await pool.query(migration.canonicalizeMigrationSql(sql));else {
 await require('../../../backend/scripts/runCentralMigrations').applyRegisteredBillingPdfsPackage(pool,'billing-private-documents-v1');
 assert.deepEqual(await require('../../../backend/scripts/runCentralMigrations').applyRegisteredBillingPdfsPackage(pool,'billing-private-documents-v1'),[]);
 }
 const result={upChecksum:migration.migrationChecksumPolicy(sql).checksum,schemaFingerprint:schema.schemaFingerprint(await schema.centralSchemaSnapshot(pool)),authoritySecurityFingerprint:security.digest(await security.authoritySecuritySnapshot(pool))};
 fs.writeFileSync(path.join(base,'fingerprints.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 assert.equal((await pool.query("SELECT has_table_privilege('c4g_central_runtime','public.billing_document_file','INSERT') allowed")).rows[0].allowed,false);
 assert.equal((await pool.query("SELECT has_table_privilege('c4g_central_runtime','public.billing_document_file','SELECT') allowed")).rows[0].allowed,true);
 await require('./behaviors.cjs').verify({pool,port});
}
module.exports={run};
