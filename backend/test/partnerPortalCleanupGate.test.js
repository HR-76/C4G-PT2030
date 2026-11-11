'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const capacity = require('../../test/integration/partner-portal/capacityProbe');
const { createTimingHub } = require('../../test/integration/partner-portal/temporalDiagnostic');
const { validProbeEvidence } = require('./support/partnerPortalGateEvidence');

test('real gate closes its environment after pending Central work defers fixture archive and stops capacity', async () => {
  // All infrastructure and file writes are in-memory doubles. The runner and
  // capacity collector execute unchanged; no Docker process or socket exists.
  const events = [], writes = new Map(), calls = [], archived = [];
  const runId = 'a'.repeat(32), imageId = `sha256:${'b'.repeat(64)}`, containerId = 'c'.repeat(64);
  const timing = createTimingHub(), pending = [], completions = []; let active;
  const tenant = { owner: { request: {} }, credentials: { login: 'synthetic_runtime' }, pool: {
    async query(input) {
      if (input.text.includes('pg_stat_database')) return { rows: [{ temp_bytes: '0', stats_reset: null }] };
      assert.ok(input.text.includes('pg_stat_activity')); return { rows: [{ active: 0 }] };
    }
  } };
  const env = { timing, hooks: {}, tenants: [tenant], runtime: { poolManager: {
    snapshot: () => ({ active: 0, queued: 0, credentialDisposalsPending: 0, cleanupFailures: 0 })
  } }, actor: async () => tenant.owner, composition: () => ({ async execute() {
    calls.push(active); env.hooks.onAcquire?.({ ms: 1 });
    await env.hooks.beforeQuery?.({ tenant, sql: 'BEGIN TRANSACTION READ WRITE' });
    await env.hooks.afterQuery?.({ tenant, sql: 'SELECT p.* FROM opportunity_catalog.application_partner p', result: { rows: [] } });
    if (active === 'volume-10000') {
      pending.push(timing.measure('SQL_CENTRAL', () => new Promise(resolve => { completions.push(resolve); })));
      throw Object.assign(new Error('PRIVATE_TIMEOUT_CANARY'), { code: 'LEASE_TIMEOUT' });
    }
    return { items: [], total: 0, nextCursor: null, previousCursor: null };
  } }), async close() {
    events.push('environment-close'); assert.ok(completions.length > 0);
    for (const complete of completions) complete();
    await Promise.all(pending);
  } };
  const runCapacity = capacity.createCapacityProbe({ isPreparedEnvironment: candidate => candidate === env,
    async seedPartners(_tenant, options) {
      active = options.prefix;
      return { prefix: active, async cleanup() { archived.push(options.prefix); } };
    }
  });
  const filename = path.resolve(__dirname, '../../test/integration/partner-portal/gate.js');
  const instance = new Module(filename, module), local = Module.createRequire(filename);
  const source = Buffer.from('synthetic source'), hash = createHash('sha256').update(source).digest('hex');
  const files = Object.fromEntries(['backend/package.json', 'backend/package-lock.json', 'backend/test/support/partnerBrowseContract.js'].map(key => [key, hash]));
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, files }));
  const probes = validProbeEvidence();
  const replacements = {
    'node:fs': { existsSync: () => false, mkdirSync() {}, readFileSync: name => path.basename(name) === 'sources.json' ? manifest : source,
      writeFileSync(name, value) { writes.set(path.basename(name), value); } },
    'node:crypto': { ...require('node:crypto'), randomBytes: size => Buffer.alloc(size, 0xaa) },
    '../../../backend/node_modules/pg': { Client: class {
      async connect() {} async end() {} async query() { return { rows: [{ version: 170000, isolation: 'read committed' }] }; }
    } },
    './environment': { createEnvironment: async () => env },
    './repositoryProbe': { runRepositoryGate: async () => probes.repository },
    './authorityProbe': { runAuthorityGate: async () => probes.authority },
    './capacityProbe': { ...capacity, runCapacityGate: runCapacity }
  };
  instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
  instance.require = name => replacements[name] || local(name);
  instance._compile(fs.readFileSync(filename, 'utf8'), filename);
  const endpoint = process.platform === 'win32' ? 'npipe:////./pipe/synthetic_gate' : 'unix:///synthetic_gate.sock';
  const inspection = { Id: containerId, Name: `/c4g-partner-portal-${runId}`, Image: imageId, State: { Running: true },
    Config: { Labels: { 'c4g.partner-portal.run': runId } }, Mounts: [],
    NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '49199' }] } } };
  async function command(input) {
    const args = input[0] === '--context' ? input.slice(2) : input;
    if (args[0] === 'context' && args[1] === 'show') return 'synthetic';
    if (args[0] === 'context' && args[1] === 'inspect') return JSON.stringify([{ Name: 'synthetic', Endpoints: { docker: { Host: endpoint } } }]);
    if (args[0] === 'info') return 'synthetic-daemon';
    if (args[0] === 'image') return JSON.stringify([{ Id: imageId, Os: 'linux' }]);
    if (args[0] === 'run') return containerId;
    if (args[0] === 'inspect') return JSON.stringify([inspection]);
    if (args[0] === 'exec') return '';
    if (args[0] === 'rm') { assert.deepEqual(args, ['rm', '--force', '--volumes', containerId]); events.push('container-remove'); return ''; }
    if (args[0] === 'container') { events.push('container-absence'); return ''; }
    assert.fail('Unexpected synthetic command');
  }
  const verdict = await instance.exports.executeGate({ scope: 'C4G_PARTNER_PORTAL_DISPOSABLE_V1', imageId }, { command });
  const report = JSON.parse(writes.get('evidence.json'));
  assert.equal(verdict.status, 'FAIL');
  assert.deepEqual(events, ['environment-close', 'container-remove', 'container-absence']);
  assert.deepEqual(report.cleanup, { environmentClosed: true, containerRemoved: true, errors: [] });
  assert.equal(calls.length, 31, 'five completed scenarios then only the first timed warmup');
  assert.equal(calls.at(-1), 'volume-10000');
  assert.deepEqual(archived, ['volume-0', 'volume-25', 'volume-26', 'volume-100', 'volume-101']);
  const refused = report.capacity.warmups.at(-1);
  assert.equal(refused.errorCode, 'LEASE_TIMEOUT');
  assert.equal(refused.temporalDiagnostic.afterCleanup.metrics.SQL_CENTRAL.inflight, 1);
  assert.equal(refused.temporalDiagnostic.status, 'INCOMPLETE');
  assert.ok(report.capacity.observationErrors.some(row => row.code === 'CAPACITY_FIXTURE_ARCHIVE_DEFERRED'));
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_TIMEOUT_CANARY/);
  assert.equal(verdict.integrationAuthorized, false);
  assert.equal(verdict.productionCapacityApproved, false);
});
