'use strict';
const previous = require('./emailDeliveryMigrationPackage').entry;
const PACKAGE_ID = 'production-central-permissions-v1';
const CENTRAL_BASELINE = previous.version;
const entry = Object.freeze({ ...previous, version: '057_production_central_permissions',
  file: 'production_central_permissions.up.sql', requiresPreflightVersion: CENTRAL_BASELINE,
  irreversible: true, productionPermissions: true,
  upChecksum: '9ed39c76da6261753f0bfce22bb90b713bb499fa2b2e46e6ca85e766527b17a2',
  schemaFingerprint: '8076e82b5c95658571cd331503b2b7af27ddcff4af1a75b5d3f1005bf2536dfe',
  authoritySecurityFingerprint: '3dcc49fabfd76650760be87f9d74e135fe7f35ca7e826ee8f91a49a6f17c2f92',
  catalogSecurityFingerprint: 'cbf754e67d08e4d4da72fa78c4fece1c0fb0a37faa81f6ebbfe8bc681174b602',
  euWriterSecurityFingerprint: '0d50c2b0added35af76afb86783bcba34c151f969cec692eab2a1d7e59601b9c',
  euRunReconciliationSecurityFingerprint: '040b426fc45dc4af1c2e2b36a0c9056ac28a1e84119704f314d5bdd1f7f3fb82',
  euLegacyPrearchiveSecurityFingerprint: 'd960c020d800e12656fad7a32e7795219090aca8debc0f09ff7e05a38bbec1c5',
  readFingerprint: '007fcfaa1a206d287d8aa776596153f95f2135aa7bfce16d04c7c5ed8b64e6dc',
  productionSecurityFingerprint: '7863be506cb4637c31df92fc4d714f05b4be6ea14d0f8e0aeb47886cde6e424a',
});
module.exports = { PACKAGE_ID, CENTRAL_BASELINE, entry };
