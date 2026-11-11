'use strict';
const {waitForSignal,bounded,deferCleanup,trackServer,listening}=require('./support/networkWait');
const test = require('./support/networkWait').test, assert = require('node:assert/strict'), express = require('express');
const schema = require('../src/security/tenantSchemaFingerprint');
const routes = require('./support/historicalDashboardRoutes.cjs');
const {install} = require('../../test/integration/dashboard-loading/observer.cjs');
const legacy = require('./support/tenantSchemaLegacyQueries.json');
const normalize = sql => sql.replace(/\s+/g, ' ').trim();
const org = '00000000-0000-4000-8000-000000000001';
const keys = Object.keys(legacy.base);
const canonicalConstraints = normalize(legacy.base.constraints)
  .replace(' ELSE pg_catalog.pg_get_constraintdef', " WHEN con.contype='n' AND NOT con.condeferrable AND NOT con.condeferred " +
    'AND array_ndims(con.conkey)=1 AND array_lower(con.conkey,1)=1 AND array_length(con.conkey,1)=1 ' +
    "AND nn.attnum>0 AND NOT nn.attisdropped THEN 'NOT NULL '||pg_catalog.quote_ident(nn.attname) ELSE pg_catalog.pg_get_constraintdef")
  .replace(' WHERE n.nspname', " LEFT JOIN pg_catalog.pg_attribute nn ON con.contype='n' AND nn.attrelid = con.conrelid AND nn.attnum = con.conkey[1] WHERE n.nspname");
const projections = {legacy: legacy.base, 'canonical-not-null': {...legacy.base, constraints: canonicalConstraints}};
const aggregate = projection => 'SELECT ' + keys.map(field =>
  `(SELECT COALESCE(json_agg(catalog_row), '[]'::json) FROM (${normalize(projections[projection][field])}) AS catalog_row) AS "${field}"`
).join(', ');

const catalog = () => ({...Object.fromEntries(keys.map(key => [key, []])),
  tables: [{schema_name: 'organizational_scope', table_name: 'scope', relation_kind: 'r', owner_name: 'synthetic_owner'}]});

async function harness({failStage, queryError, beforeReport} = {}) {
  const observer = install({routes}), snapshot = schema.tenantSchemaSnapshot, calls = [], receivers = [];
  const client = {async query(sql, values) {
    assert.equal(this, client); calls.push({sql, values});
    if (queryError) throw queryError;
    if (sql.includes('json_agg(catalog_row)')) return {rows: [catalog()]};
    const field = keys.find(key => Object.values(projections).some(projection => normalize(projection[key]) === normalize(sql)));
    if (field) return {rows: catalog()[field]};
    if (sql.includes('json_agg(security_row)')) {
      const parts = [...sql.matchAll(/FROM \((SELECT[\s\S]*?)\) AS security_row\) AS "([^"]+)"/g)];
      assert.equal(parts.length, 4);
      for (const [index, part] of parts.entries()) {
        const original = normalize(legacy.security[index]);
        const expected = index === 1 ? original.replace("ORDER BY COALESCE(r.rolname,'PUBLIC')) AS roles", "ORDER BY COALESCE(r.rolname,'PUBLIC'))::text AS roles") : original;
        assert.equal(normalize(part[1]), expected);
      }
      return {rows: [Object.fromEntries(parts.map(part => [part[2], [{synthetic: 'unchanged security'}]]))]};
    }
    assert.ok(legacy.security.some(query => normalize(query) === normalize(sql)));
    return {rows: [{synthetic: 'unchanged security'}]};
  }};
  const metrics = routes.emptyMetrics(), report = {organizationId: org, today: '2026-10-29', metrics,
    states: {}, deadlines: [], deadlineTotal: 0, unitsAvailable: false, units: []};
  const summary = {total: 0, open: 0, closing_soon: 0, sources: [], recent: []};
  const applications = {async execute(method) {
    receivers.push(this === applications);
    if (method === 'report' && beforeReport) await beforeReport();
    await snapshot(client);
    if (failStage === method) throw Object.assign(Error('private payload'), {code: 'SERVICE_UNAVAILABLE'});
    return method === 'report' ? report : {organizationId: org};
  }};
  const opportunities = {async dashboardSummary() {
    receivers.push(this === opportunities); await snapshot(client); return summary;
  }};
  const central = {async dashboardSummary() {receivers.push(this === central); return summary;}};
  const pass = (req, res, next) => next(), app = express();
  app.use('/organizations', routes.createOrganizationDashboardRouter({express, applications, opportunities, central,
    authenticate: pass, organizationMiddleware: {requireServerSession: pass, requireOrganizationContext: pass,
      resolveOrganizationContext(req, res, next) {req.organizationContext = {organization: {id: org}}; next();}}}));
  deferCleanup(()=>observer.restore());
  const server = trackServer(app.listen(0, '127.0.0.1'));
  await listening(server);
  return {observer, client, calls, receivers, url: `http://127.0.0.1:${server.address().port}/organizations/${org}/dashboard/summary`,
    async close() {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); observer.restore();}};
}

