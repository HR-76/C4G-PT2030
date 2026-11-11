'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const runnerPath = path.join(root, 'test/integration/eu-writer-performance/metadata.cjs');
const schemaPath = path.join(root, 'backend/src/security/centralSchemaManifest.js');
const legacy = require('../backend/test/support/centralSchemaLegacyQueries.json');
const protocol = require('../context/references/performance/eu-writer-v2-protocol.json');
const revisions = ['042_opportunity_eu_source_control_v2', '043_opportunity_eu_writer_v2'];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function load(file, replacements = {}) {
  const localRequire = createRequire(file), instance = { exports: {} };
  vm.runInThisContext('(function(exports, require, module, __filename, __dirname) {\n' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file })(
    instance.exports, name => Object.hasOwn(replacements, name) ? replacements[name] : localRequire(name), instance, file, path.dirname(file));
  return instance.exports;
}

function fixture({ revision = revisions[1], empty = false } = {}) {
  const catalog = {
    tables: empty ? [] : [{ table_name: 'synthetic' }],
    columns: [], constraints: [], indexes: [], triggers: [], triggerFunctions: [],
    authoritySequence: [{ seqstart: '1', seqincrement: '1', seqmin: '1', seqmax: '9223372036854775807', seqcache: '1', seqcycle: false }]
  };
  const authority = { roles: ['limited'] }, reader = { roles: ['reader'] };
  const expected = { tables: catalog.tables, columns: [], constraints: [], indexes: [], authoritySequence: catalog.authoritySequence, authoritySecurity: authority, catalogReader: reader };
  const entry = { version: revision, schemaFingerprint: digest(expected), authoritySecurityFingerprint: 'authority', catalogSecurityFingerprint: 'catalog', ...(revision === revisions[1] ? { euWriterSecurityFingerprint: 'writer' } : {}) };
  const security = async (client, prefix, count, result) => {
    for (let i = 0; i < count; i++) await client.query(prefix + i, ['private-sentinel']);
    return structuredClone(result);
  };
  const schema = load(schemaPath, {
    './centralMigrationManifest': { manifest: [entry], knownManifest: [entry] },
    './authoritySecurityManifest': {
      authoritySecuritySnapshot: client => security(client, 'authority-', 1, authority),
      assertAuthoritySecuritySnapshot(value) { assert.deepEqual(value, authority); }
    },
    './catalogReaderSecurity': { catalogReaderSnapshot: client => security(client, 'reader-', 6, reader) },
    './catalogSecurityManifest': { assertCatalogSecurity: client => security(client, 'catalog-', 5, {}) },
    './euWriterSecurityManifest': { assertEuWriterSecurity: client => security(client, 'writer-', 5, {}) }
  });
  const state = { calls: [], connected: 0, released: 0, concurrent: 0, maximumConcurrent: 0 };
  const client = { async query(sql, values) {
    state.calls.push({ sql, values });
    if (state.fakeClock) state.clockNs += state.queryAdvanceNs || 0n;
    state.concurrent++; state.maximumConcurrent = Math.max(state.maximumConcurrent, state.concurrent);
    try {
      if (state.failure) throw state.failure;
      const field = Object.keys(legacy).find(key => legacy[key] === sql);
      if (field) return state.malformedLegacy ? { rows: null } : { rows: structuredClone(catalog[field]) };
      if (sql.includes('json_agg(catalog_row)')) {
        if (state.malformedAggregate) return { rows: [] };
        const data = structuredClone(catalog);
        if (state.noncanonical) data.constraints.push({ table_name: 'synthetic', constraint_name: 'bad', constraint_type: 'n', definition: 'UNSUPPORTED_NOT_NULL' });
        return { rows: [data] };
      }
      if (sql === 'catalog-0' && state.securityDrift) throw Object.assign(new Error('private database detail'), { code: 'CATALOG_SECURITY_DRIFT' });
      return { rows: [] };
    } finally { state.concurrent--; }
  } };
  const pool = { async connect() { state.connected++; if (state.fakeClock) state.clockNs += state.checkoutAdvanceNs || 0n; return { query: (...args) => client.query(...args), release() { state.released++; } }; } };
  const runner = load(runnerPath, { '../../../backend/src/security/centralSchemaManifest': schema,
    'node:process': { hrtime: { bigint: () => state.fakeClock ? state.clockNs : process.hrtime.bigint() }, cpuUsage: process.cpuUsage, memoryUsage: process.memoryUsage } });
  return { runner, schema, state, client, pool, revision, expected, catalog };
}

