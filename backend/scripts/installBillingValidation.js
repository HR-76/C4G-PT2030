 'use strict';
// Explicit operator entrypoint. No automatic installation on API/worker startup.
const {Pool}=require('pg');
const {preflightCentral}=require('../src/security/centralMigrationPreflight');
const {applyRegisteredBillingValidationPackage}=require('./runCentralMigrations');
const {PACKAGE_ID,entry}=require('../src/security/billingValidationMigrationPackage');
async function install({pool,apply=false}) {
 const before=await preflightCentral(pool);
 if(!apply)return {currentVersion:before.currentVersion,targetVersion:entry.version,applied:false};
 await applyRegisteredBillingValidationPackage(pool,PACKAGE_ID);
 const after=await preflightCentral(pool);
 return {currentVersion:after.currentVersion,applied:true};
}
if(require.main===module){
 if(process.argv.slice(2).some(arg=>arg!=='--apply')||!process.env.CENTRAL_MIGRATION_DATABASE_URL){process.stderr.write('Use CENTRAL_MIGRATION_DATABASE_URL and optionally --apply.\n');process.exitCode=1}
 else {
  const pool=new Pool({connectionString:process.env.CENTRAL_MIGRATION_DATABASE_URL,max:1});
  install({pool,apply:process.argv.includes('--apply')}).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(()=>{process.stderr.write('BILLING_VALIDATION_INSTALL_REFUSED\n');process.exitCode=1}).finally(()=>pool.end());
 }
}
module.exports={install};
