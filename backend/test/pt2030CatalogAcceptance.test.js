'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPortugal2030CatalogAcceptance, STATUS } = require('../src/portugal2030/catalogAcceptance');

const USER = '0195f1e0-7b1a-7c3d-8e2f-0123456789ab', IMPORT = '0195f1e0-7b1a-7c3d-8e2f-0123456789ac', SESSION = 'session-token-0001';
const MAPPING = 'a'.repeat(64);
const row = (n, extra = {}) => ({ physicalRow: n + 1, externalIdentifier: `PT2030-${n}`, errors: [], revisionId: `0195f1e0-7b1a-7c3d-8e2f-0123456789${String(10 + n)}`,
  contentDigest: String(n).padStart(64, 'c'), snapshot: { description: { title: { value: `Aviso ${n}` } }, secret: 'SECRET-CONTENT' }, ...extra });

// A fake of the accepted-opportunity port: the reconciliation action per identifier, and a record of every write.
function fixture({ actions, fail = {}, authorityDenied = false, rows = Object.keys(actions).map((_, i) => row(i)) } = {}) {
  const writes = [];
  const byRevision = new Map(rows.filter(r => r.revisionId).map(r => [`pt2030:${r.revisionId}`, r]));
  const accepted = {
    async preview(cmd) {
      if (authorityDenied) throw Object.assign(new Error('OPPORTUNITY_V2_AUTHORITY_DENIED'), { code: 'OPPORTUNITY_V2_AUTHORITY_DENIED' });
      const id = byRevision.get(cmd.candidateId).externalIdentifier;
      return { previewDigest: 'e'.repeat(62) + String(id.slice(-1)).padStart(2, '0'), items: [{ action: actions[id] }] };
    },
    async accept(cmd) {
      const id = byRevision.get(cmd.candidateId).externalIdentifier;
      if (fail[id]) throw Object.assign(new Error(fail[id]), { code: fail[id] });
      writes.push(cmd); return { action: 'CREATED' };
    }
  };
  const readImport = async () => ({ importId: IMPORT, mappingDigest: MAPPING, rows });
  const service = createPortugal2030CatalogAcceptance({ pool: {}, authority: { authorize: async () => true }, readImport, accepted });
  return { service, writes };
}
const input = extra => ({ userId: USER, sessionId: SESSION, importId: IMPORT, ...extra });

test('review sorts every row: new ones are acceptable, the rest are reported and never written', async () => {
  const { service, writes } = fixture({ actions: { 'PT2030-0': 'NEW', 'PT2030-1': 'UNCHANGED', 'PT2030-2': 'CHANGE_REQUIRES_APPROVAL', 'PT2030-3': 'BLOCKED' },
    rows: [row(0), row(1), row(2), row(3), row(4, { errors: ['PT2030_ROW_INVALID'], revisionId: null, contentDigest: null })] });
  const review = await service.review(input());
  assert.deepEqual(review.rows.map(r => r.status), [STATUS.ACCEPTABLE, STATUS.ALREADY_ACCEPTED, STATUS.NEEDS_REVIEW, STATUS.NEEDS_REVIEW, STATUS.REJECTED]);
  assert.deepEqual(review.totals, { ACCEPTABLE: 1, ALREADY_ACCEPTED: 1, NEEDS_REVIEW: 2, REJECTED: 1 });
  assert.equal(review.totalRows, 5); assert.match(review.batchDigest, /^[a-f0-9]{64}$/);
  assert.equal(review.rows[0].title, 'Aviso 0');
  assert.ok(!JSON.stringify(review).includes('SECRET-CONTENT'), 'the review never carries the snapshot');
  assert.equal(writes.length, 0, 'reviewing writes nothing');
});

test('accept writes only the new candidates, bound to the digest the review returned', async () => {
  const { service, writes } = fixture({ actions: { 'PT2030-0': 'NEW', 'PT2030-1': 'UNCHANGED', 'PT2030-2': 'CHANGE_REQUIRES_APPROVAL', 'PT2030-3': 'NEW' } });
  const { batchDigest } = await service.review(input());
  const result = await service.accept(input({ batchDigest }));
  assert.deepEqual({ requested: result.requested, created: result.created, failed: result.failed, skipped: result.skipped },
    { requested: 2, created: 2, failed: [], skipped: { alreadyAccepted: 1, needsReview: 1, rejected: 0 } });
  assert.deepEqual(writes.map(w => w.expected), [null, null], 'new identities are accepted with no expected revision');
  for (const w of writes) { assert.match(w.requestId, /^pt2030:[a-f0-9]{64}$/); assert.match(w.approvalDigest, /^[a-f0-9]{64}$/); assert.equal(w.mappingDigest, MAPPING); }
  assert.equal(new Set(writes.map(w => w.requestId)).size, 2, 'each candidate has its own request id');
});

test('the request id is derived from the import and the candidate, so a repeat is idempotent', async () => {
  const a = fixture({ actions: { 'PT2030-0': 'NEW' } }), b = fixture({ actions: { 'PT2030-0': 'NEW' } });
  for (const f of [a, b]) await f.service.accept(input({ batchDigest: (await f.service.review(input())).batchDigest }));
  assert.equal(a.writes[0].requestId, b.writes[0].requestId);
});

