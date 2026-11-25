'use strict';
const previous=require('./productionCentralMigrationPackage').entry;
const PACKAGE_ID='platform-account-lifecycle-v1';
const CENTRAL_BASELINE=previous.version;
const entry=Object.freeze({...previous,version:'058_platform_account_lifecycle',
 file:'platform_account_lifecycle.up.sql',requiresPreflightVersion:CENTRAL_BASELINE,
 requiresCatalogSecurityFingerprint:previous.catalogSecurityFingerprint,
 irreversible:true,accountLifecycle:true,
 upChecksum:'43b4bb3f832eec9b11155804f3b1d54eb0e35ae828f3dd6d4a8498cb3a8a07c5',
 schemaFingerprint:'7c86b26901348aca49c98b6bc24e1b29aaedc607377bb02bb004ec43c1a62454',
 authoritySecurityFingerprint:'7faed0225461434f065dc1ba46416633f23d2d171f23fd8936251046fcd1f61a'
});
module.exports={PACKAGE_ID,CENTRAL_BASELINE,entry};
