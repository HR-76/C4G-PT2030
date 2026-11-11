'use strict';
const fs=require('node:fs'),path=require('node:path');
async function main(){
 let db;
 try{
  const fixtureReport={};db=await require('../http-oidc/fixture').databaseFixture(fixtureReport);
  const migration=require('../../../backend/src/security/centralMigrationManifest');
  const tools=require('../../../backend/scripts/runCentralMigrations');
  const installer=await db.central.pool.connect();
  try{
   await installer.query('ALTER ROLE c4g_f12_admin SUPERUSER');
   await installer.query('SET SESSION AUTHORIZATION c4g_f12_admin');
   const pool={connect:async()=>({query:(...args)=>installer.query(...args),release(){}})};
   await tools.applyCentralMigrationsWithManifest(pool,migration.centralImportManifest,migration.migrationSql);
   await tools.applyRegisteredBillingPdfsPackage(pool,'billing-private-documents-v1');
  }finally{
   await installer.query('RESET SESSION AUTHORIZATION');
   await installer.query('ALTER ROLE c4g_f12_admin NOSUPERUSER');installer.release();
  }
  const result=await require('../metadata-remediation/proof.cjs').run(db.central);
  const folder=path.join(__dirname,'../../../context/reviews/metadata-remediation-pg18-current-20261106');
  fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({...result,postgres:fixtureReport.postgres},null,2)+'\n');
  console.log('PASS CURRENT_SCHEMA '+result.version+' '+result.checks.length+' checks');
 }finally{await db?.close();}
}
main().catch(error=>{console.error('CURRENT_METADATA_PROOF_FAILED',error.code||error.name);console.error(String(error.stack).split('\n').filter(line=>line.trim().startsWith('at ')).slice(0,3).join('\n'));process.exitCode=1;});
