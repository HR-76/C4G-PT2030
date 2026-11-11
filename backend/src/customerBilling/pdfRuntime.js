'use strict';
const {createPdfRepository}=require('./pdfRepository');
const {createPdfService}=require('./pdfService');
function configuredBillingPdfs({pool,customerService,env=process.env}) {
  if(!env.BILLING_PDF_RUNTIME||env.BILLING_PDF_RUNTIME==='disabled')return null;
  if(!['private','local-private'].includes(env.BILLING_PDF_RUNTIME))throw TypeError('BILLING_PDF_RUNTIME_INVALID');
  const local=env.BILLING_PDF_RUNTIME==='local-private';
  if(local&&env.NODE_ENV!=='development')throw TypeError('LOCAL_BILLING_DEVELOPMENT_ONLY');
  const config=local?{scanner:{host:'127.0.0.1',port:3310}}:require('../config/applicationDocuments').loadApplicationDocumentConfiguration(env),ports=new Map();
  function forOrg(organizationId){
    if(!ports.has(organizationId)){
      const storage=local?require('./localStorage').createLocalBillingStorage({root:env.BILLING_PDF_LOCAL_ROOT,organizationId,environment:env.NODE_ENV}):require('../documents/r2Storage').createR2Storage(config.r2,{organizationId,credentials:config.credentials});
      const scanner=require('../documents/clamavScanner').createClamavScanner({organizationId,storage,...config.scanner});
      ports.set(organizationId,{storage,scanner});
    }return ports.get(organizationId);
  }
  const service=createPdfService({repository:createPdfRepository(pool),storageFactory:org=>forOrg(org).storage,scannerFactory:org=>forOrg(org).scanner,
    customerAuthorize:async request=>(await customerService.execute('authorizePdf',{},null,request)).organizationId});
  return {service,async ready(){await require('../security/centralSchemaManifest').assertCentralSchema(pool,'050_billing_private_documents');const probe=forOrg('00000000-0000-4000-8000-000000000001');if(!(await probe.storage.health()).ready||!(await probe.scanner.health()).ready)throw Error('BILLING_PDF_INFRASTRUCTURE_UNAVAILABLE')},async close(){await Promise.all([...ports.values()].map(value=>value.storage.shutdown()))}};
}
module.exports={configuredBillingPdfs};
