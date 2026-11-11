'use strict';
const {waitForSignal,bounded,deferCleanup,trackServer,listening}=require('./support/networkWait');
const test = require('./support/networkWait').test, assert = require('node:assert/strict'), express = require('express');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const realRoutes = require('./support/historicalDashboardRoutes.cjs');
const {installObserver, validateSources, baselinePath} = require('../../test/integration/dashboard-tenant-cost/observer.cjs');
const org = '00000000-0000-4000-8000-000000000001';

async function harness({failSnapshot, beforeBaseline} = {}) {
  const receivers = [], issued = [], leases = [];
  const client = {async query() {receivers.push(this === client); return {rows: []};}};
  const collect = variant => async function(current) {
    if (variant === 'baseline') await beforeBaseline?.();
    for (let index = 0; index < (variant === 'baseline' ? 3 : 1); index++) {
      await current.query(variant === 'candidate' ? 'SELECT json_agg(security_row) FROM private_catalog_value security_row' : 'SELECT private_catalog_value WHERE value=$1', ['never-record']);
      if (failSnapshot) throw failSnapshot;
    }
    return {data: 'unchanged'};
  };
  const schema = {tenantSchemaSnapshot: collect('candidate'),
    tenantSchemaFingerprint: value => createHash('sha256').update(JSON.stringify(value)).digest('hex')};
  const routes = {...realRoutes}, coordinator = {createAuthorityCoordinator: value => value};
  const leaseModule = {createTenantLeaseExecutor() {const executor = {issue(value) {
    receivers.push(this === executor); const lease = Object.freeze({value}); issued.push(lease); return lease;
  }}; return executor;}};
  const originals = {snapshot: schema.tenantSchemaSnapshot, route: routes.createOrganizationDashboardRouter,
    coordinator: coordinator.createAuthorityCoordinator, lease: leaseModule.createTenantLeaseExecutor};
  const observer = installObserver({schema, routes, coordinator, leaseModule, baselineSnapshot: collect('baseline')});
  const executor = leaseModule.createTenantLeaseExecutor();
  async function work() {
    leases.push(executor.issue({privateIdentity: org}));
    for (let i = 0; i < 6; i++) await schema.tenantSchemaSnapshot(client);
  }
  const report = {organizationId: org, today: '2026-10-31', metrics: realRoutes.emptyMetrics(), states: {},
    deadlines: [], deadlineTotal: 0, unitsAvailable: false, units: []};
  const summary = {total: 0, open: 0, closing_soon: 0, sources: [], recent: []};
  const applications = {async execute(method) {receivers.push(this === applications); await work(); return method === 'report' ? report : {organizationId: org};}};
  const opportunities = {async dashboardSummary() {receivers.push(this === opportunities); await work(); return summary;}};
  const central = {async dashboardSummary() {receivers.push(this === central); return summary;}};
  const pass = (req, res, next) => next(), app = express();
  app.use('/organizations', routes.createOrganizationDashboardRouter({express, applications, opportunities, central, authenticate: pass,
    organizationMiddleware: {requireServerSession: pass, requireOrganizationContext: pass,
      resolveOrganizationContext(req, res, next) {req.organizationContext = {organization: {id: org}}; next();}}}));
  deferCleanup(()=>observer.restore());
  const server = trackServer(app.listen(0, '127.0.0.1'));
  await listening(server);
  return {observer, originals, schema, routes, coordinator, leaseModule, receivers, issued, leases,
    async request(variant) {const response = await fetch(`http://127.0.0.1:${server.address().port}/organizations/${org}/dashboard/summary`,
      {headers: variant ? {'X-C4G-Tenant-Cost-Probe': variant} : {}, signal: AbortSignal.timeout(5000)});
    return {status: response.status, body: await response.json()};},
    async close() {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); observer.restore();}};
}

test('tenant A/B selects frozen baseline per request while preserving eighteen snapshots and three original leases', async () => {
  const f = await harness();
  try {
    const before = await f.request('baseline'), after = await f.request('candidate');
    assert.equal(before.status, 200); assert.deepEqual(before, after);
    const [baseline, candidate] = [...f.observer.records.values()];
    assert.equal(baseline.snapshotCommands, 54); assert.equal(candidate.snapshotCommands, 18);
    assert.deepEqual(baseline.snapshotCommandHistogram, {'3': 18});
    assert.deepEqual(candidate.snapshotCommandHistogram, {'1': 18});
    assert.equal(baseline.snapshotBatches, 0); assert.equal(candidate.snapshotBatches, 18);
    assert.deepEqual(baseline.snapshotBatchHistogram, {'0': 18});
    assert.deepEqual(candidate.snapshotBatchHistogram, {'1': 18});
    for (const record of [baseline, candidate]) {
      assert.equal(record.snapshots, 18); assert.equal(record.leases, 3); assert.equal(record.pendingSnapshots, 0);
      assert.equal(record.snapshotFailures, 0); assert.equal(record.disconnected, false);
      for (const stage of ['report', 'privateSummary', 'dashboardContext']) {
        assert.equal(record.stages[stage].leases, 1); assert.equal(record.stages[stage].snapshots, 6);
      }
    }
    assert.deepEqual(baseline.fingerprints, candidate.fingerprints);
    assert.ok(f.receivers.every(Boolean));
    f.leases.forEach((lease, index) => assert.equal(lease, f.issued[index]));
    assert.doesNotMatch(JSON.stringify([...f.observer.records.values()]), /SELECT|private_catalog|never-record|00000000/);
  } finally {await f.close();}
});

