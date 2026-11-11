const { validateR2Configuration } = require('./r2Adapter');
const {createApplicationDocumentAuthorizationAdapter}=require('../applications/documentAuthorizationAdapter');
const {createApplicationDocumentTransport}=require('./applicationTransport');
function validateProductionDocumentsBootstrap({r2=null,migrationReady=false,scannerReady=false,reconciliationLagSeconds=null,runtime=null}={}){
  const reasons=[];if(!migrationReady)reasons.push('MIGRATION_PREFLIGHT_REQUIRED');if(!scannerReady)reasons.push('SCANNER_NOT_CONFIGURED');try{validateR2Configuration(r2);}catch{reasons.push('R2_LAYER_C_NOT_VALIDATED');}if(reconciliationLagSeconds!==null&&reconciliationLagSeconds>300)reasons.push('RECONCILIATION_LATE');
  if(!runtime)reasons.push('DOCUMENT_RUNTIME_NOT_COMPOSED');
  return Object.freeze({ready:reasons.length===0,reasons:Object.freeze(reasons),runtime:runtime||null,storageAdapter:null,scanner:null,handlers:Object.freeze([])});
}
function createProductionDocumentRuntime({applicationService,infrastructure,clock=()=>new Date()}){
 if(!infrastructure||!['repositoryFactory','storageFactory','auditFactory','reconciliationFactory'].every(key=>typeof infrastructure[key]==='function')||typeof infrastructure.jobs?.enqueueScan!=='function')throw new TypeError('Document runtime requires explicit F11/F9 infrastructure.');
 return createApplicationDocumentTransport({accessPort:createApplicationDocumentAuthorizationAdapter({applicationService}),repositoryFactory:infrastructure.repositoryFactory,storageFactory:infrastructure.storageFactory,auditFactory:infrastructure.auditFactory,reconciliationFactory:infrastructure.reconciliationFactory,jobs:infrastructure.jobs,clock,id:infrastructure.id,downloadStaging:infrastructure.downloadStaging});
}
module.exports={createProductionDocumentRuntime,validateProductionDocumentsBootstrap};