test('A/B observer reconstructs seven statements on the same client and keeps real collector fingerprints/security', async () => {
  const f = await harness();
  try {
    const before = await fetch(f.url, {headers: {'X-C4G-Dashboard-Probe': 'baseline'}});
    assert.equal(before.status, 200); const baselineBody = await before.json();
    const baseline = [...f.observer.records.values()][0];
    assert.equal(baseline.snapshots, 3); assert.equal(baseline.baseCommands, 21); assert.equal(baseline.securityCommands, 3);
    assert.equal(f.calls.filter(call => call.sql.includes('json_agg(catalog_row)')).length, 0);
    for (let index = 0; index < 7; index++) {
      assert.equal(f.calls[index].sql, projections['canonical-not-null'][keys[index]]);
      assert.deepEqual(f.calls[index].values, [schema.TENANT_SCHEMAS]);
    }
    const after = await fetch(f.url, {headers: {'X-C4G-Dashboard-Probe': 'candidate'}});
    assert.equal(after.status, 200); assert.deepEqual(await after.json(), baselineBody);
    const candidate = [...f.observer.records.values()][1];
    assert.equal(candidate.snapshots, 3); assert.equal(candidate.baseCommands, 3); assert.equal(candidate.securityCommands, 3);
    assert.deepEqual(candidate.fingerprints, baseline.fingerprints);
    assert.equal(Object.values(candidate.fingerprints).reduce((sum, count) => sum + count, 0), 3);
    assert.equal(f.calls.filter(call => call.sql.includes('json_agg(catalog_row)')).length, 3);
    for (const record of [baseline, candidate]) {
      assert.equal(record.status, 200); assert.equal(record.disconnected, false); assert.equal(record.pendingSnapshots, 0);
      assert.equal(record.snapshotFailures, 0); assert.ok(record.httpMs >= 0);
      assert.deepEqual(Object.keys(record.stages), ['report', 'privateSummary', 'centralSummary', 'dashboardContext']);
      assert.ok(Object.values(record.stages).every(stage => stage.calls === 1 && stage.failures === 0 && stage.ms >= 0));
    }
    assert.ok(f.receivers.every(Boolean));
    assert.doesNotMatch(JSON.stringify([...f.observer.records.values()]), /SELECT|synthetic_owner|unchanged security|00000000/);
  } finally {await f.close();}
});