test('snapshot source guards reject changed baseline, unapproved candidate and unknown mode', () => {
  const baseline = fs.readFileSync(baselinePath);
  assert.equal(validateSources(baseline, baseline, 'profile').baselineSha256,
    createHash('sha256').update(baseline).digest('hex'));
  assert.throws(() => validateSources(Buffer.concat([baseline, Buffer.from('\n')]), baseline, 'profile'), /BASELINE_HASH_MISMATCH/);
  assert.throws(() => validateSources(baseline, Buffer.from('unapproved collector'), 'compare'), /CANDIDATE_SOURCE_MISMATCH/);
  assert.throws(() => validateSources(baseline, baseline, 'unknown'), /MODE_INVALID/);
});

test('failed observer installation restores every export and permits a later clean installation', () => {
  const schema = {tenantSchemaSnapshot() {}}, routes = {createOrganizationDashboardRouter() {}},
    coordinator = {createAuthorityCoordinator() {}}, leaseModule = {createTenantLeaseExecutor() {}};
  const originals = [schema.tenantSchemaSnapshot, routes.createOrganizationDashboardRouter,
    coordinator.createAuthorityCoordinator, leaseModule.createTenantLeaseExecutor];
  const dependencies = {schema, routes, coordinator, leaseModule};
  assert.throws(() => installObserver({...dependencies, baselineSnapshot: null}), /BASELINE_REQUIRED/);
  assert.deepEqual([schema.tenantSchemaSnapshot, routes.createOrganizationDashboardRouter,
    coordinator.createAuthorityCoordinator, leaseModule.createTenantLeaseExecutor], originals);
  const observer = installObserver({...dependencies, baselineSnapshot() {}});
  observer.restore();
  assert.deepEqual([schema.tenantSchemaSnapshot, routes.createOrganizationDashboardRouter,
    coordinator.createAuthorityCoordinator, leaseModule.createTenantLeaseExecutor], originals);
});

test('tenant observer preserves failures and restores all factories without changing unlabelled requests', async () => {
  const f = await harness();
  try {
    assert.equal((await f.request()).status, 200); assert.equal(f.observer.records.size, 0);
    assert.throws(() => installObserver({}), /ALREADY_INSTALLED/);
    f.observer.restore(); f.observer.restore();
    assert.equal(f.schema.tenantSchemaSnapshot, f.originals.snapshot);
    assert.equal(f.routes.createOrganizationDashboardRouter, f.originals.route);
    assert.equal(f.coordinator.createAuthorityCoordinator, f.originals.coordinator);
    assert.equal(f.leaseModule.createTenantLeaseExecutor, f.originals.lease);
    assert.equal((await f.request('baseline')).status, 200); assert.equal(f.observer.records.size, 0);
  } finally {await f.close();}
  const failed = await harness({failSnapshot: Object.assign(Error('private details'), {code: 'SERVICE_UNAVAILABLE'})});
  try {
    assert.equal((await failed.request('baseline')).status, 503);
    const record = [...failed.observer.records.values()][0];
    assert.equal(record.snapshots, 1); assert.equal(record.snapshotFailures, 1); assert.equal(record.pendingSnapshots, 0);
    assert.deepEqual(record.fingerprints, {}); assert.equal(record.stages.report.failures, 1);
    assert.doesNotMatch(JSON.stringify(record), /private details/);
  } finally {await failed.close();}
});

test('overlapping tenant variants preserve separate snapshot commands and fingerprints', async () => {
  let release, entered, first = true;
  const gate = new Promise(resolve => {release = resolve;}), entry = new Promise(resolve => {entered = resolve;});
  const f = await harness({async beforeBaseline() {if (first) {first = false; entered(); await gate;}}});
  let pending;
  try {
    pending = f.request('baseline'); await waitForSignal(entry,pending,'HTTP handler entry');
    assert.equal((await f.request('candidate')).status, 200);
    assert.equal(f.observer.records.get(1).snapshotCommands, 0); assert.equal(f.observer.records.get(2).snapshotCommands, 18);
    release(); assert.equal((await pending).status, 200);
    assert.equal(f.observer.records.get(1).snapshotCommands, 54);
    assert.deepEqual(f.observer.records.get(1).fingerprints, f.observer.records.get(2).fingerprints);
  } finally {release(); await bounded(pending?.catch(() => {}),'pending request cleanup'); await f.close();}
});
