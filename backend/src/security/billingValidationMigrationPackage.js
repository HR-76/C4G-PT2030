'use strict';
const previous=require('./opportunityComplementMigrationPackage').entry;
const PACKAGE_ID='billing-account-validation-v1';
const CENTRAL_BASELINE=previous.version;
const entry=Object.freeze({...previous,version:'054_billing_account_validation',file:'billing_account_validation.up.sql',requiresPreflightVersion:CENTRAL_BASELINE,
 upChecksum:"d78ed7c6777e3b82b33a72cc28a887711375f526ea1e4f55ef9a16f7e9044f5f",schemaFingerprint:'630b7a37ab3d7a30560e1231d3280b2f423c516daf9d3bd66fcbb7d865c46b11',authoritySecurityFingerprint:'fb9cbdf237482d65a132de85efe2db95ef8930c7a521ffa754ef245760f1ab1f'});
module.exports={PACKAGE_ID,CENTRAL_BASELINE,entry};