test('unlabelled/unknown requests run the normal candidate without observation and restore reinstates exports', async () => {
  const originalSnapshot = schema.tenantSchemaSnapshot, originalFactory = routes.createOrganizationDashboardRouter;
  const f = await harness();
  try {
    for (const variant of [null, 'not-a-variant']) {
      const response = await fetch(f.url, variant ? {headers: {'X-C4G-Dashboard-Probe': variant}} : {});
      assert.equal(response.status, 200); await response.arrayBuffer();
    }
    assert.equal(f.observer.records.size, 0);
    assert.equal(f.calls.filter(call => call.sql.includes('json_agg(catalog_row)')).length, 6);
    f.observer.restore();
    assert.equal(schema.tenantSchemaSnapshot, originalSnapshot); assert.equal(routes.createOrganizationDashboardRouter, originalFactory);
    const response = await fetch(f.url, {headers: {'X-C4G-Dashboard-Probe': 'baseline'}});
    assert.equal(response.status, 200); await response.arrayBuffer();
    assert.equal(f.observer.records.size, 0);
  } finally {await f.close();}
});

test('source errors retain route behavior and safe failure telemetry without partial results', async () => {
  const f = await harness({failStage: 'report'});
  try {
    const response = await fetch(f.url, {headers: {'X-C4G-Dashboard-Probe': 'baseline'}});
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), {error: {code: 'SERVICE_UNAVAILABLE'}});
    const record = [...f.observer.records.values()][0];
    assert.equal(record.baseCommands, 7); assert.equal(record.stages.report.failures, 1); assert.equal(record.pendingSnapshots, 0);
    assert.deepEqual(Object.keys(record.stages), ['report']); assert.doesNotMatch(JSON.stringify(record), /private payload/);
  } finally {await f.close();}
});

test('query failures stop the baseline sequence, retain failure and never return a fabricated fingerprint', async () => {
  const error = Object.assign(Error('never log these parameters'), {code: '57014'}), f = await harness({queryError: error});
  try {
    const response = await fetch(f.url, {headers: {'X-C4G-Dashboard-Probe': 'baseline'}});
    assert.equal(response.status, 503); await response.arrayBuffer();
    const record = [...f.observer.records.values()][0];
    assert.equal(f.calls.length, 1); assert.equal(record.baseCommands, 1); assert.equal(record.snapshotFailures, 1);
    assert.equal(record.pendingSnapshots, 0); assert.deepEqual(record.fingerprints, {});
    assert.doesNotMatch(JSON.stringify(record), /parameters|57014/);
  } finally {await f.close();}
});

test('observer refuses duplicate installation and fresh snapshots outside labelled requests remain unwrapped', async () => {
  const observer = install({routes}), client = {async query(sql) {assert.equal(this, client); return {rows: [Object.fromEntries(keys.map(key => [key, []]))]};}};
  try {
    assert.throws(() => install({routes}), /DASHBOARD_OBSERVER_ALREADY_INSTALLED/);
    await schema.tenantSchemaSnapshot(client);
    assert.equal(observer.records.size, 0);
  } finally {observer.restore(); observer.restore();}
});

test('overlapping HTTP requests retain separate A/B context and counters', async () => {
  let release, entered, reports = 0;
  const gate = new Promise(resolve => {release = resolve;}), entry = new Promise(resolve => {entered = resolve;});
  const f = await harness({async beforeReport() {if (++reports === 1) {entered(); await gate;}}});
  let first;
  try {
    first = fetch(f.url, {headers: {'X-C4G-Dashboard-Probe': 'baseline'}, signal: AbortSignal.timeout(5000)});
    await waitForSignal(entry,first,'HTTP handler entry');
    const second = await fetch(f.url, {headers: {'X-C4G-Dashboard-Probe': 'candidate'}, signal: AbortSignal.timeout(5000)});
    assert.equal(second.status, 200); await second.arrayBuffer();
    assert.equal(f.observer.records.get(1).baseCommands, 0);
    assert.equal(f.observer.records.get(2).baseCommands, 3);
    release(); const response = await first; assert.equal(response.status, 200); await response.arrayBuffer();
    assert.equal(f.observer.records.get(1).baseCommands, 21);
    assert.deepEqual(f.observer.records.get(1).fingerprints, f.observer.records.get(2).fingerprints);
  } finally {release(); await bounded(first?.catch(() => {}),'pending request cleanup'); await f.close();}
});

