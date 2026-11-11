'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { syncCentralObservation } = require('../scripts/localPlatform/centralObservation');

const tenantId = '11111111-1111-4111-8111-111111111111';
const observation = { tenantId, currentVersion: '040_application_chat_retention', schemaFingerprint: 'f'.repeat(64), capabilities: ['A'] };
const stale = { current_version: '038_application_task_details', compatibility_state: 'COMPATIBLE', revision: '9',
  verified_capabilities: { schemaFingerprint: 'a'.repeat(64) }, migration_lock_ref: null };
const central = row => ({ async query(sql, values) { assert.match(sql, /tenant_schema_state/); assert.deepEqual(values, [tenantId]); return { rows: row ? [row] : [] }; } });
const recorder = () => { const calls = []; return { calls, async publish(input) { calls.push(input); return { revision: String(input.expectedRevision + 1) }; } }; };

test('a stale Central directory is reported without writing unless apply is set', async () => {
  const publisher = recorder();
  const result = await syncCentralObservation({ central: central(stale), observation, tenantId, installationId: 'install', apply: false, publisher });
  assert.deepEqual(result, { status: 'STALE', revision: 9, centralVersion: '038_application_task_details' });
  assert.equal(publisher.calls.length, 0);
});

test('apply publishes the observed tenant schema to Central at the current revision', async () => {
  const publisher = recorder();
  const result = await syncCentralObservation({ central: central(stale), observation, tenantId, installationId: 'install', apply: true, publisher });
  assert.deepEqual(result, { status: 'PUBLISHED', revision: 10, centralVersion: '038_application_task_details' });
  assert.deepEqual(publisher.calls, [{ expectedRevision: 9, correlationId: 'install',
    idempotencyKey: 'install-central-observation-040_application_chat_retention', evidence: observation }]);
});

test('a Central directory that already records the observed schema is left alone', async () => {
  const publisher = recorder();
  const current = { ...stale, current_version: observation.currentVersion, revision: '10', verified_capabilities: { schemaFingerprint: observation.schemaFingerprint } };
  const result = await syncCentralObservation({ central: central(current), observation, tenantId, installationId: 'install', apply: true, publisher });
  assert.deepEqual(result, { status: 'IN_SYNC', revision: 10 });
  assert.equal(publisher.calls.length, 0);
});

test('a locked, incompatible, missing or foreign Central state is refused', async () => {
  const publisher = recorder();
  const run = (row, extra = {}) => syncCentralObservation({ central: central(row), observation, tenantId, installationId: 'install', apply: true, publisher, ...extra });
  await assert.rejects(run({ ...stale, migration_lock_ref: 'lock' }), /CENTRAL_SCHEMA_STATE_LOCKED/);
  await assert.rejects(run({ ...stale, compatibility_state: 'MIGRATING' }), /CENTRAL_SCHEMA_STATE_UNEXPECTED/);
  await assert.rejects(run(null), /CENTRAL_SCHEMA_STATE_MISSING/);
  await assert.rejects(run(stale, { observation: { ...observation, tenantId: 'other' } }), /CENTRAL_OBSERVATION_TENANT_MISMATCH/);
  assert.equal(publisher.calls.length, 0);
});

// Regression: migrations 039 and 040 were applied locally without telling Central, and the API answered 503.
test('the local tenant activation scripts synchronise Central after migrating', () => {
  for (const name of ['documentDeletion.js', 'chatRetention.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../scripts/localPlatform', name), 'utf8');
    assert.match(source, /require\('\.\/centralObservation'\)/, name);
    assert.match(source, /syncCentralObservation\(/, name);
  }
});
