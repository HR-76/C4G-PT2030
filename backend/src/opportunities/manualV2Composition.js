'use strict';
const { createFundingRepository } = require('../fundingTenders/repository');
const { createPlatformAudit } = require('../fundingTenders/audit');
const { createCentralManualAuthoringV2 } = require('./manualV2');
const { createManualCandidateArchiveV2 } = require('./manualV2Archive');

// Explicit candidate composition only; intentionally not registered in HTTP,
// runtime startup, migration manifests, the worker or the accepted v1 form.
function createCentralManualCandidateCompositionV2({ pool, audit = createPlatformAudit({ source: 'API' }), clock } = {}) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('Manual v2 requires a central pool.');
  const central = createFundingRepository({ pool });
  return createCentralManualAuthoringV2({
    transactions: { run: work => central.transaction(work) },
    authority: { assertAdministrator: (client, userId, { lock }) => central.administrator(client, userId, lock) },
    archive: createManualCandidateArchiveV2({ audit }), ...(clock ? { clock } : {})
  });
}
module.exports = { createCentralManualCandidateCompositionV2 };
