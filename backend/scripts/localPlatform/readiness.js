'use strict';
// Verify the real Central database and an existing tenant.
const { supportsCentralVersion } = require('./centralVersions');
function createNativeReadiness({centralPool,probeTenant,admissionRequired}){
 async function check(){const dependencies={central:{status:'unhealthy'},tenant:{status:'unhealthy'}};
  try{const result=await require('../../src/security/centralMigrationPreflight').preflightCentral(centralPool);if(admissionRequired&&!supportsCentralVersion(result.currentVersion,'025_entity_admission_completion'))throw Error('ADMISSION_SCHEMA_REQUIRED');dependencies.central.status='healthy';await probeTenant();dependencies.tenant.status='healthy';return {ready:true,dependencies};}catch{return {ready:false,dependencies};}
 }
 return {check,async assertReady(){if(!(await check()).ready)throw Error('LOCAL_DATABASE_NOT_READY');}};
}
module.exports={createNativeReadiness};
