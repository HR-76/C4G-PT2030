'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApplicationDocumentsRepository } = require('../src/applications/documentsReview');

const id = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
const organizationId = id(1);
const actor = { id: id(2), membershipId: id(3), membershipVersion: 2, authorizationVersion: 4 };
const requestedAt = '2026-11-11T12:00:00.000Z';
const rows = Array.from({ length: 27 }, (_, i) => ({
  request_id: id(100 + i), application_id: id(200 + i), opportunity_id: id(300 + i),
  requested_at: requestedAt, title: 'Pedido ' + i
}));

test('scans across pages and omits requests whose exact document or decision access was revoked', async () => {
  const client = { async query(sql, parameters) {
    if (sql.includes('FROM opportunity_catalog.application_document_receipt p')) {
      assert.deepEqual(parameters.slice(0, 2), [organizationId, actor.membershipId]);
      return { rows: rows.filter(row => !parameters[2] || row.request_id > parameters[2]).slice(0, 26) };
    }
    if (sql.includes('FROM opportunity_catalog.application_review_item')) {
      return { rows: [{ document_id: parameters[2], version_id: id(900) }] };
    }
    if (sql.includes('FROM document_storage.document_version')) {
      return { rows: [{ state: 'AVAILABLE', scan_state: 'CLEAN' }] };
    }
    throw new Error('Unexpected query');
  } };
  const bind = { organizationId, subjectId: actor.id, membershipId: actor.membershipId,
    membershipVersion: 2, authorizationVersion: 4, route: 'assigned-reviews-v1' };
  const repository = createApplicationDocumentsRepository({
    organizationId, actor, protect: async () => {},
    authorize: async (operation, resource) =>
      !(operation === 'DOCUMENT_READ' && resource.id === rows[0].request_id)
      && !(operation === 'APPLICATION_REVIEW_DECIDE' && resource.id === rows[1].application_id),
    cursor: {
      cursor(position, binding) { assert.deepEqual(binding, bind); return position; },
      openCursor(position, binding) { assert.deepEqual(binding, bind); return position; }
    }
  });
  const first = await repository.reviewMine(client, null, { cursor: null });
  assert.equal(first.items.length, 23);
  assert.equal(first.items[0].requestId, rows[2].request_id);
  assert.equal(first.nextCursor, rows[24].request_id);
  const second = await repository.reviewMine(client, null, { cursor: first.nextCursor });
  assert.deepEqual(second.items.map(item => item.requestId), rows.slice(25).map(row => row.request_id));
  assert.equal(second.nextCursor, null);
});