test('a digest that no longer matches the review writes nothing', async () => {
  const { service, writes } = fixture({ actions: { 'PT2030-0': 'NEW' } });
  await assert.rejects(() => service.accept(input({ batchDigest: 'f'.repeat(64) })), { code: 'PT2030_BATCH_STALE' });
  assert.equal(writes.length, 0);
  // Anything that changes a row's status changes the digest.
  const one = await fixture({ actions: { 'PT2030-0': 'NEW' } }).service.review(input());
  const two = await fixture({ actions: { 'PT2030-0': 'UNCHANGED' } }).service.review(input());
  assert.notEqual(one.batchDigest, two.batchDigest);
});

test('one failing candidate does not undo or stop the others, and only a code is reported', async () => {
  const { service, writes } = fixture({ actions: { 'PT2030-0': 'NEW', 'PT2030-1': 'NEW', 'PT2030-2': 'NEW' }, fail: { 'PT2030-1': 'OPPORTUNITY_V2_STALE_REVISION' } });
  const result = await service.accept(input({ batchDigest: (await service.review(input())).batchDigest }));
  assert.equal(result.created, 2); assert.equal(writes.length, 2);
  assert.deepEqual(result.failed, [{ physicalRow: 2, externalIdentifier: 'PT2030-1', code: 'OPPORTUNITY_V2_STALE_REVISION' }]);
  const odd = fixture({ actions: { 'PT2030-0': 'NEW' }, fail: { 'PT2030-0': 'password=hunter2 at db.internal' } });
  const outcome = await odd.service.accept(input({ batchDigest: (await odd.service.review(input())).batchDigest }));
  assert.equal(outcome.failed[0].code, 'PT2030_ACCEPT_FAILED');
  assert.ok(!JSON.stringify(outcome).includes('hunter2'));
});

test('losing authority stops the request instead of marking rows for review', async () => {
  const { service } = fixture({ actions: { 'PT2030-0': 'NEW' }, authorityDenied: true });
  await assert.rejects(() => service.review(input()), { code: 'OPPORTUNITY_V2_AUTHORITY_DENIED' });
});

test('inputs are validated and one import is accepted at a time', async () => {
  const { service } = fixture({ actions: { 'PT2030-0': 'NEW' } });
  for (const bad of [{ userId: 'x' }, { importId: 'x' }, { sessionId: '' }]) await assert.rejects(() => service.review(input(bad)), { code: 'PT2030_IMPORT_INPUT_INVALID' });
  await assert.rejects(() => service.accept(input({ batchDigest: 'nope' })), { code: 'PT2030_IMPORT_INPUT_INVALID' });
  let release; const gate = new Promise(resolve => { release = resolve; });
  const slow = createPortugal2030CatalogAcceptance({ pool: {}, authority: { authorize: async () => true },
    accepted: { preview: async () => ({ previewDigest: 'e'.repeat(64), items: [{ action: 'UNCHANGED' }] }), accept: async () => ({}) },
    readImport: async () => { await gate; return { importId: IMPORT, mappingDigest: MAPPING, rows: [row(0)] }; } });
  const first = slow.accept(input({ batchDigest: 'a'.repeat(64) }));
  await assert.rejects(() => slow.accept(input({ batchDigest: 'a'.repeat(64) })), { code: 'PT2030_IMPORT_BUSY' });
  release(); await assert.rejects(() => first, { code: 'PT2030_BATCH_STALE' });
  assert.throws(() => createPortugal2030CatalogAcceptance({ pool: {} }), TypeError);
});

// Regression: the review demanded the same recent authentication as writing, so an administrator whose login was older than the
// limit got a 403 on a read-only screen. Reviewing uses the reading authority; accepting still needs the strict one.
test('the review does not need what accepting needs', async () => {
  const calls = [];
  const repo = name => ({ async preview() { calls.push(name); if (name === 'strict') throw Object.assign(new Error('OPPORTUNITY_V2_AUTHORITY_DENIED'), { code: 'OPPORTUNITY_V2_AUTHORITY_DENIED' }); return { previewDigest: 'e'.repeat(64), items: [{ action: 'NEW' }] }; }, async accept() { throw new Error('not reached'); } });
  const service = createPortugal2030CatalogAcceptance({ pool: {}, authority: { authorize: async () => true }, accepted: repo('strict'), reviewing: repo('reading'),
    readImport: async () => ({ importId: IMPORT, mappingDigest: MAPPING, rows: [row(0)] }) });
  const shown = await service.review(input());
  assert.equal(shown.totals.ACCEPTABLE, 1); assert.deepEqual(calls, ['reading']);
  await assert.rejects(() => service.accept(input({ batchDigest: shown.batchDigest })), { code: 'OPPORTUNITY_V2_AUTHORITY_DENIED' });
  assert.deepEqual(calls, ['reading', 'strict']);
});
