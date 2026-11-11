'use strict';
const {createTenantMigrationRunner}=require('../../../backend/src/security/tenantMigrationRunner');
const {manifest}=require('../../../backend/src/security/tenantMigrationManifest');
function request(tenantId,databaseGenerationId,label){return Object.freeze({tenantId,databaseGenerationId,expectedRevision:1,correlationId:`synthetic-${label}`,idempotencyKey:`synthetic-${label}`});}
function createRunner(pool,publications=[]){return createTenantMigrationRunner({pool,observationPublisher:{async publish(value){publications.push(value);}},timeoutMs:10000,scheduler:{setTimeout,clearTimeout}});}
async function migrateTenant(pool,{tenantId,databaseGenerationId,label}){const publications=[];const result=await createRunner(pool,publications).migrate(request(tenantId,databaseGenerationId,label));if(result.evidence.currentVersion!==manifest.at(-1).version)throw new Error('F12_VERTICAL_TENANT_VERSION_INCOMPATIBLE');return Object.freeze({result,publications:Object.freeze(publications)});}
module.exports={createRunner,migrateTenant,request};
