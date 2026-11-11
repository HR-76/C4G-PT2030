'use strict';
const previous=require('./centralImportMigrationPackage').entry;
const PACKAGE_ID='billing-private-documents-v1';
const CENTRAL_BASELINE=previous.version;
const entry=Object.freeze({...previous,version:'050_billing_private_documents',file:'billing_private_documents.up.sql',
 requiresPreflightVersion:CENTRAL_BASELINE,
 upChecksum:'901b71aac21a0081b3a1a85da2d98e40661f69889c97ee3de1a852be5c0e092a',
 schemaFingerprint:'656feafce96ce9ba6232fe0fb7e843f7c645764c8a22aad6c59535e7ebce2178',
 authoritySecurityFingerprint:'1770e67c3edf071d818ff23661dcf4f0d52245da2b17a800898e23adff8cb58b'
});
module.exports={PACKAGE_ID,CENTRAL_BASELINE,entry};
