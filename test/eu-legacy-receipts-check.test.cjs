'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createUuidV7 } = require('../backend/src/audit/uuidV7');
const { validateReceiptExport } = require('../scripts/eu-legacy-receipts-check.cjs');

test('receipt export requires all 391 distinct current package bindings', () => {
  const now = Date.now(), packageId = randomUUID(), actorId = randomUUID();
  const createdAt = new Date(now - 60000).toISOString(), expiresAt = new Date(now + 60000).toISOString();
  const items = Array.from({ length: 391 }, (_, index) => ({
    externalIdentifier: `EU-${index + 1}`, itemDigest: (index + 1).toString(16).padStart(64, '0')
  }));
  const queue = { packageId, items, conflictCount: 7, expiresAt };
  const receipts = items.map(item => ({ scope: 'PREARCHIVE_ONLY', packageId,
    externalIdentifier: item.externalIdentifier, itemDigest: item.itemDigest,
    bindingDigest: 'a'.repeat(64), requestId: createUuidV7(), actorId,
    eventId: randomUUID(), eventHash: 'b'.repeat(64), expiresAt, replayed: false }));
  const value = { kind: 'eu-legacy-prearchive-receipts-v1', packageId,
    exportedAt: new Date(now).toISOString(), eligibleCount: 391, receipts };
  const ports = { now, list: () => queue,
    load: (_root, _packageId, digest) => ({ plan: { packageId, createdAt },
      item: { itemDigest: digest }, bindingDigest: 'a'.repeat(64) }) };
  assert.equal(validateReceiptExport(value, ports).events, 391);
  assert.throws(() => validateReceiptExport({ ...value, receipts: receipts.slice(1) }, ports));
  assert.equal(validateReceiptExport({ ...value, receipts: receipts.slice(1) }, { ...ports, allowPartial: true }).missing, 1);
  assert.throws(() => validateReceiptExport({ ...value, receipts: [...receipts.slice(0, -1), receipts[0]] }, ports));
  assert.throws(() => validateReceiptExport({ ...value, receipts: receipts.map((r, i) => i ? r : { ...r, bindingDigest: 'c'.repeat(64) }) }, ports));
  assert.throws(() => validateReceiptExport(value, { ...ports, now: now + 120000,
    list: () => { throw Error('expired'); } }));
});
