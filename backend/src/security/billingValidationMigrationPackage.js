'use strict';
const previous=require('./opportunityComplementMigrationPackage').entry;
const PACKAGE_ID='billing-account-validation-v1';
const CENTRAL_BASELINE=previous.version;
const entry=Object.freeze({...previous,version:'054_billing_account_validation',file:'billing_account_validation.up.sql',requiresPreflightVersion:CENTRAL_BASELINE,
 upChecksum:'d9582ccec166ce4ac426101d9a5413004faf1e87bd3e44a0918cc7d44b8fb7b4',schemaFingerprint:'1f9f29a79c791932177b83c6627c56a722715938787f7fc87970b53a1d4e3502',authoritySecurityFingerprint:'9f99547d875462a803b736c18c1102053d44f0d2ad6966b63ac072c80e66c957'});
module.exports={PACKAGE_ID,CENTRAL_BASELINE,entry};
