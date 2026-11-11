'use strict';
// Read-only comparison of all 137 REVIEW package items with the actual accepted writer preview.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Pool } = require('../backend/node_modules/pg');
const cfg = require('../backend/scripts/localPlatform/config');
const { createAcceptedOpportunityV2Repository } = require('../backend/src/opportunities/v2/acceptedRepository');
async function main(argv = process.argv.slice(2)) {
  assert(argv.length === 1 && /^[a-f0-9-]{36}$/.test(argv[0]));
  const { load } = require('../backend/src/opportunities/v2/euLegacyAcceptance');
  const packageValue = load(cfg.root, argv[0]);
  const config = cfg.readConfig();
  const pool = new Pool({ ...cfg.connection(config, config.centralDatabase), max: 1,
    options: '-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=30000' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const writer = createAcceptedOpportunityV2Repository({ pool, authorize: async () => true,
      verifyApproval: async () => true, audit: async () => {} });
    for (const item of packageValue.eligible) {
      const row = (await client.query(`SELECT canonical_snapshot FROM opportunity_catalog.funding_candidate_v2
        WHERE run_id=$1 AND external_identifier=$2`,
      [item.archive.runId, item.externalIdentifier])).rows[0];
      assert(row);
      const actual = await writer.previewInTransaction(client, { requestId: 'eu-review-readonly-parity',
        candidateId: item.candidateId, snapshot: row.canonical_snapshot,
        mappingDigest: item.mappingDigest, expected: item.expected }, {});
      assert.equal(actual.previewDigest, item.previewDigest);
      assert.equal(actual.items[0].itemDigest, item.itemDigest);
      assert.equal(actual.items[0].action, 'CHANGE_REQUIRES_APPROVAL');
    }
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ status: 'PASS', packageId: argv[0],
      candidates: packageValue.eligible.length, previewDigestsMatch: 137, databaseWrites: 0 }));
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); await pool.end(); }
}
if (require.main === module) main().catch(error => {
  console.error(/^[A-Z0-9_]{3,100}$/.test(error?.code || '') ? error.code : 'EU_REVIEW_ACCEPTANCE_PARITY_FAILED');
  process.exitCode = 1;
});
module.exports = { main };
