'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { canonicalize } = require('../src/organizationalProfile/canonicalization');
const { CASES, id, partnerRow, goldenRows, LEGACY_CURSOR } = require('./support/partnerBrowseContract');
const { createReferenceHarness } = require('./support/partnerBrowseReferenceHarness');
const { createPortalHarness } = require('./support/partnerBrowsePortalHarness');

// Same independent behavior oracle, now against a separate prototype with a
// protocol double. A PASS does not establish PostgreSQL/RLS/concurrency safety.
for (const scenario of CASES) test(`portal prototype: ${scenario.title}`, () => scenario.run(createPortalHarness));

async function withReaders(rows, check) {
  for (const createHarness of [createReferenceHarness, createPortalHarness]) {
    const h = createHarness({ rows });
    try { await check(h); } finally { await h.close(); }
  }
}

for (const [label, first, second] of [['soft hyphen', 'ab', 'a\u00adb'], ['zero width joiner', 'ab', 'a\u200db'], ['variation selector', 'A', 'A\ufe0f']]) {
  test(`portal collation: ${label} ties use ID order rather than distinct UTF-8 bytes`, async () => {
    assert.equal(first.normalize('NFC'), first); assert.equal(second.normalize('NFC'), second);
    assert.equal(first.localeCompare(second, 'pt'), 0, 'review corpus if the runtime ICU changes');
    assert.ok(Buffer.compare(Buffer.from(first), Buffer.from(second)) < 0);
    const rows = [partnerRow(2, { entity_name: first }), partnerRow(1, { entity_name: second })];
    await withReaders(rows, async h => {
      const result = await h.browse();
      assert.deepEqual(result.items.map(item => item.id), [id(1), id(2)]);
      assert.deepEqual(result.items.map(item => item.entity_name), [second, first]);
    });
  });
}

test('portal countries preserve distinct collation ties in first-seen order before filtering', async () => {
  const first = 'a\u00adb', second = 'ab';
  const rows = [partnerRow(3, { country: first }), partnerRow(2, { country: second }), partnerRow(1, { country: first })];
  await withReaders(rows, async h => {
    const result = await h.browse({ country: second });
    assert.deepEqual(result.items.map(item => item.id), [id(2)]);
    assert.deepEqual(result.countries, [first, second]);
  });
});

test('portal defers canonical errors until later authorization has finished', async () => {
  const rows = [partnerRow(1, { entity_name: 'Cafe\u0301' }), partnerRow(2)];
  await withReaders(rows, async h => {
    h.failAuthorization('APPLICATION_READ', id(2, 4));
    await assert.rejects(h.browse({ cursor: 'malformed' }), { code: 'SERVICE_UNAVAILABLE' });
    assert.equal(h.trace.at(-1)[2], id(2, 4));
  });
});

test('portal keeps structural projection errors before later authorization', async () => {
  const rows = [partnerRow(1, { people: null }), partnerRow(2)];
  await withReaders(rows, async h => {
    h.failAuthorization('APPLICATION_READ', id(2, 4));
    await assert.rejects(h.browse(), TypeError);
    assert.ok(!h.trace.some(entry => entry[0] === 'authorize' && entry[2] === id(2, 4)));
  });
});

test('portal and legacy readers accept each other signed next and previous cursors byte-for-byte', async () => {
  const reference = createReferenceHarness({ rows: goldenRows() }), candidate = createPortalHarness({ rows: goldenRows() });
  try {
    const oldFirst = await reference.browse(), newFirst = await candidate.browse();
    assert.deepEqual(newFirst, oldFirst); assert.equal(newFirst.nextCursor, LEGACY_CURSOR);
    const newSecond = await candidate.browse({ cursor: oldFirst.nextCursor });
    const oldSecond = await reference.browse({ cursor: newFirst.nextCursor });
    assert.deepEqual(newSecond, oldSecond);
    assert.deepEqual(await candidate.browse({ cursor: oldSecond.previousCursor }), oldFirst);
    assert.deepEqual(await reference.browse({ cursor: newSecond.previousCursor }), newFirst);
  } finally { await candidate.close(); await reference.close(); }
});

test('portal hashes more than 256 KiB of projected matches without hashing row digests or only the page', async () => {
  const rows = Array.from({ length: 150 }, (_, n) => partnerRow(n + 1, { research_area_interest: 'x'.repeat(2000) }));
  const reference = createReferenceHarness({ rows }), candidate = createPortalHarness({ rows });
  try {
    const oldFirst = await reference.browse(), newFirst = await candidate.browse();
    assert.deepEqual(newFirst, oldFirst);
    const projected = [...newFirst.items]; let cursor = newFirst.nextCursor;
    while (cursor) { const page = await candidate.browse({ cursor }); projected.push(...page.items); cursor = page.nextCursor; }
    assert.equal(projected.length, 150);
    const canonicalRows = projected.map(row => canonicalize([row]).slice(1, -1));
    const material = `[${canonicalRows.join(',')}]`;
    assert.ok(Buffer.byteLength(material) > 256 * 1024);
    const expected = createHash('sha256').update(material).digest('hex');
    assert.equal(candidate.decode(newFirst.nextCursor).position.digest, expected);
    const composedRowDigests = createHash('sha256').update(canonicalRows.map(row => createHash('sha256').update(row).digest('hex')).join('')).digest('hex');
    assert.notEqual(expected, composedRowDigests);
    candidate.mutate(id(150), row => { row.body.contact = 'Changed outside first page'; });
    await assert.rejects(candidate.browse({ cursor: newFirst.nextCursor }), { code: 'INVALID_CURSOR' });
  } finally { await candidate.close(); await reference.close(); }
});
