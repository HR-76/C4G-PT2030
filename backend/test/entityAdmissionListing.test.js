'use strict';
// What the administration shows for an invitation (context/features/entity-invitation-simplified.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const { invitationState, createAdmissionListing, listingPage } = require('../src/entityAdmission/listing');

const now = new Date('2026-11-24T12:00:00Z');
const later = '2026-11-25T12:00:00Z', earlier = '2026-11-23T12:00:00Z';

test('the state of an invitation is decided from its phase and its latest link', () => {
  const state = (phase, invitationStatus = null, expiresAt = null) => { const result = invitationState({ phase, invitationStatus, expiresAt }, now); return result.detail ? `${result.state}/${result.detail}` : result.state; };
  assert.equal(state('READY', 'OPEN', later), 'SENT');
  assert.equal(state('READY', 'OPEN', earlier), 'EXPIRED');
  assert.equal(state('READY', 'OPEN', now.toISOString()), 'EXPIRED', 'a link is valid only before its expiry');
  assert.equal(state('READY', 'OPEN', 'not a date'), 'EXPIRED');
  assert.equal(state('FILLING', 'USED', earlier), 'SENT/FILLING', 'the person opened the link: its validity no longer matters');
  assert.equal(state('PREPARING', 'USED', earlier), 'ACCEPTED/PREPARING', 'accepted as soon as the form is submitted');
  assert.equal(state('COMPLETE', 'USED', earlier), 'ACCEPTED');
  assert.equal(state('CANCELLED', 'OPEN', later), 'CANCELLED', 'a cancelled invitation is never shown as sent');
  for (const [phase, link] of [['IDENTITY', null], ['READY', null], ['READY', 'REVOKED'], ['READY', 'USED'], ['UNKNOWN', 'OPEN']]) assert.equal(state(phase, link, later), 'NOT_SENT', `${phase} ${link}`);
});

test('the listing adds the state to each row without changing what it already returned', async () => {
  const rows = [{ id: 'a', name: 'Ana', email: 'ana@example.invalid', phase: 'PREPARING', created_at: '2026-11-24T10:00:00Z', created_by: 'C4G', expires_at: earlier, invitation_status: 'USED' },
    { id: 'b', name: 'Rui', email: 'rui@example.invalid', phase: 'READY', created_at: '2026-11-24T09:00:00Z', created_by: 'C4G', expires_at: later, invitation_status: 'OPEN' }];
  const queries = [];
  const listing = createAdmissionListing({ now: () => now, pool: { async query(sql, values) { queries.push(values); return { rows: [{ total: 2, items: rows }] }; } } });
  const result = await listing(listingPage({ page: '2' }));
  assert.deepEqual(queries, [[25]]);
  assert.deepEqual([result.page, result.pageSize, result.total], [2, 25, 2]);
  assert.deepEqual(result.items[0], { id: 'a', name: 'Ana', email: 'ana@example.invalid', phase: 'PREPARING', createdAt: '2026-11-24T10:00:00Z', createdBy: 'C4G', expiresAt: earlier, invitationStatus: 'USED', state: 'ACCEPTED', detail: 'PREPARING' });
  assert.deepEqual([result.items[1].state, result.items[1].detail], ['SENT', null]);
});
