'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createExecutionLineageProjection } = require('../src/async/executionLineageProjection');

// When a consumer claims a delivery before the relay commits its projection, load() falls back to the
// durable outbox row. The unique index is ((envelope->>'executionId')::uuid) WHERE lineage_version=1, so
// the lookup must repeat that expression and predicate: the previous text comparison could not use it
// (300k rows: sequential scan 23.5 ms versus index scan 0.024 ms).
const ID = '11111111-1111-4111-8111-111111111111';

async function captureFallback() {
  const statements = [];
  const client = {
    async query(sql, values) {
      const text = sql.replace(/\s+/g, ' ').trim();
      statements.push({ text, values });
      return { rows: [], rowCount: 0 };
    }
  };
  const projection = createExecutionLineageProjection({ transaction: work => work(client) });
  await assert.rejects(() => projection.load(ID), { message: 'ASYNC_LINEAGE_PROJECTION_UNAVAILABLE' });
  return statements;
}

test('the outbox fallback repeats the unique index expression and its partial predicate', async () => {
  const [, fallback] = await captureFallback();
  assert.ok(fallback.text.includes("FROM async_exec.outbox WHERE (envelope->>'executionId')::uuid = $1::uuid AND lineage_version = 1"), fallback.text);
  assert.deepEqual(fallback.values, [ID]);
  assert.match(fallback.text, /LIMIT 2$/, 'ambiguity must still be detectable');
});

test('the execution row is still read by primary key before any outbox fallback', async () => {
  const [primary] = await captureFallback();
  assert.match(primary.text, /FROM async_exec\.execution WHERE execution_id=\$1$/);
});

test('no text comparison on the execution id remains in the projection source', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/async/executionLineageProjection.js'), 'utf8');
  assert.doesNotMatch(source, /envelope->>'executionId'\s*=\s*\$1/);
});
