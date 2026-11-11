'use strict';
// Public API observation of the exact 398-item legacy queue. No database port.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { createSource, LIMITS } = require('../backend/src/fundingTenders/source');
const { verifyEvidence } = require('../backend/src/fundingTenders/sourceEvidence');
const { adaptEuOpportunityV2 } = require('../backend/src/fundingTenders/adapterV2');
const { validateSnapshotV2 } = require('../backend/src/opportunities/v2/validation');
const { contentDigestV2 } = require('../backend/src/opportunities/v2/digests');
const { implementationDigest } = require('../backend/src/opportunities/v2/activationArchive');

const root = path.resolve(__dirname, '..');
const inventoryPath = 'output/eu-legacy-funder-inventory-f6e32b25-c768-4125-9af6-7e6a8e88f32d/inventory.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const safeCode = error => /^[A-Z0-9_]{3,100}$/.test(error?.code || '') ? error.code : 'SOURCE_UNAVAILABLE';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const relative = file => path.relative(root, file).replaceAll('\\', '/');

async function main() {
  assert.deepEqual(process.argv.slice(2), []);
  const inventoryBytes = fs.readFileSync(path.join(root, inventoryPath));
  const inventory = JSON.parse(inventoryBytes);
  assert.equal(inventory.readOnly, true);
  assert.equal(inventory.sourceControl?.state, 'QUIESCED');
  assert.equal(inventory.sourceControl?.fence, 7);
  const targets = inventory.items.filter(item => item.proposedPath === 'FRESH_SOURCE_EVIDENCE_AND_REVIEW');
  assert.equal(targets.length, 398);
  assert.equal(new Set(targets.map(item => item.externalIdentifier)).size, targets.length);
  assert(targets.every(item => item.schemaVersion === 1 && item.candidateArchives === 0 && item.reviewDecisions === 0));

  const folder = path.join(root, 'output', `eu-legacy-evidence-${randomUUID()}`);
  fs.mkdirSync(folder, { recursive: false });
  const source = createSource({ fetchImpl: globalThis.fetch, enrichmentEnabled: true,
    canonicalV2Enabled: true, limits: { ...LIMITS, retries: 0, totalMs: 20000 } });
  const entries = [];
  const writeProgress = () => fs.writeFileSync(path.join(folder, 'progress.json'), JSON.stringify({
    kind: 'eu-legacy-evidence-progress-v1', inventory: { path: inventoryPath, sha256: sha(inventoryBytes) },
    observed: entries.length, expected: targets.length, entries
  }, null, 2) + '\n');
  for (const [index, target] of targets.entries()) {
    const externalIdentifier = target.externalIdentifier;
    let observation;
    try {
      const result = await source.lookup({ externalIdentifier });
      assert(['FOUND', 'CONFLICT', 'ABSENT', 'ERROR'].includes(result.outcome));
      const evidence = result.evidence;
      if (evidence) assert(verifyEvidence(evidence) && evidence.externalIdentifier === externalIdentifier);
      if (result.outcome === 'FOUND') {
        assert(evidence && result.canonicalSnapshot && result.record?.externalIdentifier === externalIdentifier);
        const snapshot = validateSnapshotV2(result.canonicalSnapshot);
        assert(isDeepStrictEqual(snapshot, adaptEuOpportunityV2(evidence, { observedAt: result.observedAt })));
        assert.equal(Object.hasOwn(result.record.fields, 'funderName'), false);
        observation = { externalIdentifier, outcome: 'FOUND', observedAt: result.observedAt,
          received: result.received, evidence, snapshot, sourceFields: result.record.fields,
          contentDigest: contentDigestV2(snapshot),
          mappingDigest: implementationDigest('EU_FUNDING_TENDERS', snapshot.provenance.mappingVersion) };
      } else {
        observation = { externalIdentifier, outcome: result.outcome,
          observedAt: result.observedAt, received: result.received,
          conflictReasons: result.conflictReasons || [], ...(evidence ? { evidence } : {}) };
      }
    } catch (error) {
      observation = { externalIdentifier, outcome: 'LOOKUP_ERROR', errorCode: safeCode(error),
        observedAt: new Date().toISOString() };
    }
    const file = path.join(folder, sha(externalIdentifier) + '.json');
    const bytes = Buffer.from(JSON.stringify(observation) + '\n');
    fs.writeFileSync(file, bytes, { flag: 'wx' });
    const snapshot = observation.snapshot;
    entries.push({ externalIdentifier, expected: { opportunityId: target.opportunityId,
      revisionId: target.currentRevisionId, rowVersion: target.rowVersion },
      outcome: observation.outcome, ...(observation.errorCode ? { errorCode: observation.errorCode } : {}),
      ...(observation.conflictReasons?.length ? { conflictReasons: observation.conflictReasons } : {}),
      observedAt: observation.observedAt, received: observation.received ?? null,
      artifact: { path: relative(file), sha256: sha(bytes) },
      evidenceFingerprint: observation.evidence?.fingerprint || null,
      contentDigest: observation.contentDigest || null, mappingDigest: observation.mappingDigest || null,
      amount: snapshot?.financing?.allocations?.state === 'PRESENT'
        ? snapshot.financing.allocations.value.map(item => ({ amount: item.money.amount,
          currencyState: item.money.currency.state, scope: item.scope })) : [],
      deadlineCount: snapshot?.schedule?.deadlines?.value?.length || 0,
      directAwarders: snapshot?.parties?.state === 'PRESENT'
        ? snapshot.parties.value.filter(item => item.role === 'DIRECT_AWARDER').map(item => item.name) : [],
      decision: 'REVIEW_REQUIRED' });
    if ((index + 1) % 25 === 0 || index + 1 === targets.length) {
      writeProgress();
      console.log(JSON.stringify({ progress: index + 1, total: targets.length,
        found: entries.filter(item => item.outcome === 'FOUND').length,
        unresolved: entries.filter(item => item.outcome !== 'FOUND').length }));
    }
    await sleep(150);
  }
  const counts = Object.fromEntries([...new Set(entries.map(item => item.outcome))].sort()
    .map(outcome => [outcome, entries.filter(item => item.outcome === outcome).length]));
  const manifest = { kind: 'eu-legacy-official-evidence-v1', status: 'OBSERVED_REVIEW_REQUIRED',
    createdAt: new Date().toISOString(), source: 'EU_FUNDING_TENDERS', readOnly: true,
    databaseWrites: 0, inventory: { path: inventoryPath, sha256: sha(inventoryBytes),
      inspectedAt: inventory.inspectedAt, sourceFence: inventory.sourceControl.fence },
    expected: targets.length, observed: entries.length, counts, entries,
    caveat: 'Offline observations are not durable APP candidates or authenticated approval. Revalidate source, archive, CAS, authority and source fence before any migration.' };
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: manifest.status, evidence: relative(path.join(folder, 'manifest.json')),
    observed: entries.length, counts, databaseWrites: 0 }));
}
main().catch(error => { console.error(safeCode(error)); process.exitCode = 1; });
