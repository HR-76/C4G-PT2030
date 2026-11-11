'use strict';
const PACKAGE_ID='opportunity-eu-expired-reconciliation-v1';
const CENTRAL_BASELINE='043_opportunity_eu_writer_v2';
// Independently measured on PostgreSQL 18 in a rolled-back isolated migration.
const entry=Object.freeze({version:'044_opportunity_eu_expired_reconciliation',irreversible:true,acceptsHistoricalCrlfChecksum:false,
 requiresPreflightVersion:CENTRAL_BASELINE,requiresCatalogSecurityFingerprint:'677c31faad484bdd4afb9ea874d8a17556c44cadc9c08dba9e210112dec495cb',
 upChecksum:'afadcb18620fed476affae75421c074b34bd6f983209d962e2468295c2355a6c',schemaFingerprint:'f2798ef14b31a27d4b706c97234bf79650520bc12891b8f62207d11c82fe3e41',authoritySecurityFingerprint:'eb5f1c51a34ce0219b929629d4918cf152bda95d44fb9209a58d08d076992f7e',catalogSecurityFingerprint:'e555853a5df214eef5cc64c4f4021de6a2db672373c53cc7809270ed19d1e4b7',euWriterSecurityFingerprint:'6865b34b57d98c558baa0be42e22cefa46c6530042129b44e2a1d38587c8d71a',euRunReconciliationSecurityFingerprint:'e66ba2eb826162ed9343d4193d01fb9cd0888ba81cf8c0cb562933c231c014ff'});
const packageDigest=require('node:crypto').createHash('sha256').update(JSON.stringify({packageId:PACKAGE_ID,centralBaseline:CENTRAL_BASELINE,entry})).digest('hex');
function assertPackageId(value){if(value!==PACKAGE_ID)throw new TypeError('EU expired reconciliation package is not registered.');return PACKAGE_ID;}
module.exports=Object.freeze({PACKAGE_ID,CENTRAL_BASELINE,entry,packageDigest,assertPackageId});
