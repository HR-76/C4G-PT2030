 'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
async function run({pool,base,port}) {
 const runner=require('../../../backend/scripts/runCentralMigrations');
 const m=require('../../../backend/src/security/centralMigrationManifest');
 await pool.query('CREATE ROLE c4g_central_owner NOLOGIN; CREATE ROLE c4g_central_runtime NOLOGIN');
 await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL); INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
 await runner.applyCentralMigrationsWithManifest(pool,process.env.PRODUCTION_GATE_FRESH==='1'?m.productionCentralManifest:m.emailDeliveryManifest,m.migrationSql);
 const sql=fs.readFileSync(path.resolve(__dirname,'../../../backend/database/central/candidates/production_central_permissions.up.sql'),'utf8').replace(/\r\n/g,'\n');
 if(process.env.PRODUCTION_GATE_CALIBRATE==='1')await pool.query(sql);
 else {
  assert.equal((await runner.applyRegisteredProductionCentralPackage(pool,'production-central-permissions-v1')).length,process.env.PRODUCTION_GATE_FRESH==='1'?0:1);
  assert.deepEqual(await runner.applyRegisteredProductionCentralPackage(pool,'production-central-permissions-v1'),[]);
 }
 const schema=require('../../../backend/src/security/centralSchemaManifest');
 const authority=require('../../../backend/src/security/authoritySecurityManifest');
 const catalog=require('../../../backend/src/security/catalogSecurityManifest');
 const pins={upChecksum:m.checksumSql(sql),schemaFingerprint:schema.schemaFingerprint(await schema.centralSchemaSnapshot(pool,{compactAuthority:true})),authoritySecurityFingerprint:authority.digest(await authority.authoritySecuritySnapshot(pool)),catalogSecurityFingerprint:catalog.digest(await catalog.catalogSecuritySnapshot(pool))};
 pins.euWriterSecurityFingerprint=require('../../../backend/src/security/euWriterSecurityManifest').digest(await require('../../../backend/src/security/euWriterSecurityManifest').euWriterSecuritySnapshot(pool));
 pins.euRunReconciliationSecurityFingerprint=require('../../../backend/src/security/euRunReconciliationSecurityManifest').digest(await require('../../../backend/src/security/euRunReconciliationSecurityManifest').euRunReconciliationSecuritySnapshot(pool));
 pins.euLegacyPrearchiveSecurityFingerprint=require('../../../backend/src/security/euLegacyPrearchiveSecurityManifest').digest(await require('../../../backend/src/security/euLegacyPrearchiveSecurityManifest').snapshot(pool));
 pins.readFingerprint=await require('../../../backend/src/opportunities/catalogRead/dedicatedCredentials').normalReadFingerprint(pool);
 pins.productionSecurityFingerprint=require('../../../backend/src/security/productionCentralSecurity').digest(await require('../../../backend/src/security/productionCentralSecurity').snapshot(pool));
 fs.writeFileSync(path.join(base,'pins.json'),JSON.stringify(pins,null,2));
 console.log(JSON.stringify(pins));
 if(process.env.PRODUCTION_GATE_CALIBRATE!=='1')await require('./permissions.cjs').run({pool,base,port});
}
module.exports={run};
