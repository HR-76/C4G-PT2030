'use strict';
const previous=require('./opportunityEuLegacyPrearchiveMigrationPackage').entry;
const raw=[
  {
    "version": "046_catalog_read_projection_v1",
    "file": "catalog_read_projection_v1.up.sql",
    "irreversible": true,
    "upChecksum": "33e4c6d90017824ec168decc04bfff3b3cb4487e771936678ca09f8b8b3956f3",
    "runtimeAdmissible": false
  },
  {
    "version": "047_catalog_read_admission_v1",
    "file": "catalog_read_admission_v1.up.sql",
    "irreversible": true,
    "upChecksum": "d8683bb92205ba31bc31035d3635c1f3c9157a63486e62a808c9a88721dbfe61",
    "runtimeAdmissible": false
  },
  {
    "version": "048_catalog_read_service_v1",
    "file": "catalog_read_service_v1.up.sql",
    "irreversible": true,
    "upChecksum": "78e0ce6bc77f75cdbeef2e14ab03021882e8220a0f28af90ee2d2eda3a1f4992",
    "schemaFingerprint": "f97daac28a88cff3027f3d16caaf537ef37bbc0d19a6dbc6323f9b59d516abe2",
    "authoritySecurityFingerprint": "a91abbdbf1a6a0ca1aafc436d3d22f9dc61e093817941d045465775b1bec0f48",
    "readFingerprint": "007fcfaa1a206d287d8aa776596153f95f2135aa7bfce16d04c7c5ed8b64e6dc",
    "runtimeAdmissible": true
  }
];
const entries=Object.freeze(raw.map(e=>Object.freeze(e.runtimeAdmissible?{...previous,...e,catalogSecurityFingerprint:'d1919e355a17a87ab1703eb2fe178f64542f0ca8984267c3ea467ac3074c3c0a',euWriterSecurityFingerprint:'1a0c4151e161a4a4a3000f74fe781df721c075becddade9f47495f0fdceec277',requiresPreflightVersion:undefined}:e)));
module.exports={entries};
