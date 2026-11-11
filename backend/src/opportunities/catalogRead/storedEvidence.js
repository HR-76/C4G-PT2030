'use strict';
// Offline input only. No API client, application environment or database access.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const manifest = require('./storedEvidence.manifest.json');
const { buildEvidence } = require('../../fundingTenders/sourceEvidence');
const { acceptedEu11145 } = require('./acceptedEu11145');
const { adaptPlanRowV2 } = require('../../portugal2030/planRowV2');
const { contentDigestV2 } = require('../v2/digests');
const { stableId, digest } = require('./model');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function buildStoredCatalog(files) {
  const parsed = {};
  for (const [name, expected] of Object.entries(manifest.files)) {
    const bytes = files[name];
    if (!Buffer.isBuffer(bytes) || bytes.length > 4 * 1024 * 1024 || sha(bytes) !== expected) fail('STORED_EVIDENCE_HASH_MISMATCH');
    parsed[name] = JSON.parse(bytes.toString('utf8'));
  }
  const plan = parsed['pt2030-plan-177.json'], eu = parsed['eu-11145.json'], metadata = parsed['eu-11145.metadata.json'];
  if (plan.rows.length !== 177 || eu.results.length !== 1 || metadata.response.sha256 !== sha(files['eu-11145.json'])) fail('STORED_EVIDENCE_COVERAGE_MISMATCH');
  const envelope = buildEvidence(metadata.externalIdentifier, eu.results);
  const snapshots = [acceptedEu11145(envelope, metadata), ...plan.rows.map(row => adaptPlanRowV2(row.cells, {
    physicalRow: row.physicalRow, dateSystem: plan.source.workbookDateSystem,
    fileDigest: plan.source.sha256, observedAt: manifest.ptObservedAt,
    documentModifiedAt: new Date(plan.source.documentModifiedAt).toISOString(),
    sheetName: plan.source.sheet, filename: plan.source.filename,
  }))];
  const seen = new Set();
  const records = snapshots.map(snapshot => {
    const source = snapshot.sourceRecords[0], identity = [source.namespace, source.externalId];
    const key = JSON.stringify(identity);
    if (seen.has(key)) fail('STORED_EVIDENCE_DUPLICATE_IDENTITY');
    seen.add(key);
    const contentDigest = contentDigestV2(snapshot);
    return { opportunityId: stableId('stored-public-source', ...identity), revisionId: stableId('stored-public-revision', ...identity, contentDigest), contentDigest, snapshot };
  });
  // Preserve exact input bytes and EU adapter envelope, whose hash is used by its locators.
  const artifacts = [...Object.entries(files).filter(([name]) => Object.hasOwn(manifest.files, name)).map(([name, bytes]) => ({ name, sha256: sha(bytes), base64: bytes.toString('base64') })),
    { name: 'eu-adapter-envelope.json', sha256: sha(JSON.stringify(envelope)), base64: Buffer.from(JSON.stringify(envelope)).toString('base64') }];
  return { version: 1, records, artifacts, manifestDigest: digest(manifest), corpusDigest: digest(records.map(r => [r.opportunityId, r.contentDigest])), counts: { ...manifest.expected } };
}
function loadStoredCatalog(directory) {
  const files = Object.fromEntries(Object.keys(manifest.files).map(name => [name, fs.readFileSync(path.join(directory, name))]));
  return buildStoredCatalog(files);
}
module.exports = { loadStoredCatalog, buildStoredCatalog };