for (const revision of revisions) {
  test('functional M7/M1 preserves current bytes, fingerprints, security and fresh reads: ' + revision, async () => {
    const f = fixture({ revision });
    const report = await f.runner.runMetadata({ client: f.client, revision, mode: 'functional', protocol });
    assert.equal(report.status, 'PASS');
    assert.equal(report.mode, 'functional');
    assert.equal(report.blocks.length, 0);
    assert.equal(report.samples.length, 8);
    assert.equal(report.fingerprint, digest(f.expected));
    assert.equal(f.state.maximumConcurrent, 1);
    for (const sample of report.samples) {
      assert.equal(sample.queryCounts.base, sample.variant === 'M7' ? 7 : 1);
      assert.equal(sample.queryCounts.security, sample.phase === 'equivalence' ? 7 : revision === revisions[1] ? 17 : 12);
      assert.equal(sample.status, 'PASS');
      assert(sample.durationMs >= 0);
    }
    assert.equal(report.checks.exactJsonBytes, true);
    assert.equal(report.checks.freshReadsPerCall, true);
    assert.equal(report.checks.securityReadsPreserved, true);
    assert.doesNotMatch(JSON.stringify(report), /private-sentinel|SELECT|password|connectionString/);
  });
}

test('functional mode remains small even with a complete measurement protocol', async () => {
  const f = fixture({ empty: true });
  const report = await f.runner.runMetadata({ client: f.pool, revision: f.revision, protocol });
  assert.equal(report.samples.length, 8);
  assert.equal(f.state.connected, 1);
  assert.equal(f.state.released, 1);
});

test('a checked-out pg client is not connected or released again by the runner', async () => {
  const f = fixture();
  f.client.connect = () => { throw Error('CLIENT_ALREADY_CONNECTED'); };
  f.client.release = () => { throw Error('CALLER_OWNS_RELEASE'); };
  const report = await f.runner.runMetadata({ client: f.client, revision: f.revision, protocol });
  assert.equal(report.status, 'PASS');
  assert.equal(report.connections[0].callerOwned, true);
});

test('measurement uses six alternating pairs, retained excluded warmups and one checkout per block', async () => {
  const f = fixture(), progress = [];
  const report = await f.runner.runMetadata({ client: f.pool, revision: f.revision, mode: 'measure', protocol, onProgress: event => progress.push(event) });
  assert.equal(report.blocks.length, 12);
  assert.deepEqual(report.blocks.map(block => block.variant), protocol.metadata.pairOrder.flat());
  for (const variant of ['M7', 'M1']) {
    assert.equal(report.samples.filter(sample => sample.variant === variant && sample.phase === 'measured').length, 600);
    assert.equal(report.samples.filter(sample => sample.variant === variant && sample.phase === 'warmup').length, 60);
    assert.equal(report.summary[variant].count, 600);
  }
  assert.equal(f.state.connected, 13);
  assert.equal(f.state.released, 13);
  assert.equal(report.connections.length, 13);
  assert.equal(progress.filter(event => event.stage === 'block-complete').length, 12);
  assert.equal(report.pairs.length, 6);
});

test('protocol deviations and direct-client measurement are refused before database access', async () => {
  const f = fixture();
  await assert.rejects(f.runner.runMetadata({ client: f.client, revision: f.revision, mode: 'measure', protocol }), { code: 'METADATA_POOL_REQUIRED' });
  for (const mutation of [p => p.metadata.measuredCallsPerBlock = 1, p => p.metadata.warmupCallsPerBlock = 0, p => p.metadata.pairOrder.reverse(), p => p.metadata.connectionsPerBlock = 2]) {
    const changed = structuredClone(protocol); mutation(changed);
    await assert.rejects(f.runner.runMetadata({ client: f.pool, revision: f.revision, mode: 'measure', protocol: changed }), { code: 'METADATA_PROTOCOL_INVALID' });
  }
  await assert.rejects(f.runner.runMetadata({ client: f.pool, revision: '032', protocol }), { code: 'METADATA_REVISION_INVALID' });
  assert.equal(f.state.calls.length, 0);
  assert.equal(f.state.connected, 0);
});

test('each metadata block refuses an expired budget after a completed call and retains that call', async () => {
  const f = fixture();
  await assert.rejects(f.runner.runMetadata({ client: f.pool, revision: f.revision, mode: 'measure', protocol,
    onProgress(event) { if (event.stage === 'functional-complete') { f.state.fakeClock = true; f.state.clockNs = 0n; f.state.queryAdvanceNs = 300001000000n; } }
  }), error => {
    assert.equal(error.code, 'CONTROL_DEADLINE_EXCEEDED');
    assert.equal(error.metadataReport.blocks.length, 1);
    assert.equal(error.metadataReport.blocks[0].status, 'FAIL');
    assert.equal(error.metadataReport.samples.filter(sample => sample.phase === 'warmup').length, 1);
    assert.equal(error.metadataReport.samples.filter(sample => sample.phase === 'measured').length, 0);
    return true;
  });
  assert.equal(f.state.connected, 2);
  assert.equal(f.state.released, 2);
});

