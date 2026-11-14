'use strict';
const previous=require('./opportunityComplementMigrationPackage').entry;
const PACKAGE_ID='billing-account-validation-v1';
const CENTRAL_BASELINE=previous.version;
const entry=Object.freeze({...previous,version:'054_billing_account_validation',file:'billing_account_validation.up.sql',requiresPreflightVersion:CENTRAL_BASELINE,
 upChecksum:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',schemaFingerprint:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',authoritySecurityFingerprint:'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'});
module.exports={PACKAGE_ID,CENTRAL_BASELINE,entry};
