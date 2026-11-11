'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { guardPool, runtimePoolTimeouts } = require('../src/config/poolResilience');

const source = name => fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8');

test('an idle client failure no longer crashes the process and is reported without details', () => {
  const pool = new EventEmitter(), lines = [];
  assert.throws(() => pool.emit('error', new Error('baseline')), /baseline/);
  assert.equal(guardPool(pool, 'central', { write: line => lines.push(line) }), pool);
  const failure = Object.assign(new Error('terminating connection for postgresql://user:secret@host/db'), { code: 'ECONNRESET' });
  assert.doesNotThrow(() => pool.emit('error', failure));
  assert.doesNotThrow(() => pool.emit('error', Object.assign(new Error('x'), { code: 'not a code; secret' })));
  assert.deepEqual(lines, ['C4G_DB_POOL_IDLE_ERROR pool=central code=ECONNRESET\n', 'C4G_DB_POOL_IDLE_ERROR pool=central code=UNKNOWN\n']);
});

test('guarding is idempotent, survives a failing writer and tolerates pool doubles', () => {
  const pool = new EventEmitter();
  guardPool(pool, 'central', { write() { throw new Error('stderr closed'); } });
  guardPool(pool, 'central');
  assert.equal(pool.listenerCount('error'), 1);
  assert.doesNotThrow(() => pool.emit('error', new Error('x')));
  const double = { query() {} };
  assert.equal(guardPool(double, 'double'), double);
  assert.throws(() => guardPool(new EventEmitter(), 'bad name'), TypeError);
});

test('runtime pools bound statements and idle transactions by default', () => {
  assert.deepEqual(runtimePoolTimeouts({}, 'CENTRAL_DB'), { statement_timeout: 30000, idle_in_transaction_session_timeout: 60000 });
  assert.deepEqual(runtimePoolTimeouts({ CENTRAL_DB_STATEMENT_TIMEOUT_MS: '5000', CENTRAL_DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '0' }, 'CENTRAL_DB'),
    { statement_timeout: 5000 });
  assert.deepEqual(runtimePoolTimeouts({ CENTRAL_DB_STATEMENT_TIMEOUT_MS: '0', CENTRAL_DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '0' }, 'CENTRAL_DB'), {});
  for (const value of ['-1', '1.5', 'abc', '3600001']) {
    assert.throws(() => runtimePoolTimeouts({ CENTRAL_DB_STATEMENT_TIMEOUT_MS: value }, 'CENTRAL_DB'), /CENTRAL_DB_STATEMENT_TIMEOUT_MS/);
  }
});

test('every long-lived runtime pool is guarded and the Central pools carry timeouts', () => {
  const guarded = ['src/config/centralDb.js', 'src/config/authorityDb.js', 'src/config/opportunityRuntime.js',
    'src/config/documentWorkerInfrastructure.js', 'src/config/opportunityImportWorkerInfrastructure.js',
    'src/config/opportunityReceiptWorkerInfrastructure.js', 'src/config/fundingTendersWorker.js',
    'src/fundingTenders/catalogReader.js', 'src/productionComposition.js'];
  for (const name of guarded) {
    const text = source(name), pools = text.match(/new Pool\(/g) || [], guards = text.match(/guardPool\(/g) || [];
    assert.ok(pools.length > 0, name);
    assert.equal(guards.length, pools.length, `${name} must guard every pool it creates`);
  }
  for (const name of ['src/config/centralDb.js', 'src/config/authorityDb.js']) assert.match(source(name), /runtimePoolTimeouts\(/, name);
  // Migrations legitimately run long statements on the Central pool.
  assert.match(source('scripts/runCentralMigrations.js'), /CENTRAL_DB_STATEMENT_TIMEOUT_MS \?\?= '0'/);
});
