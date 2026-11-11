'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runMetadataAB } = require('./integration/central-snapshot-ab/metadata.cjs');
const revision = '043_opportunity_eu_writer_v2';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture({ divergent = false, failMeasured = false } = {}) {
  const state = { connections: 0, releases: 0, queries: 0, measuring: false };
  const expected = hash({ tables: ['same'], columns: [] });
  const pool = { async connect() { state.connections++; return { async query() { state.queries++; if (failMeasured && state.measuring) throw Object.assign(Error('synthetic'), { code: 'SYNTHETIC_QUERY_FAILURE' }); return { rows: [] }; }, release() { state.releases++; } }; } };
  const load = root => ({ EXPECTED_CENTRAL_SCHEMA_SHA256_BY_VERSION: { [revision]: expected }, schemaFingerprint: hash,
    async centralSchemaSnapshot(client) { await client.query('base-' + root); for (let i = 0; i < 7; i++) await client.query('security-' + i); return { tables: [divergent && root === 'B' ? 'different' : 'same'], columns: [] }; },
    async assertCentralSchema(client) { const snapshot = await this.centralSchemaSnapshot(client); for (let i = 0; i < 10; i++) await client.query('additional-security-' + i); return hash(snapshot); } });
  return { pool, state, load };
}
test('AB metadata preserves full balanced populations, fresh calls and one checkout per block', async () => {
  const f = fixture();
  const r = await runMetadataAB({ client: f.pool, rootA: 'A', rootB: 'B', revision, load: f.load });
  assert.equal(r.status, 'PASS'); assert.equal(r.samples.length, 1328); assert.equal(r.blocks.length, 12); assert.equal(r.pairs.length, 6);
  assert.equal(f.state.connections, 13); assert.equal(f.state.releases, 13);
  assert.deepEqual(r.pairs.map(p => p.order.join('')), ['AB','BA','AB','BA','AB','BA']);
  for (const arm of ['A', 'B']) { assert.equal(r.summary[arm].count, 600); assert.equal(r.samples.filter(s => s.arm === arm && s.phase === 'warmup').length, 60); }
  assert(r.samples.filter(s => s.phase === 'measured').every(s => s.queryCounts.base === 1 && s.queryCounts.security === 17));
  assert(r.samples.every(s => s.queries.every(q => q.status === 'PASS'))); assert.equal(r.checks.exactJsonBytes, true);
});
test('AB metadata refuses JSON drift before measured calls and releases the connection', async () => {
  const f = fixture({ divergent: true });
  await assert.rejects(runMetadataAB({ client: f.pool, rootA: 'A', rootB: 'B', revision, load: f.load }), error => {
    assert.equal(error.code, 'AB_METADATA_JSON_MISMATCH'); assert.equal(error.metadataABReport.status, 'FAIL');
    assert.equal(error.metadataABReport.samples.filter(s => s.phase === 'measured').length, 0); return true;
  }); assert.equal(f.state.connections, f.state.releases);
});
test('AB metadata keeps failed timed query evidence and refuses a raw client for measurement', async () => {
  const f = fixture({ failMeasured: true });
  await assert.rejects(runMetadataAB({ client: f.pool, rootA: 'A', rootB: 'B', revision, load: f.load,
    onProgress(event) { if (event.stage === 'functional-complete') f.state.measuring = true; } }), error => {
    assert.equal(error.code, 'SYNTHETIC_QUERY_FAILURE'); assert.equal(error.metadataABReport.status, 'FAIL');
    assert.equal(error.metadataABReport.samples.at(-1).queries[0].status, 'FAIL'); return true;
  }); assert.equal(f.state.connections, f.state.releases);
  await assert.rejects(runMetadataAB({ client: { query() {} }, rootA: 'A', rootB: 'B', revision, load: f.load }), { code: 'AB_METADATA_POOL_REQUIRED' });
});

