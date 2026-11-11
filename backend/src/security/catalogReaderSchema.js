'use strict';
const versions=Object.freeze(['029_catalog_reader','030_application_responsibles',
 '031_tenant_directory_resolution','032_single_organization_membership','033_funding_coverage','034_funding_temporal_refresh','035_funding_source_resolution','042_opportunity_eu_source_control_v2','043_opportunity_eu_writer_v2','044_opportunity_eu_expired_reconciliation','045_opportunity_eu_legacy_prearchive','048_catalog_read_service_v1','049_pt2030_document_upload','050_billing_private_documents']);
const admissions=new WeakSet();
function admittedReaderVersion(fingerprint,manifest){
 const entry=manifest.find(item=>versions.includes(item.version)&&(item.schemaFingerprint===fingerprint||require('./memberEmailAdmission').admits(item.version,'schema',fingerprint)));
 if(!entry)throw Error('CATALOG_READER_SCHEMA_DRIFT');
 return entry.version;
}
async function assertCatalogReaderSchema(client){
 try {
  return (await require('./centralSchemaManifest').assertCentralSchemaForVersions(client,versions)).version;
 } catch(error) {
  if(error.code==='CENTRAL_SCHEMA_VERSION_NOT_ADMITTED')throw Error('CATALOG_READER_SCHEMA_DRIFT');
  throw error;
 }
}
async function createReaderSchemaAdmission(client){
 const version=await assertCatalogReaderSchema(client);
 if(!versions.includes(version))throw Error('CATALOG_READER_SCHEMA_DRIFT');
 const admission=Object.freeze({version});admissions.add(admission);return admission;
}
const isReaderSchemaAdmission=value=>admissions.has(value);
module.exports={assertCatalogReaderSchema,admittedReaderVersion,createReaderSchemaAdmission,isReaderSchemaAdmission};
