'use strict';
module.exports=async function upgrade(db){
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
};