// Only the monotonic clock is virtual. The production budgets, loop counts and
// collectors remain unchanged; no sleep, database or host clock change is used.
function timedFixture({ checkoutAdvanceMs = 0, advanceQuery = () => 0, releaseAdvanceMs = 0 } = {}) {
  const f = fixture(), clock = { now: 0, queryIndex: 0 };
  const filename = path.join(__dirname, 'integration/central-snapshot-ab/metadata.cjs');
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(filename, 'utf8'), {
    module, exports: module.exports, require, process, performance: { now: () => clock.now }
  }, { filename });
  const originalConnect = f.pool.connect;
  f.pool.connect = async () => {
    const acquired = await originalConnect();
    if (f.state.measuring) clock.now += checkoutAdvanceMs;
    return {
      async query(...args) {
        const result = await acquired.query(...args);
        if (f.state.measuring) clock.now += advanceQuery(clock.queryIndex++);
        return result;
      },
      release() {
        acquired.release();
        if (f.state.measuring) clock.now += releaseAdvanceMs;
      }
    };
  };
  return { ...f, clock, run: () => module.exports.runMetadataAB({
    client: f.pool, rootA: 'A', rootB: 'B', revision, load: f.load,
    onProgress(event) { if (event.stage === 'functional-complete') f.state.measuring = true; }
  }) };
}

test('AB metadata budget resets for every block rather than capping the whole campaign', async () => {
  const f = timedFixture({ advanceQuery: () => 150 });
  const report = await f.run();
  assert.equal(report.status, 'PASS');
  assert.equal(report.blocks.length, 12);
  assert.equal(report.totalDurationMs, 12 * 297000);
  for (const block of report.blocks) {
    assert.equal(block.controlBudgetMs, 300000);
    assert.equal(block.controlElapsedMs, 297000);
    assert.equal(block.status, 'PASS');
    assert.equal(block.count, 100);
  }
  assert.equal(f.state.connections, 13);
  assert.equal(f.state.releases, 13);
});

test('AB metadata checkout consumes the block budget before any warmup is attempted', async () => {
  const f = timedFixture({ checkoutAdvanceMs: 300001 });
  await assert.rejects(f.run(), error => {
    const report = error.metadataABReport;
    assert.equal(error.code, 'CONTROL_DEADLINE_EXCEEDED');
    assert.equal(report.status, 'FAIL');
    assert.equal(report.blocks.length, 1);
    assert.equal(report.blocks[0].status, 'FAIL');
    assert.equal(report.blocks[0].controlElapsedMs, 300001);
    assert.equal(report.samples.length, 8);
    assert.equal(report.samples.filter(sample => sample.phase === 'warmup' || sample.phase === 'measured').length, 0);
    assert.equal(report.connections.at(-1).acquisitionMs, 300001);
    return true;
  });
  assert.equal(f.state.connections, 2);
  assert.equal(f.state.releases, 2);
});

for (const [label, exceedAt, warmups, measured] of [
  ['first warmup', 17, 1, 0],
  ['last measured call', 18 * 110 - 1, 10, 100]
]) test('AB metadata retains the completed ' + label + ' that exceeds its block budget', async () => {
  const f = timedFixture({ advanceQuery: index => index === exceedAt ? 300001 : 0 });
  await assert.rejects(f.run(), error => {
    const report = error.metadataABReport;
    assert.equal(error.code, 'CONTROL_DEADLINE_EXCEEDED');
    assert.equal(report.status, 'FAIL');
    assert.equal(report.blocks.length, 1);
    assert.equal(report.blocks[0].status, 'FAIL');
    assert.equal(report.blocks[0].controlElapsedMs, 300001);
    assert.equal(report.samples.filter(sample => sample.phase === 'warmup').length, warmups);
    assert.equal(report.samples.filter(sample => sample.phase === 'measured').length, measured);
    const attempt = report.samples.at(-1);
    assert.equal(attempt.durationMs, 300001);
    assert.equal(attempt.queries.length, 18);
    assert(attempt.queries.every(query => query.status === 'PASS'));
    assert.equal(attempt.queries.at(-1).durationMs, 300001);
    assert.equal(report.pairs.length, 0);
    assert.deepEqual(Object.keys(report.summary), []);
    return true;
  });
  assert.equal(f.state.connections, 2);
  assert.equal(f.state.releases, 2);
});

test('AB metadata checks the budget after returning the connection as well', async () => {
  const f = timedFixture({ releaseAdvanceMs: 300001 });
  await assert.rejects(f.run(), error => {
    const report = error.metadataABReport;
    assert.equal(error.code, 'CONTROL_DEADLINE_EXCEEDED');
    assert.equal(report.blocks[0].controlElapsedMs, 300001);
    assert.equal(report.blocks[0].status, 'FAIL');
    assert.equal(report.samples.filter(sample => sample.phase === 'measured').length, 100);
    assert.equal(report.pairs.length, 0);
    return true;
  });
  assert.equal(f.state.connections, 2);
  assert.equal(f.state.releases, 2);
});
