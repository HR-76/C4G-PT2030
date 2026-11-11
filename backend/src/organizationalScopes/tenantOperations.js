'use strict';
const { createAuthorizedTenantOperationCatalog } = require('../security/tenantOperationCatalog');
const VERSION='f13-p1-tenant-operations-v1';
const SCHEMA_VERSION='006_f13_p1_organizational_scope';
const PROFILE_SCHEMA_VERSION='007_f13_profile_catalogs_and_policies';
const CAPABILITIES=Object.freeze(['F13_P1_ORGANIZATIONAL_SCOPE','F7_AUDIT_LEDGER']);
const DEFINITIONS=Object.freeze([
 Object.freeze({operationCode:'ORGANIZATIONAL_SCOPE_READ',accessMode:'READ',permission:'ORGANIZATIONAL_SCOPE_READ'}),
 Object.freeze({operationCode:'ORGANIZATIONAL_SCOPE_CREATE',accessMode:'WRITE',permission:'ORGANIZATIONAL_SCOPE_CREATE'}),
 Object.freeze({operationCode:'ORGANIZATIONAL_SCOPE_RENAME',accessMode:'WRITE',permission:'ORGANIZATIONAL_SCOPE_RENAME'}),
 Object.freeze({operationCode:'ORGANIZATIONAL_SCOPE_REPARENT',accessMode:'WRITE',permission:'ORGANIZATIONAL_SCOPE_REPARENT'}),
 Object.freeze({operationCode:'ORGANIZATIONAL_SCOPE_ARCHIVE',accessMode:'WRITE',permission:'ORGANIZATIONAL_SCOPE_ARCHIVE'})
]);
const inputSchema=Object.freeze({validate(value){if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)return false;try{return Buffer.byteLength(JSON.stringify(value))<=32768;}catch{return false;}}});
const resultSchema=Object.freeze({validate(value){try{JSON.stringify(value);return value!==undefined;}catch{return false;}}});
function createF13P1TenantOperations({handlers,authorizationOperationCatalog}){
 if(!handlers||Object.getPrototypeOf(handlers)!==Object.prototype||Reflect.ownKeys(handlers).length!==DEFINITIONS.length||DEFINITIONS.some(d=>typeof handlers[d.operationCode]!=='function'))throw new TypeError('F13-P1 tenant operation handlers are incomplete or open.');
 const modules=Object.freeze(Object.fromEntries(DEFINITIONS.map(d=>[d.operationCode,Object.freeze({moduleCode:`${d.operationCode}_QUERY`,execute:handlers[d.operationCode]})])));
 const operations=Object.freeze(DEFINITIONS.map(d=>Object.freeze({operationCode:d.operationCode,ownerModule:'F13_P1_ORGANIZATIONAL_SCOPE',accessMode:d.accessMode,workload:'API',workloadClass:'FUNCTIONAL',queryModule:modules[d.operationCode],compatibleSchemaVersions:Object.freeze([SCHEMA_VERSION,PROFILE_SCHEMA_VERSION,'008_f13_profile_authoring_and_assertions','009_f13_competencies_and_experience','010_f13_financial_capacity','011_f13_operational_capacity','012_f13_territories_and_populations','014_f4_runtime_metadata_access','015_f12_opportunity_xlsx_import','016_f13_editorial_baseline_publication','017_opportunity_evidenced_criteria','018_f13_pq1_publication','019_f13_pq1_activation','020_f14_pq1_decisions','021_application_first_slice','022_application_team_tasks']),requiredCapabilities:CAPABILITIES,allowedCompatibilityStates:Object.freeze(['COMPATIBLE']),readOnlyEligible:false,inputSchema,resultSchema,requiredPermission:d.permission,limits:Object.freeze({maxPageSize:100,maxRows:100,maxBytes:1048576}),timeoutMs:5000})));
 const catalog=createAuthorizedTenantOperationCatalog(Object.freeze({catalogVersion:VERSION,operations}),authorizationOperationCatalog);
 const adapters=Object.freeze(Object.fromEntries(DEFINITIONS.map(d=>[d.operationCode,Object.freeze({operationCode:d.operationCode,queryModule:modules[d.operationCode]})])));
 return Object.freeze({catalog,adapters,modules,version:VERSION});
}
module.exports={CAPABILITIES,DEFINITIONS,PROFILE_SCHEMA_VERSION,SCHEMA_VERSION,VERSION,createF13P1TenantOperations};
