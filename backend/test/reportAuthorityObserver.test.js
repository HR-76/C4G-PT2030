'use strict';
const {waitForSignal,bounded,deferCleanup,trackServer,listening}=require('./support/networkWait');
const test = require('./support/networkWait').test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createHash} = require('node:crypto');
const express = require('express');
const realRoutes = require('./support/historicalDashboardRoutes.cjs');
const {installObserver, validateSources, baselinePath, originalBaselinePath} = require('../../test/integration/dashboard-report-authority/observer.cjs');
const org = '00000000-0000-4000-8000-000000000001';
const probeHeader = 'X-C4G-Report-Authority-Probe';

async function harness({failQuery, beforeReport, extraMethods = false, admission = false} = {}) {
  const calls = [], clients = [], receivers = [], snapshots = [];
  const schema = {async tenantSchemaSnapshot(client) {snapshots.push(client); return {safeShape: 'unchanged'};},
    tenantSchemaFingerprint: value => createHash('sha256').update(JSON.stringify(value)).digest('hex')};
  const routes = {...realRoutes};
  const coordinator = {createAuthorityCoordinator({pool}) {
    return {async run(groups) {
      for (let group = 0; group < groups; group++) {
        const client = await pool.connect();
        try {
          if (admission) {
            await client.query('BEGIN TRANSACTION READ ONLY');
            await client.query('SELECT 1');
            await client.query('COMMIT');
          }
          await client.query('BEGIN');
          await client.query('SELECT private_data WHERE value = $1', ['never-record-parameters']);
          await client.query('COMMIT');
        } finally {client.release();}
      }
    }};
  }};
  const pool = {query() {}, async connect() {
    assert.equal(this, pool);
    const client = {released: false, async query(sql, values) {
      assert.equal(this, client);
      if (failQuery && sql.startsWith('SELECT')) throw failQuery;
      return {rows: []};
    }, release() {assert.equal(this, client); client.released = true;}};
    clients.push(client); return client;
  }};
  const metrics = realRoutes.emptyMetrics();
  const report = {organizationId: org, today: '2026-10-31', metrics, states: {}, deadlines: [], deadlineTotal: 0,
    unitsAvailable: false, units: [], items: []};
  const summary = {total: 0, open: 0, closing_soon: 0, sources: [], recent: []};
  function factory(variant) {
    return function(options) {
      const port = {async execute(method) {
        receivers.push(this === port); calls.push({variant, method});
        if (method === 'report' && beforeReport) await beforeReport(variant);
        await options.coordinator.run(method === 'report' ? (variant === 'baseline' ? 4 : 2) : 1);
        await schema.tenantSchemaSnapshot(options.snapshotClient);
        return method === 'report' ? report : {organizationId: org};
      }};
      return Object.freeze(port);
    };
  }
  const composition = {createApplicationComposition: factory('candidate')};
  const originals = {snapshot: schema.tenantSchemaSnapshot, coordinator: coordinator.createAuthorityCoordinator,
    route: routes.createOrganizationDashboardRouter, composition: composition.createApplicationComposition};
  const observer = installObserver({schema, routes, coordinator,
    loadCompositions: () => ({composition, baselineFactory: factory('baseline')})});
  const authority = coordinator.createAuthorityCoordinator({pool});
  const snapshotClient = {}, applications = composition.createApplicationComposition({coordinator: authority, snapshotClient});
  const opportunities = {async dashboardSummary() {
    receivers.push(this === opportunities);
    if (extraMethods) {await applications.execute('partnersBrowse'); await applications.execute('reportExport');}
    await authority.run(1); await schema.tenantSchemaSnapshot(snapshotClient); return summary;
  }};
  const central = {async dashboardSummary() {receivers.push(this === central); return summary;}};
  const pass = (req, res, next) => next(), app = express();
  app.use('/organizations', routes.createOrganizationDashboardRouter({express, applications, opportunities, central,
    authenticate: pass, organizationMiddleware: {requireServerSession: pass, requireOrganizationContext: pass,
      resolveOrganizationContext(req, res, next) {req.organizationContext = {organization: {id: org}}; next();}}}));
  deferCleanup(()=>observer.restore());
  const server = trackServer(app.listen(0, '127.0.0.1'));
  await listening(server);
  return {observer, schema, routes, coordinator, composition, originals, applications, calls, clients, snapshots, receivers,
    async request(variant) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/organizations/${org}/dashboard/summary`,
        {headers: variant ? {[probeHeader]: variant} : {}, signal: AbortSignal.timeout(10000)});
      return {status: response.status, body: await response.json()};
    }, async close() {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); observer.restore();}};
}

test('shared baseline source is pinned and only the exact report grouping delta is accepted', () => {
  const before = fs.readFileSync(baselinePath);
  const candidate = Buffer.from(before.toString('utf8').replace("scope.getStore()?.method==='partnersBrowse'",
    "['partnersBrowse','report'].includes(scope.getStore()?.method)"));
  const proof = validateSources(before, candidate);
  assert.equal(proof.baselineSha256, createHash('sha256').update(before).digest('hex'));
  assert.notEqual(proof.candidateSha256, proof.baselineSha256);
  assert.equal(proof.sharedBaseline, true);
  assert.equal(proof.originalBaselineSha256, createHash('sha256').update(fs.readFileSync(originalBaselinePath)).digest('hex'));
  assert.throws(() => validateSources(Buffer.concat([before, Buffer.from('\n')]), candidate), /BASELINE_HASH_MISMATCH/);
  assert.throws(() => validateSources(before, before), /CANDIDATE_SOURCE_MISMATCH/);
  assert.throws(() => validateSources(before, Buffer.concat([candidate, Buffer.from('\n')])), /CANDIDATE_SOURCE_MISMATCH/);
});

test('observer selects exact baseline only for report and counts central transactions and stages', async () => {
  const f = await harness({extraMethods: true});
  try {
    const before = await f.request('baseline'), after = await f.request('candidate');
    assert.equal(before.status, 200); assert.deepEqual(after, before);
    const [baseline, candidate] = [...f.observer.records.values()];
    assert.equal(baseline.baselineReports, 1); assert.equal(baseline.candidateReports, 0);
    assert.equal(candidate.baselineReports, 0); assert.equal(candidate.candidateReports, 1);
    assert.equal(baseline.centralAuthority.authorityBegins - candidate.centralAuthority.authorityBegins, 2);
    assert.equal(baseline.stages.report.centralAuthority.authorityBegins, 4);
    assert.equal(candidate.stages.report.centralAuthority.authorityBegins, 2);
    assert.deepEqual(baseline.stages.privateSummary.centralAuthority, candidate.stages.privateSummary.centralAuthority);
    for (const record of [baseline, candidate]) {
      assert.equal(record.centralAuthority.commits, record.centralAuthority.physicalBegins);
      assert.equal(record.centralAuthority.connections, record.centralAuthority.authorityBegins);
      assert.equal(record.centralAuthority.queryFailures, 0);
      assert.equal(record.status, 200); assert.equal(record.disconnected, false);
      assert.equal(record.snapshots, 5); assert.equal(record.pendingSnapshots, 0); assert.equal(record.snapshotFailures, 0);
      assert.deepEqual(Object.keys(record.stages), ['report', 'privateSummary', 'centralSummary', 'dashboardContext']);
      assert.ok(Object.values(record.stages).every(stage => stage.calls === 1 && stage.failures === 0 && stage.ms >= 0));
    }
    assert.deepEqual(candidate.fingerprints, baseline.fingerprints);
    assert.deepEqual(f.calls.filter(call => call.variant === 'baseline'), [{variant: 'baseline', method: 'report'}]);
    assert.ok(f.receivers.every(Boolean)); assert.ok(f.clients.every(client => client.released));
    assert.doesNotMatch(JSON.stringify([...f.observer.records.values()]), /SELECT|private_data|never-record|00000000/);
  } finally {await f.close();}
});

test('unknown/unlabelled/outside requests keep the candidate and produce no telemetry', async () => {
  const f = await harness();
  try {
    for (const variant of [null, 'unknown']) assert.equal((await f.request(variant)).status, 200);
    await f.applications.execute('report');
    assert.equal(f.observer.records.size, 0);
    assert.ok(f.calls.every(call => call.variant === 'candidate'));
  } finally {await f.close();}
});

test('central admission transactions count separately from protected authority transactions', async () => {
  const f = await harness({admission: true});
  try {
    assert.equal((await f.request('baseline')).status, 200);
    assert.equal((await f.request('candidate')).status, 200);
    const [baseline, candidate] = [...f.observer.records.values()];
    assert.equal(baseline.centralAuthority.commits, baseline.centralAuthority.physicalBegins,
      'admission BEGIN must be counted with its COMMIT');
    assert.equal(baseline.centralAuthority.physicalBegins, 12);
    assert.equal(baseline.centralAuthority.authorityBegins, 6);
    assert.equal(candidate.centralAuthority.physicalBegins, 8);
    assert.equal(candidate.centralAuthority.authorityBegins, 4);
    for (const record of [baseline, candidate]) {
      assert.equal(record.centralAuthority.commits, record.centralAuthority.physicalBegins);
      assert.equal(record.centralAuthority.connections, record.centralAuthority.authorityBegins);
      assert.equal(record.centralAuthority.queryFailures, 0);
    }
    assert.equal(baseline.stages.report.centralAuthority.physicalBegins - candidate.stages.report.centralAuthority.physicalBegins, 4);
    assert.equal(baseline.stages.report.centralAuthority.authorityBegins - candidate.stages.report.centralAuthority.authorityBegins, 2);
  } finally {await f.close();}
});

test('restoration is idempotent, reinstates exports and disables old wrappers', async () => {
  const f = await harness();
  try {
    f.observer.restore(); f.observer.restore();
    assert.equal(f.schema.tenantSchemaSnapshot, f.originals.snapshot);
    assert.equal(f.coordinator.createAuthorityCoordinator, f.originals.coordinator);
    assert.equal(f.routes.createOrganizationDashboardRouter, f.originals.route);
    assert.equal(f.composition.createApplicationComposition, f.originals.composition);
    assert.equal((await f.request('baseline')).status, 200);
    assert.equal(f.observer.records.size, 0); assert.ok(f.calls.every(call => call.variant === 'candidate'));
  } finally {await f.close();}
});

test('duplicate installation is rejected without changing existing observation', async () => {
  const f = await harness();
  try {
    assert.throws(() => installObserver({}), /ALREADY_INSTALLED/);
    assert.equal((await f.request('candidate')).status, 200);
    assert.equal(f.observer.records.size, 1);
  } finally {await f.close();}
});

test('query failures propagate unchanged and safe telemetry contains no values', async () => {
  const error = Object.assign(Error('private database response must never be logged'), {code: 'SERVICE_UNAVAILABLE'});
  const f = await harness({failQuery: error});
  try {
    await assert.rejects(f.applications.execute('report'), caught => caught === error);
    const response = await f.request('baseline');
    assert.equal(response.status, 503);
    const record = [...f.observer.records.values()][0];
    assert.equal(record.stages.report.failures, 1); assert.equal(record.centralAuthority.queryFailures, 1);
    assert.equal(record.centralAuthority.physicalBegins, 1); assert.equal(record.centralAuthority.commits, 0);
    assert.equal(record.pendingSnapshots, 0); assert.equal(record.snapshots, 0);
    assert.deepEqual(Object.keys(record.stages), ['report']);
    assert.doesNotMatch(JSON.stringify(record), /private database|SELECT|never-record/);
    assert.ok(f.clients.every(client => client.released));
  } finally {await f.close();}
});

test('overlapping requests isolate variant, stages and transaction counters', async () => {
  let release, entered;
  const gate = new Promise(resolve => {release = resolve;}), entry = new Promise(resolve => {entered = resolve;});
  const f = await harness({async beforeReport(variant) {if (variant === 'baseline') {entered(); await gate;}}});
  let pending;
  try {
    pending = f.request('baseline'); await waitForSignal(entry,pending,'HTTP handler entry');
    assert.equal((await f.request('candidate')).status, 200);
    assert.equal(f.observer.records.get(1).centralAuthority.authorityBegins, 0);
    assert.equal(f.observer.records.get(2).centralAuthority.authorityBegins, 4);
    release(); assert.equal((await pending).status, 200);
    assert.equal(f.observer.records.get(1).centralAuthority.authorityBegins, 6);
    assert.deepEqual(f.observer.records.get(1).fingerprints, f.observer.records.get(2).fingerprints);
  } finally {release(); await bounded(pending?.catch(() => {}),'pending request cleanup'); await f.close();}
});

test('partial installation failure restores every previously patched export', () => {
  const schema = {tenantSchemaSnapshot() {}}, routes = {createOrganizationDashboardRouter() {}},
    coordinator = {createAuthorityCoordinator() {}};
  const before = {schema: schema.tenantSchemaSnapshot, routes: routes.createOrganizationDashboardRouter,
    coordinator: coordinator.createAuthorityCoordinator};
  const failure = Error('load failed');
  assert.throws(() => installObserver({schema, routes, coordinator, loadCompositions() {throw failure;}}), error => error === failure);
  assert.equal(schema.tenantSchemaSnapshot, before.schema);
  assert.equal(routes.createOrganizationDashboardRouter, before.routes);
  assert.equal(coordinator.createAuthorityCoordinator, before.coordinator);
});
