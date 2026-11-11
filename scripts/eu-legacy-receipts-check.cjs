'use strict';
// Checks a browser export against the current, official-evidence package.
// This is local validation only: the SQL gate must still verify each audit event.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { loadPackage, listPackage, validateApproval } = require('../backend/src/opportunities/v2/euLegacyPreapproval');

const ROOT = path.resolve(__dirname, '..');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;
function validateReceiptExport(value, { root = ROOT, now = Date.now(), verificationTime = now,
  allowPartial = false, load = loadPackage, list = listPackage } = {}) {
  assert(exact(value, ['kind', 'packageId', 'exportedAt', 'eligibleCount', 'receipts']));
  assert.equal(value.kind, 'eu-legacy-prearchive-receipts-v1');
  assert(UUID.test(value.packageId) && iso(value.exportedAt));
  const queue = list(root, value.packageId, verificationTime);
  assert.equal(value.eligibleCount, 391);
  assert(Array.isArray(value.receipts) && value.receipts.length > 0
    && value.receipts.length <= queue.items.length
    && (allowPartial || value.receipts.length === queue.items.length));
  const expected = new Map(queue.items.map(item => [item.itemDigest, item]));
  const actors = new Set(), events = new Set(), requests = new Set();
  for (const receipt of value.receipts) {
    assert(exact(receipt, ['scope', 'packageId', 'externalIdentifier', 'itemDigest',
      'bindingDigest', 'requestId', 'actorId', 'eventId', 'eventHash', 'expiresAt', 'replayed']));
    const item = expected.get(receipt.itemDigest);
    assert(item && receipt.scope === 'PREARCHIVE_ONLY' && receipt.packageId === value.packageId
      && receipt.externalIdentifier === item.externalIdentifier && receipt.expiresAt === queue.expiresAt
      && UUID.test(receipt.actorId) && UUID.test(receipt.eventId) && SHA.test(receipt.eventHash)
      && typeof receipt.replayed === 'boolean');
    const loaded = load(root, value.packageId, receipt.itemDigest, verificationTime);
    validateApproval({ packageId: receipt.packageId, itemDigest: receipt.itemDigest,
      requestId: receipt.requestId, bindingDigest: receipt.bindingDigest }, loaded, verificationTime);
    assert.equal(receipt.bindingDigest, loaded.bindingDigest);
    assert(!events.has(receipt.eventId) && !requests.has(receipt.requestId));
    actors.add(receipt.actorId); events.add(receipt.eventId); requests.add(receipt.requestId);
    expected.delete(receipt.itemDigest);
  }
  if (!allowPartial) assert.equal(expected.size, 0);
  return { status: verificationTime === now ? 'LOCAL_VALIDATION_ONLY' : 'HISTORICAL_LOCAL_VALIDATION_ONLY',
    packageId: value.packageId, eligible: queue.items.length, receipts: value.receipts.length,
    missing: expected.size, conflictsExcluded: queue.conflictCount,
    distinctActors: actors.size, events: events.size, expiresAt: queue.expiresAt,
    expired: now >= Date.parse(queue.expiresAt), ledgerVerified: false, databaseWrites: 0 };
}
function main(argv = process.argv.slice(2)) {
  assert((argv.length === 1 || argv.length === 2 && argv[1] === '--historical') && path.isAbsolute(argv[0]));
  const bytes = fs.readFileSync(argv[0]);
  assert(bytes.length > 0 && bytes.length <= 512 * 1024);
  const value = JSON.parse(bytes.toString('utf8'));
  const now = Date.now();
  let verificationTime = now;
  if (argv[1] === '--historical') {
    const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'output', `eu-legacy-preapproval-${value.packageId}`, 'plan.json')));
    verificationTime = Math.min(verificationTime, Date.parse(plan.expiresAt) - 1);
  }
  const report = validateReceiptExport(value, { now, verificationTime, allowPartial: true });
  console.log(JSON.stringify({ ...report, fileSha256: createHash('sha256').update(bytes).digest('hex') }));
}
if (require.main === module) {
  try { main(); } catch { console.error('EU_LEGACY_RECEIPTS_INVALID_OR_EXPIRED'); process.exitCode = 1; }
}
module.exports = { validateReceiptExport, main };
