'use strict';
// Separate opt-in package. The accepted 11145 package remains byte-identical.
const PACKAGE_ID='opportunity-eu-writer-v2';
const CENTRAL_BASELINE='042_opportunity_eu_source_control_v2';
const entry=Object.freeze({
 version:'043_opportunity_eu_writer_v2',irreversible:true,acceptsHistoricalCrlfChecksum:false,
 requiresPreflightVersion:CENTRAL_BASELINE,
 requiresCatalogSecurityFingerprint:'b981504c0b991748fc33f2c073c5a4d9538f7038da821dbc8bd5fe906ee0574e',
 upChecksum:'68562ede29f9c6063105c132331d7defb7b776d6ad5e928b3b1e843925af3f62',
 schemaFingerprint:'ec582c27bdd4472cff543f2dd3edd77f55bfc552881d1acd560e481dd1df9591',
 authoritySecurityFingerprint:'ef5207fd05f4223c7ad824984e897542c3ea99f44a59211c8410aa64313a928f',
 catalogSecurityFingerprint:'677c31faad484bdd4afb9ea874d8a17556c44cadc9c08dba9e210112dec495cb',
 euWriterSecurityFingerprint:'00b44563b67e28912d8b71db5c0b0e09b7e396b5e8754ca99b870a31168db3da'
});
const packageDigest=require('node:crypto').createHash('sha256').update(JSON.stringify({packageId:PACKAGE_ID,centralBaseline:CENTRAL_BASELINE,entry}),'utf8').digest('hex');
function assertPackageId(value){if(value!==PACKAGE_ID)throw new TypeError('EU writer migration package is not registered.');return PACKAGE_ID;}
module.exports=Object.freeze({PACKAGE_ID,CENTRAL_BASELINE,entry,packageDigest,assertPackageId});
