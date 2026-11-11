'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, inspectOwnership, evaluateGate, safeEvidence, describePlan, verifySourceManifest, localDockerEndpoint, withDeadline, unsafeInheritedEnvironment } = require('../../test/integration/partner-portal/gate');
const { validProbeEvidence } = require('./support/partnerPortalGateEvidence');
const { CAPACITY_SCENARIOS } = require('../../test/integration/partner-portal/capacityProbe');

const runId = 'a'.repeat(32), imageId = `sha256:${'b'.repeat(64)}`, containerId = 'c'.repeat(64);
function inspection() {
  return { Id: containerId, Name: `/c4g-partner-portal-${runId}`, Image: imageId, State: { Running: true },
    Config: { Labels: { 'c4g.partner-portal.run': runId } }, Mounts: [],
    NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '49199' }] } } };
}
test('PostgreSQL gate defaults to an offline NOT_RUN plan with no execution permission', () => {
  assert.deepEqual(parseArgs([]), { mode: 'plan' }); assert.deepEqual(parseArgs(['--plan']), { mode: 'plan' });
  const plan = describePlan(); assert.equal(plan.status, 'NOT_RUN'); assert.equal(plan.databaseExecuted, false);
  assert.ok(plan.requiredCases.repository.length >= 13); assert.ok(plan.requiredCases.authority.length >= 9);
});
test('execution requires exact scope and immutable image ID; external destinations are not accepted', () => {
  const valid = ['--execute', '--scope', 'C4G_PARTNER_PORTAL_DISPOSABLE_V1', '--image-id', imageId];
  assert.equal(parseArgs(valid).mode, 'execute');
  for (const args of [['--execute'], ['--execute', '--scope', 'wrong', '--image-id', imageId],
    ['--execute', '--scope', 'C4G_PARTNER_PORTAL_DISPOSABLE_V1', '--image-id', 'postgres:17-alpine'],
    [...valid, '--database-url', 'postgresql://localhost/dev'], [...valid, '--plan'], [...valid, '--execute'], ['--unknown']]) {
    assert.throws(() => parseArgs(args));
  }
});
test('ownership proof binds exact ID, label, name, image, loopback mapping and no bind mounts', () => {
  assert.deepEqual(inspectOwnership(inspection(), { runId, imageId, containerId }), { containerId, imageId, runId, host: '127.0.0.1', port: 49199 });
  for (const mutate of [v => { v.Id = 'd'.repeat(64); }, v => { v.Name = '/existing-dev'; },
    v => { v.Config.Labels['c4g.partner-portal.run'] = 'd'.repeat(32); }, v => { v.Image = `sha256:${'e'.repeat(64)}`; },
    v => { v.State.Running = false; }, v => { v.NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0'; },
    v => { v.NetworkSettings.Ports['5432/tcp'][0].HostPort = '5432'; },
    v => { v.NetworkSettings.Ports['5432/tcp'].push({ HostIp: '127.0.0.1', HostPort: '49200' }); },
    v => { v.Mounts = [{ Type: 'bind', Source: 'C:/private' }]; }]) {
    const value = inspection(); mutate(value); assert.throws(() => inspectOwnership(value, { runId, imageId, containerId }));
  }
});
test('cleanup ownership accepts a stopped own container but never ignores identity checks', () => {
  const value = inspection(); value.State.Running = false; value.NetworkSettings.Ports = {};
  assert.equal(inspectOwnership(value, { runId, imageId, containerId, cleanup: true }).containerId, containerId);
  value.Config.Labels['c4g.partner-portal.run'] = 'someone-else';
  assert.throws(() => inspectOwnership(value, { runId, imageId, containerId, cleanup: true }));
});
test('remote Docker contexts cannot reinterpret a remote loopback mapping as a local database', () => {
  assert.equal(localDockerEndpoint('npipe:////./pipe/dockerDesktopLinuxEngine', 'win32'), true);
  assert.equal(localDockerEndpoint('unix:///var/run/docker.sock', 'linux'), true);
  for (const endpoint of ['ssh://host', 'tcp://remote:2376', 'tcp://127.0.0.1:2375', 'npipe:////server/pipe/docker_engine']) {
    assert.equal(localDockerEndpoint(endpoint, 'win32'), false);
  }
  assert.equal(localDockerEndpoint('unix:///var/run/docker.sock', 'win32'), false);
});
test('inherited configuration checks respect Windows case-insensitive environment names', () => {
  for (const key of ['PGHOST', 'pgsslmode', 'docker_host', 'Docker_Context', 'node_options', 'database_url', 'f13_s2_admin_url']) {
    assert.equal(unsafeInheritedEnvironment({ [key]: 'synthetic' }), true);
  }
  assert.equal(unsafeInheritedEnvironment({ PATH: 'synthetic', SystemRoot: 'synthetic', TEMP: 'synthetic' }), false);
});
test('a hung close/probe is bounded so owned-container cleanup can continue', async () => {
  await assert.rejects(withDeadline(new Promise(() => {}), 5, 'ENVIRONMENT_CLOSE_TIMEOUT'), { code: 'ENVIRONMENT_CLOSE_TIMEOUT' });
  assert.equal(await withDeadline(Promise.resolve(42), 100, 'TIMEOUT'), 42);
});
function completeEvidence() {
  const plan = describePlan();
  return { schemaVersion: 1, runId, imageId, containerId, execution: 'POSTGRESQL', sourceVerification: true,
    postgresMajor: 17, isolation: 'read committed',
    repository: { cases: plan.requiredCases.repository.map(id => ({ id, status: 'PASS', evidence: { assertions: 1 } })) },
    authority: { cases: plan.requiredCases.authority.map(id => ({ id, status: 'PASS', evidence: { assertions: 1 } })) },
    capacity: { samples: [], evaluation: { status: 'PASS', productionCapacityApproved: false, failures: [] } },
    cleanup: { environmentClosed: true, containerRemoved: true, errors: [] } };
}
// Synthetic inputs only: exercise the offline verdict's positive control, not
// an assertion that PostgreSQL was executed during these unit tests.
function completeSyntheticVerdictInput() {
  const report = { ...completeEvidence(), ...validProbeEvidence() };
  const sample = (scenario, variant, pair, order) => ({ scenarioId: scenario.id, variant, pair, order,
    candidates: scenario.count, success: scenario.count <= 10000, expectedErrorCode: scenario.count > 10000 ? 'LIMIT_EXCEEDED' : null,
    errorCode: scenario.count > 10000 ? 'LIMIT_EXCEEDED' : null, responseDigest: scenario.count > 10000 ? null : 'a'.repeat(64),
    operationMs: 10, admissionMs: 1, responseBytes: scenario.count > 10000 ? 0 : 100, queryCount: 4,
    authorizationCalls: Math.min(scenario.count, 10000) * 2, rowsRead: Math.min(scenario.count, 10001),
    nodeRssPeakBytes: 100000, nodeHeapPeakBytes: 50000, postgresTempBytes: 0, cleanupMs: 5, afterSuccessQueries: 0 });
  report.capacity = { environmentVerified: true, observationErrors: [],
    samples: CAPACITY_SCENARIOS.flatMap(s => [sample(s, 'before', 1, 1), sample(s, 'after', 1, 2), sample(s, 'after', 2, 1), sample(s, 'before', 2, 2)]),
    warmups: CAPACITY_SCENARIOS.flatMap(s => [sample(s, 'before', 0, 0), sample(s, 'after', 0, 0)]) };
  return report;
}
test('positive control accepts complete consistent evidence without granting integration or production capacity', () => {
  const verdict = evaluateGate(completeSyntheticVerdictInput());
  assert.equal(verdict.status, 'PASS'); assert.equal(verdict.integrationAuthorized, false); assert.equal(verdict.productionCapacityApproved, false);
});
test('claimed PASS with contradictory RLS, unmeasured warmups or changed workload is rejected', () => {
  for (const mutate of [v => { v.repository.cases[0].evidence.sessions[0].foreignRows = 1; },
    v => { v.capacity.warmups[0] = v.capacity.warmups[1]; },
    v => { v.capacity.warmups[0].operationMs = null; },
    v => { v.capacity.samples.find(row => row.scenarioId === 'volume-10000').candidates = 0; },
    v => { v.errorCode = 'RUNTIME_FAILURE'; }]) {
    const value = completeSyntheticVerdictInput(); mutate(value); assert.notEqual(evaluateGate(value).status, 'PASS');
  }
});
test('empty or merely synthetic evidence cannot produce a PostgreSQL PASS', () => {
  for (const value of [{}, { execution: 'SYNTHETIC' }, { execution: 'POSTGRESQL' }]) assert.notEqual(evaluateGate(value).status, 'PASS');
});
test('missing, duplicated, skipped or failed mandatory probes fail closed', () => {
  for (const mutate of [v => { v.repository.cases.pop(); }, v => { v.repository.cases.push(v.repository.cases[0]); },
    v => { v.repository.cases[0].status = 'NOT_RUN'; }, v => { v.authority.cases[0].status = 'FAIL'; },
    v => { v.cleanup.containerRemoved = false; }, v => { v.cleanup.errors.push('CLEANUP_FAILED'); },
    v => { v.sourceVerification = false; }, v => { v.isolation = 'repeatable read'; }, v => { v.postgresMajor = 16; }]) {
    const value = completeEvidence(); mutate(value); assert.notEqual(evaluateGate(value).status, 'PASS');
  }
});
test('stored capacity PASS without actual complete samples is never trusted', () => {
  const evidence = completeEvidence();
  assert.notEqual(evaluateGate(evidence).status, 'PASS');
  assert.equal(evaluateGate(evidence).productionCapacityApproved, false);
});
test('an execution error is retained even if all stored group verdicts say PASS', () => {
  const value = completeEvidence(); value.errorCode = 'POSTGRES_START_TIMEOUT';
  assert.ok(evaluateGate(value).failures.includes('EXECUTION_ERROR'));
});
test('secrets, URLs, tokens and raw SQL are refused before evidence serialization', () => {
  for (const value of [{ password: 'x' }, { nested: { adminUrl: 'postgresql://host/db' } }, { token: 'x' },
    { connectionString: 'x' }, { sql: 'SELECT private' }, { message: 'postgresql://user:secret@host/db' }]) assert.throws(() => safeEvidence(value));
  assert.deepEqual(safeEvidence({ sqlState: '23514', cursorCompatible: true, responseDigest: 'a'.repeat(64) }),
    { sqlState: '23514', cursorCompatible: true, responseDigest: 'a'.repeat(64) });
});
test('source manifest verification rejects missing, changed and added sources', () => {
  const actual = { 'backend/src/a.js': 'a'.repeat(64) };
  assert.equal(verifySourceManifest({ schemaVersion: 1, files: actual }, actual), true);
  for (const manifest of [{}, { schemaVersion: 1, files: {} },
    { schemaVersion: 1, files: { 'backend/src/a.js': 'b'.repeat(64) } },
    { schemaVersion: 1, files: { ...actual, 'backend/src/b.js': 'c'.repeat(64) } }]) assert.throws(() => verifySourceManifest(manifest, actual));
});
