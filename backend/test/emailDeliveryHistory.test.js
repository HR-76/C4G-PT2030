'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createDeliveryHistory, query, RETENTION_MS } = require('../src/emailTemplates/deliveryHistory');
const now = Date.parse('2026-11-15T15:00:00Z');
const actor = randomUUID(), req = { user: { id: actor }, sessionID: 'session', authContext: { sessionId: 'session' } };
function fixture({ allowed = () => true, local = [], remote = [] } = {}) {
  const calls = [];
  const pool = { async query(sql, args) { calls.push({ sql, args }); return { rows: local.filter(row =>
    new Date(row.occurred_at).getTime() < +args[2] || (new Date(row.occurred_at).getTime() === +args[2] && row.id <= args[3])).slice(0, 52) }; } };
  const keycloak = { async history(p) { calls.push({ remote: true }); return { items: remote.filter(row =>
    row.occurredAt < p.before || (row.occurredAt === p.before && row.id <= p.id)).slice(0, 52) }; }, async retention() { calls.push({ sweep: true }); } };
  const service = createDeliveryHistory({ pool, keycloak, clock: () => now, repository: { isPlatformAdmin: allowed } });
  return { service, calls, pool, keycloak };
}
test('refuses anonymous and non-admin before touching either history source', async () => {
  const f = fixture({ allowed: () => false });
  await assert.rejects(f.service.list({}, req), { code: 'C4G_ADMIN_REQUIRED' });
  await assert.rejects(f.service.list({}, {}), { code: 'C4G_ADMIN_REQUIRED' });
  assert.deepEqual(f.calls, []);
});
test('rechecks revocation after remote read', async () => {
  let reads = 0;
  const f = fixture({ allowed: () => ++reads === 1 });
  await assert.rejects(f.service.list({}, req), { code: 'C4G_ADMIN_REQUIRED' });
  assert.equal(reads, 2);
});
test('closed filters and cursor binding reject malformed or mixed pagination', () => {
  for (const input of [{ type: 'email-code' }, { status: ['ACCEPTED'] }, { recipient: 'x' }, { cursor: 'bad' }]) {
    assert.throws(() => query(input, now), { code: 'INVALID_INPUT' });
  }
  const cursor = Buffer.from(JSON.stringify([now, randomUUID(), 'KEYCLOAK', 'password-reset', ''])).toString('base64url');
  assert.throws(() => query({ cursor }, now), { code: 'INVALID_INPUT' });
});
test('same-millisecond pagination neither skips nor duplicates across sources', async () => {
  const ids = Array.from({ length: 75 }, () => randomUUID()).sort().reverse();
  const f = fixture({ local: ids.map(id => ({ id, occurred_at: new Date(now), recipient: 'test@example.invalid',
    organization_id: randomUUID(), result: 'ACCEPTED', is_test: false })),
  remote: ids.map(id => ({ id, occurredAt: now, recipient: 'test@example.invalid', status: 'ACCEPTED' })) });
  const seen = [];
  let cursor = '';
  do {
    const page = await f.service.list({ cursor }, req);
    seen.push(...page.items.map(item => item.source + item.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.length, 150);
  assert.equal(new Set(seen).size, 150);
});
test('90-day boundary masks both sources and never resolves the current account email', async () => {
  const f = fixture({ local: [{ id: randomUUID(), occurred_at: new Date(now - RETENTION_MS), recipient: 'old@example.invalid', result: 'UNCONFIRMED' }],
    remote: [{ id: randomUUID(), occurredAt: now - RETENTION_MS - 1, recipient: 'old@example.invalid', status: 'ACCEPTED' }] });
  const result = await f.service.list({}, req);
  assert.equal(result.items.length, 2);
  assert.ok(result.items.every(row => row.recipient === null));
});
test('source failure is not presented as an empty history', async () => {
  const f = fixture();
  f.keycloak.history = async () => { throw Error('private-provider-error'); };
  await assert.rejects(f.service.list({}, req));
});
test('storage failure before send prevents unrecorded delivery', async () => {
  const f = fixture(); let sends = 0;
  f.pool.query = async () => { throw Error('private-db-error'); };
  await assert.rejects(f.service.deliver({ id: randomUUID(), recipient: 'test@example.invalid' }, async () => { sends++; }));
  assert.equal(sends, 0);
});
test('an accepted intention is not sent again even after transport idempotency expires', async () => {
  const f = fixture(); let sends = 0;
  f.pool.query = async () => ({ rows: [{ status: 'ACCEPTED' }] });
  assert.deepEqual(await f.service.deliver({ id: randomUUID(), recipient: 'test@example.invalid' }, async () => { sends++; }), { status: 'ACCEPTED' });
  assert.equal(sends, 0);
});
test('receipt failure after acceptance preserves outcome without resending', async () => {
  const f = fixture(); let writes = 0, sends = 0;
  f.pool.query = async () => { if (++writes === 2) throw Error('db'); return { rows: [] }; };
  const result = await f.service.deliver({ id: randomUUID(), recipient: 'test@example.invalid' }, async () => { sends++; return { status: 'ACCEPTED' }; });
  assert.equal(result.status, 'ACCEPTED'); assert.equal(sends, 1);
  assert.equal((await f.service.list({ type: 'member-invitation' }, req)).recordingFailures, 1);
});
test('retention invokes physical anonymization in both origins', async () => {
  const f = fixture(); f.pool.query = async sql => { f.calls.push({ sql }); };
  await f.service.retention();
  assert.match(f.calls[0].sql, /email_delivery_retention/); assert.equal(f.calls[1].sweep, true);
});