test('the block budget includes checkout and is checked before the first warmup query', async () => {
  const f = fixture();
  await assert.rejects(f.runner.runMetadata({ client: f.pool, revision: f.revision, mode: 'measure', protocol,
    onProgress(event) { if (event.stage === 'functional-complete') { f.state.fakeClock = true; f.state.clockNs = 0n; f.state.checkoutAdvanceNs = 300001000000n; } }
  }), error => {
    assert.equal(error.code, 'CONTROL_DEADLINE_EXCEEDED');
    assert.equal(error.metadataReport.samples.length, 8);
    return true;
  });
  assert.equal(f.state.released, 2);
});

test('driver errors preserve identity, retain the failed attempt and release the connection', async () => {
  const f = fixture();
  const original = Object.assign(new Error('private connection and query values'), { code: '57014' });
  f.state.failure = original;
  await assert.rejects(f.runner.runMetadata({ client: f.pool, revision: f.revision, protocol }), error => {
    assert.equal(error, original);
    assert.equal(error.metadataReport.status, 'FAIL');
    assert.equal(error.metadataReport.samples.length, 1);
    assert.equal(error.metadataReport.samples[0].status, 'FAIL');
    assert.doesNotMatch(JSON.stringify(error.metadataReport), /private|SELECT/);
    return true;
  });
  assert.equal(f.state.released, 1);
});

test('the shared collector still refuses malformed aggregate, malformed legacy and current security drift', async () => {
  for (const [flag, code] of [['malformedAggregate', 'CENTRAL_SCHEMA_SNAPSHOT_INVALID'], ['malformedLegacy', 'CENTRAL_SCHEMA_SNAPSHOT_INVALID'], ['securityDrift', 'CATALOG_SECURITY_DRIFT'], ['noncanonical', undefined]]) {
    const f = fixture(); f.state[flag] = true;
    await assert.rejects(f.runner.runMetadata({ client: f.client, revision: f.revision, protocol }), error => {
      if (code) assert.equal(error.code, code);
      else assert.match(error.message, /UNSUPPORTED_NOT_NULL_CONSTRAINT/);
      assert.equal(error.metadataReport.status, 'FAIL');
      return true;
    });
  }
});

test('nearest rank uses raw values and refuses empty/nonfinite populations', () => {
  const { nearestRank } = fixture().runner;
  assert.equal(nearestRank([9, 1, 2, 4], 0.5), 2);
  assert.equal(nearestRank([0.99994, 1.00001], 0.95), 1.00001);
  assert.equal(nearestRank(Array.from({ length: 100 }, (_, i) => i + 1), 0.95), 95);
  for (const values of [[], [NaN], [Infinity], [-1]]) assert.throws(() => nearestRank(values, 0.95));
});

