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
  const schema=require('../../../backend/src/security/centralSchemaManifest');
  const c=await db.central.authorityPool.connect(),samples=[];
  try{
   const a=await schema.centralSchemaSnapshot(c,{compactAuthority:true});
   const b=await schema.centralSchemaSnapshot(c,{compactAuthority:true,nativeConstraints:true});
   require('node:assert/strict').equal(JSON.stringify(a),JSON.stringify(b));
   for(let i=0;i<45;i++)for(const variant of i%2?['D','C','B','A']:['A','B','C','D']){
    const start=performance.now();await schema.centralSchemaSnapshot(c,{compactAuthority:true,nativeConstraints:['B','D'].includes(variant),compact:['C','D'].includes(variant)});
    if(i>=5)samples.push({variant,ms:performance.now()-start});
   }
  }finally{c.release();}
  const result={status:'PASS',samples};
  const folder=path.join(__dirname,'../../../context/reviews/page-performance-core-probe-20261106');
  fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({...result,postgres:fixtureReport.postgres},null,2)+'\n');
  console.log('PASS NATIVE PROBE');
 }finally{await db?.close();}
}
main().catch(error=>{console.error('CURRENT_METADATA_PROOF_FAILED',error.code||error.name);console.error(String(error.stack).split('\n').filter(line=>line.trim().startsWith('at ')).slice(0,3).join('\n'));process.exitCode=1;});
