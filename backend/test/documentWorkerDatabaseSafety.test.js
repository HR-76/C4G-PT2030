'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDocumentRepository } = require('../src/documents/repository');
const { transaction } = require('../src/documents/postgresWorkerPorts');
const { tenantPoolOptions } = require('../src/config/documentWorkerInfrastructure');

// The document worker's tenant pools need the same server-side backstops as the Central and Authority
// pools, and a connection whose ROLLBACK failed must be destroyed instead of returned to the pool.
const organizationId = '00000000-0000-4000-8000-000000000001';
const versionId = '00000000-0000-4000-8000-000000000002';
const credential = { host: '127.0.0.1', port: 55432, database: 'tenant_synthetic', login: 'worker_synthetic', password: 'synthetic', ssl: false };

function fakePool({ rollbackFails = false, failAt = null } = {}) {
  const released = [];
  const statements = [];
  const client = {
    async query(sql) {
      const text = sql.replace(/\s+/g, ' ').trim();
      statements.push(text);
      if (text === 'ROLLBACK' && rollbackFails) throw new Error('connection reset');
      if (failAt && text.includes(failAt)) throw new Error('synthetic work failure');
      return { rows: [], rowCount: 0 };
    },
    release(error) { released.push(error ?? null); }
  };
  return { pool: { connect: async () => client }, released, statements };
}

test('worker tenant pools carry statement and idle-in-transaction backstops by default', () => {
  const options = tenantPoolOptions(credential, {});
  assert.equal(options.statement_timeout, 30000);
  assert.equal(options.idle_in_transaction_session_timeout, 60000);
  assert.equal(options.max, 5);
  assert.equal(options.connectionTimeoutMillis, 5000);
  assert.equal(options.idleTimeoutMillis, 30000);
  assert.equal(options.user, 'worker_synthetic');
});

test('worker pool backstops are configurable, and 0 disables one of them', () => {
  const tuned = tenantPoolOptions(credential, { DOCUMENT_WORKER_DB_STATEMENT_TIMEOUT_MS: '5000', DOCUMENT_WORKER_DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '0' });
  assert.equal(tuned.statement_timeout, 5000);
  assert.equal(Object.hasOwn(tuned, 'idle_in_transaction_session_timeout'), false);
  assert.throws(() => tenantPoolOptions(credential, { DOCUMENT_WORKER_DB_STATEMENT_TIMEOUT_MS: '-1' }), /DOCUMENT_WORKER_DB_STATEMENT_TIMEOUT_MS/);
});

test('the worker factory builds every tenant pool through the shared options', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/config/documentWorkerInfrastructure.js'), 'utf8');
  assert.match(source, /new Pool\(tenantPoolOptions\(credential,\s*env\)\)/);
});

test('document repository destroys a connection whose ROLLBACK failed and keeps the original error', async () => {
  const { pool, released } = fakePool({ rollbackFails: true, failAt: 'FROM document_storage.document_version' });
  const repository = createDocumentRepository(pool);
  await assert.rejects(() => repository.findVersion({ organizationId, versionId }), /synthetic work failure/);
  assert.equal(released.length, 1);
  assert.ok(released[0] instanceof Error, 'a broken connection must be destroyed, not pooled');
});

test('document repository returns a healthy connection to the pool after a clean rollback or commit', async () => {
  const failing = fakePool({ failAt: 'FROM document_storage.document_version' });
  await assert.rejects(() => createDocumentRepository(failing.pool).findVersion({ organizationId, versionId }), /synthetic work failure/);
  assert.deepEqual(failing.released, [null]);
  const ok = fakePool();
  await createDocumentRepository(ok.pool).findVersion({ organizationId, versionId });
  assert.deepEqual(ok.released, [null]);
  assert.equal(ok.statements.at(-1), 'COMMIT');
});

test('document worker ports destroy a connection whose ROLLBACK failed and keep the original error', async () => {
  const { pool, released } = fakePool({ rollbackFails: true });
  await assert.rejects(() => transaction(pool, 'c4g_document_runtime', organizationId, async () => { throw new Error('synthetic work failure'); }), /synthetic work failure/);
  assert.equal(released.length, 1);
  assert.ok(released[0] instanceof Error);
  const clean = fakePool();
  await assert.rejects(() => transaction(clean.pool, 'c4g_document_runtime', organizationId, async () => { throw new Error('synthetic work failure'); }), /synthetic work failure/);
  assert.deepEqual(clean.released, [null]);
});