function driftFixture() {
  const state = { calls: [], mutation: null, held: false, restored: 0, releases: 0, executed: false };
  let unblock;
  const options = { host: '127.0.0.1', port: 54399, database: 'c4g_f13_authority_synthetic_central' };
  const identity = (limited = false) => ({ database: options.database, session_user: limited ? 'c4g_authority_runtime' : 'proof_admin', current_user: limited ? 'c4g_authority_runtime' : 'proof_admin', limited });
  const owner = { options, async query(sql) {
    state.calls.push(sql);
    if (sql.includes('AS database')) return { rows: [identity()] };
    if (sql.includes('pg_stat_activity')) return { rows: [{ n: state.held ? 1 : 0 }] };
    if (sql === 'SELECT pg_advisory_xact_lock(43001306,1)') { state.held = true; return { rows: [] }; }
    if (sql === 'COMMIT') { state.held = false; unblock?.(); return { rows: [] }; }
    if (sql === 'ROLLBACK') {
      if (state.mutation && state.failPostLockRollback) throw Object.assign(new Error('private rollback failure'), { code: 'ROLLBACK_FAILED' });
      state.mutation = null; state.held = false; unblock?.(); state.restored++; return { rows: [] };
    }
    if (/^(ALTER TABLE|GRANT |ALTER ROLE .* INHERIT|ALTER FUNCTION)/.test(sql)) state.mutation = sql;
    if (/^(REVOKE |ALTER ROLE .* NOINHERIT)/.test(sql)) { state.mutation = null; state.restored++; }
    return { rows: [] };
  }, async connect() { return { query: (...args) => owner.query(...args), release() { state.releases++; } }; } };
  const reader = { options, async query(sql) { state.calls.push(sql); return { rows: [identity(true)] }; }, async connect() {
    return { on() {}, removeListener() {}, release() { state.releases++; }, async query(sql) {
      state.calls.push(sql);
      if (sql === 'SELECT pg_backend_pid() AS pid') return { rows: [{ pid: 42 }] };
      if (sql === 'SELECT pg_advisory_xact_lock(43001306,1)' && state.held) await new Promise(resolve => { unblock = resolve; });
      return { rows: [] };
    } };
  } };
  const module = load(path.join(root, 'test/integration/eu-writer-performance/metadata-drift.cjs'), {
    './metadata.cjs': { async checkpointMetadata() {
      if (state.mutation || state.failRevalidation) {
        const code = /assert_eu_writer_permit_v2/.test(state.mutation || '') ? 'EU_WRITER_SECURITY_DRIFT'
          : /funding_run/.test(state.mutation || '') ? 'CATALOG_SECURITY_DRIFT' : 'CENTRAL_SCHEMA_DRIFT';
        throw Object.assign(new Error('private schema details'), { code });
      }
      return { status: 'PASS', fingerprint: 'f'.repeat(64) };
    } },
    '../../../backend/src/security/authorityCoordinator': { createAuthorityCoordinator({ pool }) { return { async withAuthority(callback) {
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_xact_lock(43001306,1)');
        if (state.mutation) throw Object.assign(new Error('private permission details'), { code: 'AUTHORITY_SECURITY_DRIFT' });
        state.executed = true; return callback();
      } finally { client.release(); }
    } }; } }
  });
  return { module, state, args: { ownerPool: owner, readerPool: reader, authorityPool: reader, revision: revisions[1], permitSecret: 'p'.repeat(64),
    ownership: { isolated: true, runId: 'a'.repeat(32), centralDatabase: options.database } } };
}

test('drift entrypoint refuses missing ownership, nonloopback and habitual ports before SQL', async () => {
  for (const change of [a => a.ownership = null, a => a.ownership.runId = 'invalid', a => a.ownerPool.options.host = 'remote.example', a => a.ownerPool.options.port = 5432, a => a.ownership.centralDatabase = 'habitual']) {
    const f = driftFixture(); change(f.args);
    await assert.rejects(f.module.validateMetadataDrift(f.args), { code: 'METADATA_OWNED_FIXTURE_REQUIRED' });
    assert.equal(f.state.calls.length, 0);
  }
});

test('drift proof restores each mutation, observes a blocked real-checkpoint adapter and never runs the protected callback', async () => {
  const f = driftFixture();
  const report = await f.module.validateMetadataDrift(f.args);
  assert.equal(report.status, 'PASS');
  assert.equal(report.transactional.length, 5);
  assert.equal(report.postLock.length, 2);
  assert(report.transactional.every(item => item.restored && item.rejectedVariants.length === 2));
  assert(report.postLock.every(item => item.functionalCallbackExecuted === false && item.restored));
  assert.equal(f.state.executed, false);
  assert.equal(f.state.mutation, null);
  assert(f.state.restored >= 7);
  assert.doesNotMatch(JSON.stringify(report), /private|SELECT|password|permitSecret|postgresql:/);
});

test('a failed restoration cannot produce drift PASS and retains a sanitized report', async () => {
  const f = driftFixture();
  f.args.onProgress = event => { if (event.stage === 'transactional-drift-complete') f.state.failRevalidation = true; };
  await assert.rejects(f.module.validateMetadataDrift(f.args), error => {
    assert.equal(error.metadataDriftReport.status, 'FAIL');
    assert.doesNotMatch(JSON.stringify(error.metadataDriftReport), /private/);
    return true;
  });
  assert.equal(f.state.mutation, null);
});

test('post-lock cleanup attempts the compensating grant restore even if blocker rollback fails', async () => {
  const f = driftFixture();
  f.args.onProgress = event => { if (event.case === 'writer-helper-public-execute') f.state.failPostLockRollback = true; };
  await assert.rejects(f.module.validateMetadataDrift(f.args), error => {
    assert.equal(error.metadataDriftReport.status, 'FAIL');
    assert(error.metadataDriftReport.cleanupErrors.some(item => item.code === 'ROLLBACK_FAILED'));
    return true;
  });
  assert.equal(f.state.mutation, null);
  assert(f.state.calls.includes('REVOKE SELECT ON public.global_user FROM PUBLIC'));
});
