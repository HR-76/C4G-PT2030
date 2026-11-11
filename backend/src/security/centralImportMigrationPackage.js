'use strict';
const previous=require('./catalogReadMigrationPackage').entries.at(-1);
const PACKAGE_ID='central-pt2030-upload-preview-v1';
const CENTRAL_BASELINE=previous.version;
const entry=Object.freeze({...previous,
 version:'049_pt2030_document_upload',file:'pt2030_document_upload.up.sql',
 requiresPreflightVersion:CENTRAL_BASELINE,
 requiresCatalogSecurityFingerprint:previous.catalogSecurityFingerprint,
 upChecksum:'32cf42389c452ed438814037c7e7eea21ced97589e26c7d66fe8d0c822ece890',
 schemaFingerprint:'bbe825879291e3377ccaf04d7c493ef1a5b9d40894e5d19f63326cedc9416ab2',
 euWriterSecurityFingerprint:'abb189d58e3799a7e8a7d4c2fd774cff045175de439e3546acc6067651033d39',
 centralImportSecurity:true
});
module.exports={PACKAGE_ID,CENTRAL_BASELINE,entry};
