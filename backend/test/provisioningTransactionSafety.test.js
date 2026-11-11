'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { provisionDocumentApiProfile } = require('../src/security/documentApiProfile');
const { provisionDocumentQueueProfile } = require('../src/security/documentQueueProfile');
const { transitionTenantOwnership } = require('../src/security/tenantOwnershipTransition');

// The installer-only provisioners hold an advisory lock inside one transaction. They must give up
// waiting for it, and a failing ROLLBACK must never hide the failure that caused the rollback.
function fakeClient({ rollbackFails = false } = {}) {
  const statements = [];
  return {
    statements,
    async query(sql) {
      const text = sql.replace(/\s+/g, ' ').trim();
      statements.push(text);
      if (text === 'ROLLBACK' && rollbackFails) throw new Error('connection reset by peer');
      return { rows: [], rowCount: 0 };
    }
  };
}

const cases = [
  ['document API profile', client => provisionDocumentApiProfile(client, { login: 'synthetic_api', password: 'synthetic-never-used-password-1' }), /pg_advisory_xact_lock\(43000032\)/],
  ['document queue profile', client => provisionDocumentQueueProfile(client, { login: 'synthetic_queue', password: 'synthetic-never-used-password-1' }), /pg_advisory_xact_lock\(43000045\)/]
];

for (const [name, run, lockPattern] of cases) {
  test(`${name}: waits for the advisory lock with a bounded lock_timeout`, async () => {
    const client = fakeClient();
    await assert.rejects(() => run(client));
    const sql = client.statements;
    const timeout = sql.findIndex(text => /lock_timeout/.test(text));
    const lock = sql.findIndex(text => lockPattern.test(text));
    assert.ok(timeout > 0 && lock > 0, `${sql.join(' | ')}`);
    assert.equal(sql[0], 'BEGIN');
    assert.ok(timeout < lock, 'lock_timeout must be set before the lock is requested');
    assert.match(sql[timeout], /SET LOCAL lock_timeout\s*=\s*'5s'/);
  });

  test(`${name}: a failing ROLLBACK keeps the original error`, async () => {
    const original = await run(fakeClient()).then(() => null, error => error);
    assert.ok(original, 'the synthetic scenario must fail');
    const client = fakeClient({ rollbackFails: true });
    const error = await run(client).then(() => null, caught => caught);
    assert.equal(error?.message, original.message);
    assert.equal(client.statements.at(-1), 'ROLLBACK');
  });
}

test('tenant ownership transition: a failing ROLLBACK keeps the original refusal and the bounded timeouts stay', async () => {
  const run = client => transitionTenantOwnership(client, {});
  const original = await run(fakeClient()).then(() => null, error => error);
  assert.equal(original?.message, 'TENANT_OWNERSHIP_BASELINE_REFUSED');
  const client = fakeClient({ rollbackFails: true });
  const error = await run(client).then(() => null, caught => caught);
  assert.equal(error?.message, 'TENANT_OWNERSHIP_BASELINE_REFUSED');
  assert.ok(client.statements.some(text => /lock_timeout='5s'/.test(text)));
});
