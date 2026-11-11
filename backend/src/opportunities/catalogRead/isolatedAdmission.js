'use strict';
// Explicit composition capability, never enabled from HTTP input or environment.
// Rehearsal-only dedicated logins remain separate from normal package admission.
const contracts=new WeakSet();
const manifest=require('./readPackage.schema.json');
const base=require('../../security/centralMigrationManifest');
const core=require('../../security/centralSchemaManifest');
const security=require('../../security/authoritySecurityManifest');
const preflight=require('../../security/centralMigrationPreflight');
const runner=require('../../../scripts/runCentralMigrations');
const {fingerprint}=require('./readSchema');
function createIsolatedAdmission({isolated,databaseName,readerLogin,authorityLogin}={}){
 if(isolated!==true||![databaseName,readerLogin,authorityLogin].every(x=>typeof x==='string'&&/^[a-z][a-z0-9_]{2,62}$/.test(x))||readerLogin===authorityLogin)throw new TypeError('Explicit isolated database and dedicated logins required');
 require('./ledgerContract');
 const contract=Object.freeze({async admit(client){
  const identity=(await client.query('SELECT current_database() AS database,session_user,current_user')).rows[0];
  if(identity?.database!==databaseName)throw Error('ISOLATED_DATABASE_REQUIRED');
  if(identity.session_user!=='c4g_authority_runtime'||identity.current_user!==identity.session_user)throw Error('AUTHORITY_LOGIN_REQUIRED');
  const versions=(await client.query('SELECT version FROM public.c4g_schema_migration ORDER BY version')).rows;
  if(!versions.some(r=>r.version===manifest.entries[0].version))return security.assertAuthorityAdmission(client);
  let open=false;
  try{
   await client.query('BEGIN READ ONLY');open=true;
   await client.query('SELECT pg_advisory_xact_lock_shared($1)',[42420002]);
   const postgresMajor=await preflight.assertSupportedPostgresMajor(client);await runner.assertCentralMarker(client);
   const rows=(await client.query('SELECT version,checksum_sha256,irreversible FROM public.c4g_schema_migration ORDER BY version')).rows;
   const expected=[...base.prearchiveManifest,...manifest.entries];
   const requirements=require('./ledgerContract').requirements;
   const records=runner.validateAppliedMigrationLedger(rows,'isolated candidate refused',expected,requirements);
   if(records.size!==expected.length)throw Error('CATALOG_READ_LEDGER_DRIFT');
   const snapshot=await core.centralSchemaSnapshot(client,{compact:true,nativeConstraints:true});
   if(core.schemaFingerprint(snapshot)!==manifest.coreFingerprint)throw Error('CATALOG_READ_CORE_DRIFT');
   if(await fingerprint(client,readerLogin,authorityLogin)!==manifest.fingerprint)throw Error('CATALOG_READ_SCHEMA_OR_PERMISSION_DRIFT');
   // This digest is transitively pinned by the complete core fingerprint above.
   const authorityFingerprint=security.digest(snapshot.authoritySecurity);
   await client.query('COMMIT');open=false;
   return Object.freeze({postgresMajor,currentVersion:expected.at(-1).version,fingerprint:manifest.coreFingerprint,authorityFingerprint});
  }catch(e){if(open)await client.query('ROLLBACK');throw e;}
 },async verifyLocked(client,admitted){
  if(!admitted.authorityFingerprint)return security.assertAuthoritySecurity(client,admitted.currentVersion);
  const snapshot=await security.authoritySecuritySnapshot(client,{compact:true});
  if(!snapshot||security.digest(snapshot)!==admitted.authorityFingerprint)throw Error('AUTHORITY_SECURITY_DRIFT');
 }});
 contracts.add(contract);return contract;
}
module.exports={createIsolatedAdmission,isIsolatedAdmission:contract=>contracts.has(contract)};
