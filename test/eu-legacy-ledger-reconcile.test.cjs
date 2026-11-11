'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createUuidV7 } = require('../backend/src/audit/uuidV7');
const { approvalEvent } = require('../backend/src/opportunities/v2/euLegacyPreapproval');
const { receiptMatchesEvent } = require('../scripts/eu-legacy-ledger-reconcile.cjs');

test('historical ledger reconciliation binds human event, item and evidence', () => {
  const requestId = createUuidV7(), actorId = randomUUID();
  const createdAt = new Date(Date.now() - 60000).toISOString();
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  const loaded = { item: { externalIdentifier: 'EU-1', itemDigest: 'a'.repeat(64),
    contentDigest: 'b'.repeat(64), evidenceFingerprint: 'c'.repeat(64) },
  bindingDigest: 'd'.repeat(64), plan: { createdAt, expiresAt } };
  const data = approvalEvent(loaded, { requestId }, actorId).event;
  const receipt = { eventId: data.eventId, eventHash: 'e'.repeat(64), actorId,
    externalIdentifier: 'EU-1', itemDigest: loaded.item.itemDigest,
    bindingDigest: loaded.bindingDigest, requestId };
  const row = { event_id: receipt.eventId, event_hash: receipt.eventHash,
    actor_type: 'HUMAN', actor_id: actorId, organization_id: null, tenant_id: null,
    ledger_location: 'CENTRAL', stream_id: 'PLATFORM:OPERATIONS',
    stream_type: 'OPERATIONS', event_code: 'SENSITIVE_ACTION_ALLOWED',
    audit_class: 'CRITICAL_PRE_EFFECT', event_data: data,
    accepted_at: new Date().toISOString() };
  assert.equal(receiptMatchesEvent(receipt, loaded, row), true);
  assert.equal(receiptMatchesEvent(receipt, loaded, { ...row, actor_id: randomUUID() }), false);
  assert.equal(receiptMatchesEvent(receipt, loaded, { ...row, event_data: {
    ...data, payload: { ...data.payload, scopeDigest: 'f'.repeat(64) } } }), false);
  assert.equal(receiptMatchesEvent(receipt, loaded, { ...row, accepted_at: '2030-01-01T00:00:00.000Z' }), false);
});
