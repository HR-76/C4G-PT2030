 'use strict';
const previous=require('./billingValidationMigrationPackage').entry;
const PACKAGE_ID='entity-type-edit-v1';
const CENTRAL_BASELINE=previous.version;
const entry=Object.freeze({...previous,version:'055_entity_type_edit',file:'entity_type_edit.up.sql',requiresPreflightVersion:CENTRAL_BASELINE,
 upChecksum:'68e331cbfb8dc477bc389c32e90ee9cd0c407e9414795e3d296572f4ae9f9188',schemaFingerprint:'b8a252dbf83f8c8b30fbc8e998558ae61040b4668f6cf78bbb49bf5c0944c1c9',authoritySecurityFingerprint:'8c027b38ed8c347080bd5a49341642983e06dd89c0e066f24191338948338a86'});
module.exports={PACKAGE_ID,CENTRAL_BASELINE,entry};
