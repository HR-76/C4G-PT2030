'use strict';
// Explicitly selected, registered package. Default migration targets remain Central035/tenant033.
// SQL bytes remain in candidates to preserve the previously measured artifacts.
const PACKAGE_ID='opportunity-v2-activation-11145';
const CENTRAL_BASELINE='035_funding_source_resolution';
const TENANT_BASELINE='033_organizational_opportunity_interests';
const centralEntries=Object.freeze([
  {
    "version": "036_funding_canonical_v2",
    "irreversible": true,
    "acceptsHistoricalCrlfChecksum": false,
    "requiresPreflightVersion": "035_funding_source_resolution",
    "requiresCatalogSecurityFingerprint": "b0676b4c7a82eea86f8cf7d8f9b56cbfbac18b2dce8efd80860f193acaaacbc5",
    "upChecksum": "c729f6d1048a6ccf5592cf903e6e717a16bccca108aa3c307ab1837f4a742a75",
    "schemaFingerprint": "4e7fb2b1fcef69b3dec9b050010c1df49aa74833521d5ae63f82a2b10e98b130",
    "authoritySecurityFingerprint": "78509ec8a5d7ca7682c29c5fd0a8b15c42423bda969ca6fa6024be1061216b2b",
    "catalogSecurityFingerprint": "b0676b4c7a82eea86f8cf7d8f9b56cbfbac18b2dce8efd80860f193acaaacbc5"
  },
  {
    "version": "037_manual_opportunity_v2",
    "irreversible": true,
    "acceptsHistoricalCrlfChecksum": false,
    "requiresPreflightVersion": "036_funding_canonical_v2",
    "requiresCatalogSecurityFingerprint": "b0676b4c7a82eea86f8cf7d8f9b56cbfbac18b2dce8efd80860f193acaaacbc5",
    "upChecksum": "07302055a705a30b4b6e5fb3ab537e1b9e6b1c8031988d5bcdfec155538ec990",
    "schemaFingerprint": "dd02376be9e6fb329afb87f7b3371218600ab2f9fe1620776b8b427699412b0d",
    "authoritySecurityFingerprint": "78509ec8a5d7ca7682c29c5fd0a8b15c42423bda969ca6fa6024be1061216b2b",
    "catalogSecurityFingerprint": "b0676b4c7a82eea86f8cf7d8f9b56cbfbac18b2dce8efd80860f193acaaacbc5"
  },
  {
    "version": "038_pt2030_plan_v2",
    "irreversible": true,
    "acceptsHistoricalCrlfChecksum": false,
    "requiresPreflightVersion": "037_manual_opportunity_v2",
    "requiresCatalogSecurityFingerprint": "b0676b4c7a82eea86f8cf7d8f9b56cbfbac18b2dce8efd80860f193acaaacbc5",
    "upChecksum": "fb9d9e46ea2382dd9086343c5b6f685a946519942065c459975d872d922c45d5",
    "schemaFingerprint": "bcf9730df2dcc1ef4b94c87067be5c2dd248958aeb47b6deaeb6c9991c300b61",
    "authoritySecurityFingerprint": "78509ec8a5d7ca7682c29c5fd0a8b15c42423bda969ca6fa6024be1061216b2b",
    "catalogSecurityFingerprint": "b0676b4c7a82eea86f8cf7d8f9b56cbfbac18b2dce8efd80860f193acaaacbc5"
  },
  {
    "version": "039_opportunity_persistence_v2",
    "irreversible": true,
    "acceptsHistoricalCrlfChecksum": false,
    "requiresPreflightVersion": "038_pt2030_plan_v2",
    "requiresCatalogSecurityFingerprint": "b0676b4c7a82eea86f8cf7d8f9b56cbfbac18b2dce8efd80860f193acaaacbc5",
    "upChecksum": "fb2b973a11b8be7909452287416050ed2199f6b1bfd0b2d2b419a09f8f1d9f2c",
    "schemaFingerprint": "aff5929a7773753bc63c32ec7d3e0cf72e59711804b10ddb3c18a6a12a47e049",
    "authoritySecurityFingerprint": "78509ec8a5d7ca7682c29c5fd0a8b15c42423bda969ca6fa6024be1061216b2b",
    "catalogSecurityFingerprint": "b0676b4c7a82eea86f8cf7d8f9b56cbfbac18b2dce8efd80860f193acaaacbc5"
  },
  {
    "version": "040_opportunity_activation_authority_v2",
    "irreversible": true,
    "acceptsHistoricalCrlfChecksum": false,
    "requiresPreflightVersion": "039_opportunity_persistence_v2",
    "requiresCatalogSecurityFingerprint": "b0676b4c7a82eea86f8cf7d8f9b56cbfbac18b2dce8efd80860f193acaaacbc5",
    "upChecksum": "06cfde591666f079bfd97db3e2ba0c3504770541ab7bd1c82139c8567c0108d5",
    "schemaFingerprint": "8ff6a715a925b13d78fe181973032f0620acd6de8202f4fc4bfcbd24e360b956",
    "authoritySecurityFingerprint": "acb6daf8d58e240e14b5ce57e2228eb857ac37229b4700b735385576c0521286",
    "catalogSecurityFingerprint": "b0676b4c7a82eea86f8cf7d8f9b56cbfbac18b2dce8efd80860f193acaaacbc5"
  },
  {
    "version": "041_opportunity_activation_approval_v2",
    "irreversible": true,
    "acceptsHistoricalCrlfChecksum": false,
    "requiresPreflightVersion": "040_opportunity_activation_authority_v2",
    "requiresCatalogSecurityFingerprint": "b0676b4c7a82eea86f8cf7d8f9b56cbfbac18b2dce8efd80860f193acaaacbc5",
    "upChecksum": "b75daef91a24886fe42baf2a79823f0cb121fa22ca6a1785dba404dd36d0e879",
    "schemaFingerprint": "a90a0f06dddf1f33d71bc5076771e97b91c0e9d8313d3f0823a694971059af15",
    "authoritySecurityFingerprint": "acb6daf8d58e240e14b5ce57e2228eb857ac37229b4700b735385576c0521286",
    "catalogSecurityFingerprint": "b0676b4c7a82eea86f8cf7d8f9b56cbfbac18b2dce8efd80860f193acaaacbc5"
  },
  {
    "version": "042_opportunity_eu_source_control_v2",
    "irreversible": true,
    "acceptsHistoricalCrlfChecksum": false,
    "requiresPreflightVersion": "041_opportunity_activation_approval_v2",
    "requiresCatalogSecurityFingerprint": "b0676b4c7a82eea86f8cf7d8f9b56cbfbac18b2dce8efd80860f193acaaacbc5",
    "upChecksum": "c4b371d8a75f89567645c08f83e244ffa49fb386639175c8c2a53e526288b747",
    "schemaFingerprint": "0cb6ef8f6e00cc8e9209864addab966c9772a9bb5d886b0165d49a67e1d21e82",
    "authoritySecurityFingerprint": "acb6daf8d58e240e14b5ce57e2228eb857ac37229b4700b735385576c0521286",
    "catalogSecurityFingerprint": "b981504c0b991748fc33f2c073c5a4d9538f7038da821dbc8bd5fe906ee0574e"
  }
].map(entry=>Object.freeze(entry)));
const tenantAddition=Object.freeze({
  "version": "034_application_snapshot_v2",
  "ordinal": 34,
  "irreversible": true,
  "sqlChecksum": "5be4eba00f11eb28b4756ec5d8a29fc08191a8e74133f25056a5315b244c77d7",
  "schemaFingerprint": "731d37b0fbe3a2af7484710d8bbc4a1f3bd0f4687f42b1b8e0c14602346a63e3"
});
const TENANT_CAPABILITY='APPLICATION_OPPORTUNITY_SNAPSHOT_V2';
const packageDigest=require('node:crypto').createHash('sha256').update(JSON.stringify({
  packageId:PACKAGE_ID,centralBaseline:CENTRAL_BASELINE,tenantBaseline:TENANT_BASELINE,
  centralEntries,tenantAddition,tenantCapability:TENANT_CAPABILITY
}),'utf8').digest('hex');
function assertPackageId(value){if(value!==PACKAGE_ID)throw new TypeError('Migration package is not registered.');return PACKAGE_ID;}
module.exports=Object.freeze({PACKAGE_ID,CENTRAL_BASELINE,TENANT_BASELINE,TENANT_CAPABILITY,packageDigest,centralEntries,tenantAddition,assertPackageId});
