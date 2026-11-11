'use strict';
// The public search API serves at most 100 records per request (observed
// 2026-11-11). Approved collection uses one request of 100 instead of four of 25.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSource, LIMITS, CAPS } = require('../src/fundingTenders/source');
const { collectionPolicy } = require('../src/fundingTenders/programmes');
const { validateBatch } = require('../src/fundingTenders/coverage');
const { createOfficialSource } = require('../src/fundingTenders/officialSources');
const record = i => ({ content: 'Call ' + i, url: 'https://example.invalid/' + i, metadata: { type: ['1'], identifier: ['PAGE-' + i], frameworkProgramme: ['43108390'], startDate: ['2026-01-01'], deadlineDate: ['2099-01-01'], status: ['31094502'] } });

test('approved collection policy is one page of 100; unapproved modes keep the five-record rehearsal', () => {
  for (const approval of ['central-programmes-100', 'central-official-sources-100']) assert.deepEqual(collectionPolicy('live-local', approval).limits, { results: 100, pageSize: 100, pages: 1 });
  assert.deepEqual(collectionPolicy('fixture', 'central-programmes-100').limits, { results: 5, pageSize: 5, pages: 1 });
  assert.equal(CAPS.pageSize, 100); assert.equal(LIMITS.pageSize, 25);
});

test('a 100-record page is a single request with a durable continuation and callers cannot exceed the provider maximum', async () => {
  const calls = [];
  const limits = { ...LIMITS, ...collectionPolicy('live-local', 'central-programmes-100').limits };
  const source = createSource({ limits, fetchImpl: async target => { const url = new URL(target); calls.push([url.searchParams.get('pageSize'), url.searchParams.get('pageNumber')]);
    const page = Number(url.searchParams.get('pageNumber')); return new Response(JSON.stringify({ totalResults: 250, results: Array.from({ length: page === 3 ? 50 : 100 }, (_, i) => record((page - 1) * 100 + i)) })); } });
  const first = await source.collect();
  assert.deepEqual(calls, [['100', '1']]);
  assert.equal(first.records.length, 100); assert.equal(first.pages, 1); assert.equal(first.limited, true);
  assert.deepEqual([first.nextCursor.pageSize, first.nextCursor.nextPage], [100, 2]);
  const second = await source.collect({ cursor: first.nextCursor, pageBudget: 1 });
  const third = await source.collect({ cursor: second.nextCursor, pageBudget: 1 });
  assert.deepEqual(calls, [['100', '1'], ['100', '2'], ['100', '3']]);
  assert.equal(third.records.length, 50); assert.equal(third.nextCursor, null); assert.equal(third.limited, false);
  await assert.rejects(source.collect({ cursor: { ...first.nextCursor, pageSize: 25 } }), { code: 'SOURCE_CURSOR_INVALID' });
  assert.throws(() => createSource({ fetchImpl: fetch, limits: { ...limits, pageSize: 101 } }));
  assert.throws(() => createSource({ fetchImpl: fetch, limits: { ...limits, results: 101 } }));
  assert.throws(() => createSource({ fetchImpl: fetch, limits: { ...limits, bytes: LIMITS.bytes + 1 } }));
  assert.doesNotThrow(() => createOfficialSource({ fetchImpl: fetch, limits }));
});

test('exact lookups stay within the 25-variant evidence bound even on a 100-record source', async () => {
  const sizes = [];
  const limits = { ...LIMITS, results: 100, pageSize: 100, pages: 1 };
  const source = createSource({ limits, fetchImpl: async target => { sizes.push(new URL(target).searchParams.get('pageSize')); return new Response(JSON.stringify({ totalResults: 1, results: [record(1)] })); } });
  const found = await source.lookup({ externalIdentifier: 'PAGE-1' });
  assert.equal(found.outcome, 'FOUND'); assert.deepEqual(sizes, ['25']);
  const many = createSource({ limits, fetchImpl: async () => new Response(JSON.stringify({ totalResults: 26, results: Array.from({ length: 25 }, () => record(1)) })) });
  const truncated = await many.lookup({ externalIdentifier: 'PAGE-1' });
  assert.equal(truncated.outcome, 'CONFLICT'); assert.ok(truncated.conflictReasons.includes('LOOKUP_TRUNCATED'));
});

test('coverage checkpoint admits one page of up to 100 records and nothing larger', () => {
  const batch = n => ({ records: Array.from({ length: n }, (_, i) => ({ externalIdentifier: 'PAGE-' + i })), pages: 1, received: n, failed: 0, excluded: 0, duplicates: 0, remoteTotal: 1186,
    observedAt: '2026-11-11T12:00:00.000Z', contract: 'a'.repeat(64), asOf: '2026-11-11', nextCursor: null, limited: false });
  assert.doesNotThrow(() => validateBatch(batch(100)));
  assert.throws(() => validateBatch(batch(101)), { code: 'FUNDING_CHECKPOINT_INVALID' });
  assert.throws(() => validateBatch({ ...batch(100), pages: 2 }), { code: 'FUNDING_CHECKPOINT_INVALID' });
});
