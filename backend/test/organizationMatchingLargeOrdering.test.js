'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { areas, match } = require('../src/organizationDirectory/thematicAreas');

test('real matching ranking remains deterministic beyond one thousand synthetic opportunities', () => {
  const person = { active: true, areaIds: areas.map(area => area.id) };
  const records = Array.from({ length: 1100 }, (_, index) => ({
    opportunityId: String(index % 550).padStart(4, '0'),
    origin: index < 550 ? 'CENTRAL' : 'PRIVATE',
    title: 'Education training school',
    lifecycleState: 'ACTIVE',
    closingDate: index % 2 ? '2027-12-01' : '2027-06-01'
  }));
  const forward = match(person, records, '2026-11-10');
  const backward = match(person, [...records].reverse(), '2026-11-10');
  assert.equal(forward.length, 1100);
  assert.deepEqual(backward, forward);
  for (let i = 1; i < forward.length; i++) {
    const left = forward[i - 1], right = forward[i];
    const comparison = right.matchedAreas.length - left.matchedAreas.length
      || left.closingDate.localeCompare(right.closingDate)
      || left.opportunityId.localeCompare(right.opportunityId)
      || left.origin.localeCompare(right.origin);
    assert.ok(comparison <= 0, `ordering changed at ${i}`);
  }
});
