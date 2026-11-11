'use strict';
// No database connection. Validates all package artifacts as candidate inputs.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { loadPackage, listPackage } = require('../backend/src/opportunities/v2/euLegacyPreapproval');
const { archiveBatch } = require('../backend/src/opportunities/v2/euLegacyArchiveBatch');
const { createCandidateArchiveV2 } = require('../backend/src/fundingTenders/candidateRepositoryV2');

async function main(argv = process.argv.slice(2)) {
  assert(argv.length === 1 && /^[a-f0-9-]{36}$/.test(argv[0]));
  const packageId = argv[0], root = require('node:path').resolve(__dirname, '..');
  const queue = listPackage(root, packageId);
  assert.equal(queue.eligibleCount, 391);
  const archive = createCandidateArchiveV2({ workspaceRoot: root });
  const ids = new Set(), digests = new Set();
  for (const item of queue.items) {
    const loaded = loadPackage(root, packageId, item.itemDigest);
    const batch = archiveBatch(loaded);
    // Deliberately omit CANONICAL_V2 so the real archive validator runs against
    // an inert query port. This proves candidate shape, not the SQL/OIDC gate.
    const run = { run_id: randomUUID(), source_code: 'EU_FUNDING_TENDERS', eu_writer_mode: 'PARITY_ONLY' };
    const fake = { query: async sql => {
      assert(sql.startsWith('INSERT INTO opportunity_catalog.funding_candidate_v2'));
      return { rowCount: 1, rows: [{ payload_digest: 'parity' }] };
    } };
    const result = await archive.stage(fake, { run, batch });
    assert.equal(result.stored, true);
    assert.equal(result.externalIdentifier, item.externalIdentifier);
    assert(!ids.has(result.externalIdentifier) && !digests.has(result.contentDigest));
    ids.add(result.externalIdentifier); digests.add(result.contentDigest);
  }
  console.log(JSON.stringify({ status: 'PASS', packageId, candidateInputs: ids.size,
    uniqueContentDigests: digests.size, databaseConnections: 0, databaseWrites: 0,
    sqlGateTested: false }));
}
if (require.main === module) main().catch(() => { console.error('EU_LEGACY_ARCHIVE_PARITY_FAILED'); process.exitCode = 1; });
module.exports = { main };
