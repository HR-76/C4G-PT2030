'use strict';
// One identity per transaction. No source resume or accepted-revision write.
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { loadPackage, assertCurrent } = require('./euLegacyPreapproval');
const { migrationRun } = require('./euLegacyArchiveBatch');
const { euWriterConfiguration } = require('../../fundingTenders/euWriter');
const { createCandidateArchiveV2 } = require('../../fundingTenders/candidateRepositoryV2');
const { assertEuQuiescent } = require('./euSourceControl');

const ROOT = path.resolve(__dirname, '../../../..');
function fail(code = 'EU_LEGACY_ARCHIVE_STATE_CHANGED') {
  throw Object.assign(new Error(code), { code });
}
function createEuLegacyArchiveExecutor({ pool, workspaceRoot = ROOT, archive = createCandidateArchiveV2({ workspaceRoot }),
  load = loadPackage, current = assertCurrent } = {}) {
  if (!pool?.connect || !path.isAbsolute(workspaceRoot)
    || !archive?.stageLegacyMigration || !archive?.verify
    || typeof load !== 'function' || typeof current !== 'function') throw new TypeError('Legacy archive executor dependencies invalid.');
  async function executeOne(receipt) {
    if (!receipt || typeof receipt.packageId !== 'string' || typeof receipt.itemDigest !== 'string') fail();
    const loaded = load(workspaceRoot, receipt.packageId, receipt.itemDigest);
    const run = migrationRun(loaded, receipt, euWriterConfiguration());
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='3000ms'");
      await client.query("SET LOCAL statement_timeout='30000ms'");
      await client.query('SET LOCAL ROLE c4g_opportunity_central_runtime');
      await assertEuQuiescent(client, 'EU_FUNDING_TENDERS', loaded.binding.sourceFence);
      const prior = (await client.query('SELECT 1 FROM opportunity_catalog.funding_candidate_v2 WHERE run_id=$1 AND external_identifier=$2',
        [run.run_id, loaded.item.externalIdentifier])).rows[0];
      if (prior) {
        const verified = await archive.verify(client, { run, externalIdentifier: loaded.item.externalIdentifier });
        if (!verified || verified.contentDigest !== loaded.item.contentDigest
          || !isDeepStrictEqual(verified.canonicalSnapshot, loaded.artifact.snapshot)) fail();
        await client.query('COMMIT');
        return Object.freeze({ status: 'ALREADY_ARCHIVED', runId: run.run_id,
          externalIdentifier: loaded.item.externalIdentifier, itemDigest: loaded.item.itemDigest,
          contentDigest: verified.contentDigest, payloadDigest: verified.payloadDigest });
      }
      await current(client, loaded);
      const result = await archive.stageLegacyMigration(client, { loaded, receipt });
      if (result.stored !== true || result.externalIdentifier !== loaded.item.externalIdentifier
        || result.contentDigest !== loaded.item.contentDigest) fail();
      const verified = await archive.verify(client, { run, externalIdentifier: loaded.item.externalIdentifier });
      if (!verified || verified.contentDigest !== loaded.item.contentDigest
        || !isDeepStrictEqual(verified.canonicalSnapshot, loaded.artifact.snapshot)) fail();
      await client.query('COMMIT');
      return Object.freeze({ status: 'ARCHIVED', runId: run.run_id,
        externalIdentifier: loaded.item.externalIdentifier, itemDigest: loaded.item.itemDigest,
        contentDigest: verified.contentDigest, payloadDigest: verified.payloadDigest });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code?.startsWith('EU_LEGACY_') || error.code?.startsWith('FUNDING_V2_PREARCHIVE_')) throw error;
      fail('EU_LEGACY_ARCHIVE_UNAVAILABLE');
    } finally { client.release(); }
  }
  return Object.freeze({ executeOne });
}
module.exports = { createEuLegacyArchiveExecutor };
