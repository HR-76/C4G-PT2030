'use strict';
const { createFundingRepository } = require('../fundingTenders/repository');
const { createPlatformAudit } = require('../fundingTenders/audit');
const { createCentralPortugal2030Import } = require('./centralImport');
const { createPlanCandidateArchive } = require('./candidateArchive');

// Explicit construction only. No environment switch, route or worker registers
// this composition until central document and SQL gates have been satisfied.
function createCentralPortugal2030CandidateComposition({ pool, documents, audit = createPlatformAudit({ source: 'API' }), clock, assertSession = async()=>{} } = {}) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('A central transaction pool is required.');
  const central = createFundingRepository({ pool });
  return createCentralPortugal2030Import({
    transactions: { run: work => central.transaction(async client=>{await assertSession(client);return work(client)}) },
    authority: { assertAdministrator: (client, userId, { lock }) => central.administrator(client, userId, lock) },
    documents, archive: createPlanCandidateArchive({ audit }), ...(clock ? { clock } : {})
  });
}

module.exports = { createCentralPortugal2030CandidateComposition };
