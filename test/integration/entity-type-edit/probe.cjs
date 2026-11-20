 'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const backend=path.resolve(__dirname,'../../../backend');
const migration=require(path.join(backend,'src/security/centralMigrationManifest'));
const runner=require(path.join(backend,'scripts/runCentralMigrations'));
const schema=require(path.join(backend,'src/security/centralSchemaManifest'));
const security=require(path.join(backend,'src/security/authoritySecurityManifest'));
async function run({pool,base,port}){
 const userDeletion=process.env.ENTITY_TYPE_GATE_USER_DELETION==='1',stagingLogins=process.env.ENTITY_TYPE_GATE_STAGING_LOGINS==='1';
 if(userDeletion&&stagingLogins)throw Error('UNREHEARSED_VARIANT_COMBINATION');
 await pool.query('CREATE ROLE c4g_central_owner NOLOGIN; CREATE ROLE c4g_central_runtime NOLOGIN');
 await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL); INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
 await runner.applyCentralMigrationsWithManifest(pool,migration.centralImportManifest,migration.migrationSql);
 await runner.applyRegisteredBillingPdfsPackage(pool,'billing-private-documents-v1');
 await runner.applyRegisteredEmailTemplatesPackage(pool,'email-templates-v1');
 await runner.applyRegisteredCentralRuntimeReadPackage(pool,'central-runtime-read-v1');
 await runner.applyRegisteredOpportunityComplementPackage(pool,'opportunity-complement-v1');
 if(userDeletion){
  await pool.query(require(path.join(backend,'src/platformOnboarding/memberEmailSecurityPackage')).load().sql);
  await require(path.join(backend,'scripts/staging/userDeletionRollout')).rollout(pool,{mode:'apply',expectedDatabase:'postgres'});
 }
 await runner.applyRegisteredBillingValidationPackage(pool,'billing-account-validation-v1');
 if(stagingLogins){
  for(const login of ['c4g_central_staging_api','c4g_central_staging_worker']){
   await pool.query(`CREATE ROLE ${login} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'synthetic-gate-only'`);
   await pool.query(`GRANT c4g_central_runtime TO ${login} WITH INHERIT TRUE, SET FALSE, ADMIN FALSE`);
   await pool.query(`GRANT CONNECT ON DATABASE postgres TO ${login}`);
  }
  const staging=require(path.join(backend,'src/security/stagingCentralRuntimeAdmission'));process.env[staging.FLAG]=staging.VALUE;
 }
 assert.equal((await require(path.join(backend,'src/security/centralMigrationPreflight')).preflightCentral(pool)).currentVersion,'054_billing_account_validation');
 const sql=migration.canonicalizeMigrationSql(fs.readFileSync(path.join(backend,'database/central/candidates/entity_type_edit.up.sql'),'utf8'));
 if(process.env.ENTITY_TYPE_GATE_CALIBRATE==='1'){await pool.query('BEGIN');try{await pool.query(sql);await pool.query('COMMIT')}catch(e){await pool.query('ROLLBACK');throw e;}}
 else{
  assert.equal((await runner.applyRegisteredEntityTypePackage(pool,'entity-type-edit-v1')).length,1);
  assert.deepEqual(await runner.applyRegisteredEntityTypePackage(pool,'entity-type-edit-v1'),[]);
  assert.equal((await require(path.join(backend,'src/security/centralMigrationPreflight')).preflightCentral(pool)).currentVersion,'055_entity_type_edit');
  await security.assertAuthoritySecurity(pool,'055_entity_type_edit');
  assert.equal(await require(path.join(backend,'src/security/catalogReaderSchema')).assertCatalogReaderSchema(pool),'055_entity_type_edit');
  await require('./behaviors.cjs').verify(pool,port);
 }
 if(userDeletion){
  const definition=(await pool.query("SELECT pg_get_functiondef('authority_api.execute(text,text[],text)'::regprocedure) AS value")).rows[0].value;
  const {createHash}=require('node:crypto');
  for(const query of [require(path.join(backend,'src/platformOnboarding/memberSql')).emailDelivery,...Object.values(require(path.join(backend,'src/platformDirectory/deletionSql')))])assert.ok(definition.includes(createHash('sha256').update(query).digest('hex')),'existing authority extension retained');
 }
 const result={variant:userDeletion?'member-email-and-user-deletion':stagingLogins?'staging-logins':'generic',upChecksum:migration.migrationChecksumPolicy(sql).checksum,schemaFingerprint:schema.schemaFingerprint(await schema.centralSchemaSnapshot(pool,{compactAuthority:true})),authoritySecurityFingerprint:security.digest(await security.authoritySecuritySnapshot(pool))};
 assert.equal((await pool.query("SELECT has_column_privilege('c4g_authority_owner','public.organization','type_code','UPDATE') AS allowed")).rows[0].allowed,true);
 assert.equal((await pool.query("SELECT has_column_privilege('c4g_central_runtime','public.organization','type_code','UPDATE') AS allowed")).rows[0].allowed,false);
 fs.writeFileSync(path.join(base,'fingerprints.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
module.exports={run};