test('an unrecognized collector query fails before contacting the client in either variant', async () => {
  const original = schema.tenantSchemaSnapshot;
  schema.tenantSchemaSnapshot = client => client.query('SELECT unknown_changed_collector', [schema.TENANT_SCHEMAS]);
  let f;
  try {
    f = await harness();
    for (const variant of ['baseline', 'candidate']) {
      const response = await fetch(f.url, {headers: {'X-C4G-Dashboard-Probe': variant}});
      assert.equal(response.status, 503); await response.arrayBuffer();
    }
    assert.equal(f.calls.length, 0);
    for (const record of f.observer.records.values()) {
      assert.equal(record.snapshotFailures, 1); assert.equal(record.baseCommands, 0);
      assert.equal(record.pendingSnapshots, 0); assert.deepEqual(record.fingerprints, {});
    }
  } finally {await f?.close(); schema.tenantSchemaSnapshot = original;}
});


test('both exact SQL projections reconstruct their own seven constituents without changing the other six', async () => {
  const original = schema.tenantSchemaSnapshot;
  try {
    for (const projection of ['legacy', 'canonical-not-null']) {
      // Exercise the previous SQL projection through the same real collector;
      // only the exact first query changes, never its security reads/decoder.
      if (projection === 'legacy') schema.tenantSchemaSnapshot = function(client) {
        return original.call(this, new Proxy(client, {get(target, key) {
          if (key === 'query') return (sql, values) => {
            if (sql.includes('json_agg(catalog_row)')) {
              assert.equal(normalize(sql), aggregate('canonical-not-null'));
              return target.query.call(target, aggregate('legacy'), values);
            }
            return target.query.call(target, sql, values);
          };
          return Reflect.get(target, key, target);
        }}));
      };
      else schema.tenantSchemaSnapshot = original;
      const f = await harness();
      try {
        for (const variant of ['baseline', 'candidate']) {
          const response = await fetch(f.url, {headers: {'X-C4G-Dashboard-Probe': variant}});
          assert.equal(response.status, 200); await response.arrayBuffer();
        }
        for (const [index, field] of keys.entries()) {
          assert.equal(f.calls[index].sql, projections[projection][field]);
          if (field !== 'constraints') assert.equal(f.calls[index].sql, legacy.base[field]);
        }
        const aggregated = f.calls.filter(call => call.sql.includes('json_agg(catalog_row)'));
        assert.equal(aggregated.length, 3);
        for (const call of aggregated) assert.equal(normalize(call.sql), aggregate(projection));
        const [baseline, candidate] = [...f.observer.records.values()];
        assert.deepEqual(candidate.fingerprints, baseline.fingerprints);
        for (const record of [baseline, candidate]) assert.deepEqual(record.projections, {[projection]: 3});
      } finally {await f.close();}
    }
  } finally {schema.tenantSchemaSnapshot = original;}
});

test('known projections with changed schema arguments or a weakened guard remain fail-closed', async () => {
  const original = schema.tenantSchemaSnapshot;
  try {
    for (const [sql, values] of [
      [aggregate('legacy'), []],
      [aggregate('canonical-not-null'), [['unapproved_schema']]],
      [aggregate('canonical-not-null').replace('AND NOT nn.attisdropped ', ''), [schema.TENANT_SCHEMAS]],
    ]) {
      schema.tenantSchemaSnapshot = client => client.query(sql, values);
      const f = await harness();
      try {
        for (const variant of ['baseline', 'candidate']) {
          const response = await fetch(f.url, {headers: {'X-C4G-Dashboard-Probe': variant}});
          assert.equal(response.status, 503); await response.arrayBuffer();
        }
        assert.equal(f.calls.length, 0);
        for (const record of f.observer.records.values()) assert.deepEqual(record.fingerprints, {});
      } finally {await f.close();}
    }
  } finally {schema.tenantSchemaSnapshot = original;}
});
