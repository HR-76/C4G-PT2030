'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planAuditPartitions, ensureAuditPartitions, defaultPartitionRows } = require('../src/audit/partitionMaintenance');

// audit.event is partitioned by month and the baseline creates only 2026_10, 2026_11 and DEFAULT.
// Rotation is plain DDL run by the audit migrator, so no schema fingerprint changes.
function fakeClient({ existing = [], defaultRows = 0, conflictFor = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push([sql.trim().replace(/\s+/g, ' '), params]);
      if (/^SELECT to_regclass/.test(sql.trim())) return { rows: [{ present: existing.includes(params[0]) }] };
      if (/FROM audit\.event_default WHERE accepted_at/.test(sql)) return { rows: [{ conflict: conflictFor === params[0] }] };
      if (/count\(\*\)::int AS rows FROM audit\.event_default/.test(sql)) return { rows: [{ rows: defaultRows }] };
      return { rows: [] };
    }
  };
}
const now = new Date('2026-11-11T10:00:00Z');

test('plan covers the current month plus the horizon with UTC bounds and zero-padded names', () => {
  const plan = planAuditPartitions(now, 3);
  assert.deepEqual(plan.map(p => p.name), ['event_2026_11', 'event_2026_12', 'event_2027_01', 'event_2027_02']);
  assert.deepEqual(plan[1], { name: 'event_2026_12', from: '2026-12-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' });
  assert.equal(planAuditPartitions(new Date('2026-12-31T23:59:59Z'), 1)[0].name, 'event_2026_12');
});

test('plan refuses a missing, fractional or out-of-range horizon and an invalid date', () => {
  for (const bad of [0, -1, 25, 1.5, NaN, '3', undefined, null]) {
    assert.throws(() => planAuditPartitions(now, bad), /AUDIT_PARTITION_HORIZON_INVALID/, String(bad));
  }
  assert.throws(() => planAuditPartitions(new Date('nope'), 3), /AUDIT_PARTITION_DATE_INVALID/);
});

test('ensure creates only missing partitions as the audit owner inside one transaction', async () => {
  const client = fakeClient({ existing: ['audit.event_2026_11', 'audit.event_2026_10'] });
  const result = await ensureAuditPartitions(client, { now, monthsAhead: 2 });
  assert.deepEqual(result.created, ['event_2026_12', 'event_2027_01']);
  const sql = client.calls.map(c => c[0]);
  assert.equal(sql[0], 'BEGIN');
  assert.match(sql[1], /^SET LOCAL lock_timeout/);
  assert.equal(sql[2], 'SET LOCAL ROLE c4g_audit_owner');
  assert.equal(sql.at(-1), 'COMMIT');
  assert.match(sql.at(-2), /FROM audit\.event_default$/, 'alarm count is read as the owner, before commit');
  const ddl = sql.filter(s => /^CREATE TABLE/.test(s));
  assert.deepEqual(ddl, [
    "CREATE TABLE audit.event_2026_12 PARTITION OF audit.event FOR VALUES FROM ('2026-12-01T00:00:00.000Z') TO ('2027-01-01T00:00:00.000Z')",
    "CREATE TABLE audit.event_2027_01 PARTITION OF audit.event FOR VALUES FROM ('2027-01-01T00:00:00.000Z') TO ('2027-02-01T00:00:00.000Z')"
  ]);
});

test('ensure is idempotent when every partition already exists', async () => {
  const client = fakeClient({ existing: ['audit.event_2026_11', 'audit.event_2026_12'] });
  const result = await ensureAuditPartitions(client, { now, monthsAhead: 1 });
  assert.deepEqual(result.created, []);
  assert.equal(client.calls.some(c => /^CREATE TABLE/.test(c[0])), false);
});

test('ensure rolls back and refuses when DEFAULT already holds rows for a month to create', async () => {
  const client = fakeClient({ conflictFor: '2026-12-01T00:00:00.000Z' });
  await assert.rejects(() => ensureAuditPartitions(client, { now, monthsAhead: 2 }), /AUDIT_PARTITION_DEFAULT_CONFLICT/);
  const sql = client.calls.map(c => c[0]);
  assert.equal(sql.at(-1), 'ROLLBACK');
  assert.equal(sql.includes('COMMIT'), false);
});

test('ensure rolls back on any DDL failure and rethrows the original error', async () => {
  const client = fakeClient();
  const original = client.query;
  client.query = async (sql, params) => {
    if (/^\s*CREATE TABLE/.test(sql)) throw Object.assign(new Error('boom'), { code: '42501' });
    return original(sql, params);
  };
  await assert.rejects(() => ensureAuditPartitions(client, { now, monthsAhead: 1 }), /boom/);
  assert.equal(client.calls.at(-1)[0], 'ROLLBACK');
});

test('default partition alarm reports the row count', async () => {
  assert.equal(await defaultPartitionRows(fakeClient({ defaultRows: 7 })), 7);
  assert.equal(await defaultPartitionRows(fakeClient({ defaultRows: 0 })), 0);
});
