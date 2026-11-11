'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const script = require('../../scripts/opportunity-v2-approve.cjs');
const { contentDigestV2 } = require('../src/opportunities/v2/digests');
const { rawSnapshotDigest } = require('../src/opportunities/v2/reconciliation');
const { implementationDigest } = require('../src/opportunities/v2/activationArchive');
const pkg = require('../src/security/opportunityV2MigrationPackage');
const snapshot = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../context/references/opportunity-v2/examples/eu-11145-v2.1.json')));
const clone = value => structuredClone(value);
function fixture() {
  const now = Date.now(), expected = { opportunityId: randomUUID(), revisionId: randomUUID(), rowVersion: 4 };
  const window = { kind: 'opportunity11145habitualwindow-v1', windowId: randomUUID(), packageDigest: pkg.packageDigest,
    result: 'PASS', completedAt: new Date(now - 1000).toISOString(), expected,
    source: { source: 'EU_FUNDING_TENDERS', externalIdentifier: 'CASCADE:11145', contentDigest: contentDigestV2(snapshot), mappingDigest: implementationDigest('EU_FUNDING_TENDERS', snapshot.provenance.mappingVersion) },
    acceptedBinding: { snapshotDigest: 'a'.repeat(64), protectedStateDigest: 'b'.repeat(64) },
    installed: { centralVersion: '042_opportunity_eu_source_control_v2', tenantVersion: '034_application_snapshot_v2' },
    backup: { backupId: 'opportunity-v2-backup-' + randomUUID(), result: 'PASS', noSourceDrift: true }, resume: { health: true } };
  const collected = { runId: randomUUID(), opportunityId: expected.opportunityId, expected, archive: { kind: 'FUNDING', runId: null, externalIdentifier: 'CASCADE:11145' },
    contentDigest: window.source.contentDigest, payloadDigest: 'c'.repeat(64), observedAt: new Date(now).toISOString(), sourceFence: 1, received: 1, candidates: 1, replayed: false };
  collected.archive.runId = collected.runId;
  const item = { action: 'CHANGE_REQUIRES_APPROVAL', accepted: { ...expected, ...window.acceptedBinding },
    candidate: { contentDigest: window.source.contentDigest, mappingDigest: window.source.mappingDigest, snapshotDigest: rawSnapshotDigest(snapshot) },
    identities: [{ namespace: 'EU_FUNDING_TENDERS', externalId: 'CASCADE:11145' }], aliasDecisionIds: [], conflictFields: [],
    reasonCodes: ['LEGACY_MIGRATION_REQUIRES_REVIEW', 'MAPPING_BASELINE_UNAVAILABLE'] };
  const plan = { planId: randomUUID(), planDigest: 'd'.repeat(64), source: 'EU_FUNDING_TENDERS', state: 'DRAFT', fence: 1,
    expiresAt: new Date(now + 3600000).toISOString(), expected, current: { ...expected, lifecycleState: 'ACTIVE' }, archive: collected.archive,
    candidate: { snapshot: clone(snapshot), mappingDigest: window.source.mappingDigest, snapshotDigest: rawSnapshotDigest(snapshot) },
    preview: { items: [item], totalCandidates: 1, totalAccepted: 1, previewDigest: 'e'.repeat(64) },
    review: { currentPreviewMatches: true, reasonCode: null, unexpired: true, canApprove: true } };
  const receipt = { opportunityId: expected.opportunityId, revisionId: randomUUID(), revisionNumber: 5, rowVersion: 5, action: 'REVISION_CREATED', contentDigest: window.source.contentDigest, sourceVersion: 2 };
  return { now, window, collected, plan, receipt };
}
test('habitual CLI rejects generic modes, destinations, old or incomplete window evidence', () => {
  assert.deepEqual(script.args(['--inspect-auth']), { mode: 'inspect' });
  for (const argv of [[], ['--execute-11145'], ['--inspect-auth', '--window=x'], ['--execute-11145', '--window=https://example.test/window.json']]) assert.throws(() => script.args(argv));
  const value = fixture(); assert.equal(script.validateWindow(value.window, value.now).expected.opportunityId, value.window.expected.opportunityId);
  for (const change of [w => { w.resume.health = false; }, w => { w.backup.noSourceDrift = false; }, w => { w.installed.centralVersion = '035_funding_source_resolution'; }, w => { w.source.externalIdentifier = 'CASCADE:11146'; }, w => { w.completedAt = new Date(value.now - 3600001).toISOString(); }, w => { delete w.acceptedBinding.protectedStateDigest; }]) {
    const changed = clone(value.window); change(changed); assert.throws(() => script.validateWindow(changed, value.now));
  }
});
test('factual approval refuses financial, identity, CAS, mapping and protected-state drift', () => {
  const value = fixture(); assert.equal(script.validatePlan(value.plan, value.window, value.collected, value.now).planId, value.plan.planId);
  for (const change of [p => { p.candidate.snapshot.financing.allocations.value[0].money.amount = '120001'; }, p => { p.expected.rowVersion++; }, p => { p.current.revisionId = randomUUID(); }, p => { p.preview.items[0].accepted.protectedStateDigest = 'f'.repeat(64); }, p => { p.candidate.mappingDigest = 'f'.repeat(64); }, p => { p.archive.externalIdentifier = 'CASCADE:11146'; }, p => { p.review.canApprove = false; }, p => { p.preview.items[0].aliasDecisionIds.push(randomUUID()); }]) {
    const changed = clone(value.plan); change(changed); assert.throws(() => script.validatePlan(changed, value.window, value.collected, value.now));
  }
});
function apiFixture(value, { drift = null, failAccept = false, denied = false } = {}) {
  const calls = [], auth = { user: { id: randomUUID(), platformRoles: ['C4G_ADMIN'] } };
  const state = status => ({ family: 'EU_FUNDING_TENDERS', state: status, fence: { ACTIVE: 1, SUSPEND_REQUESTED: 2, QUIESCED: 3 }[status], activeLeases: 0, queuedRuns: 0, pendingRuns: 0, otherPendingRuns: 0, acceptedV2: status === 'QUIESCED' && calls.filter(c => c.path.endsWith('/accept')).length ? 1 : 0, canQuiesce: status === 'SUSPEND_REQUESTED' });
  return { calls, async request(method, url, body) {
    calls.push({ method, path: url, body });
    if (url === '/api/auth/session') { if (denied) throw Object.assign(Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED' }); return auth; }
    if (url.endsWith('/sources/eu')) return state(calls.some(c => c.path.endsWith('/quiesce')) ? 'QUIESCED' : calls.some(c => c.path.endsWith('/suspend')) ? 'SUSPEND_REQUESTED' : 'ACTIVE');
    if (url.endsWith('/collect')) { const c = clone(value.collected); if (drift === 'collection') c.contentDigest = 'f'.repeat(64); return c; }
    if (url.endsWith('/suspend')) return state('SUSPEND_REQUESTED');
    if (url.endsWith('/quiesce')) return state('QUIESCED');
    if (url.endsWith('/calls/11145/plans')) return clone(value.plan);
    if (method === 'GET' && url.includes('/plans/')) { const p = clone(value.plan); if (drift === 'plan') p.preview.items[0].accepted.protectedStateDigest = 'f'.repeat(64); return p; }
    if (url.endsWith('/approve')) return { ...clone(value.plan), state: 'APPROVED', fence: 2 };
    if (url.endsWith('/accept')) { if (failAccept) throw Object.assign(Error('HTTP_FAILED'), { code: 'HTTP_FAILED' }); return clone(value.receipt); }
    if (url.includes('/admin/central-opportunities/')) return { ...value.receipt, rowVersion: String(value.receipt.rowVersion), snapshot: clone(snapshot), readModel: { sourceVersion: 2 } };
    throw Error('UNEXPECTED_TEST_REQUEST');
  } };
}
test('no funding mutation follows denied auth; collection drift stops before suspension; plan drift stops before approval', async () => {
  for (const options of [{ denied: true }, { drift: 'collection' }, { drift: 'plan' }]) {
    const value = fixture(), api = apiFixture(value, options), progress = [];
    await assert.rejects(script.execute11145({ window: value.window, request: api.request, authenticatedAt: value.now, clock: () => value.now, onProgress: event => progress.push(event) }));
    assert.equal(api.calls.some(c => c.path.endsWith('/approve') || c.path.endsWith('/accept')), false);
    if (options.denied) assert.equal(api.calls.some(c => c.method === 'POST'), false);
    if (options.drift === 'collection') assert.equal(api.calls.some(c => c.path.endsWith('/suspend')), false);
    if (options.drift === 'plan') assert.deepEqual(progress.find(event => event.status === 'PREPARED'), {
      stage: 'prepare', status: 'PREPARED', planId: value.plan.planId, planDigest: value.plan.planDigest
    });
  }
});
test('an uncertain acceptance is not retried and quiescence is not automatically undone', async () => {
  const value = fixture(), api = apiFixture(value, { failAccept: true }), progress = [];
  await assert.rejects(script.execute11145({ window: value.window, request: api.request, authenticatedAt: value.now, clock: () => value.now, onProgress: event => progress.push(event) }));
  assert.equal(api.calls.filter(c => c.path.endsWith('/accept')).length, 1);
  assert.equal(api.calls.some(c => c.path.endsWith('/resume')), false);
  assert(progress.some(p => p.stage === 'accept' && p.status === 'ATTEMPTING' && /^[a-f0-9-]{36}$/.test(p.requestId)));
});
test('successful bounded flow binds exact approval, distinct fences and intentional same-request replay', async () => {
  const value = fixture(), api = apiFixture(value);
  const result = await script.execute11145({ window: value.window, request: api.request, authenticatedAt: value.now, clock: () => value.now });
  assert.equal(result.accepted.opportunityId, value.window.expected.opportunityId);
  const acceptance = api.calls.filter(c => c.path.endsWith('/accept'));
  assert.equal(acceptance.length, 2); assert.deepEqual(acceptance[0].body, acceptance[1].body);
  assert.equal(acceptance[0].body.planDigest, value.plan.planDigest); assert.equal(acceptance[0].body.fence, 2); assert.equal(acceptance[0].body.sourceFence, 3);
  assert.equal(result.source.state, 'QUIESCED'); assert.equal(result.replayVerified, true);
});
test('HTTP command boundary cannot call another identity, generic writer, source resume or credential endpoint', () => {
  for (const [method, url, body] of [
    ['POST', '/api/admin/opportunity-activation/sources/eu/resume', { requestId: randomUUID(), expectedFence: 3 }],
    ['POST', '/api/admin/opportunity-activation/calls/11146/collect', { requestId: randomUUID(), expectedSourceFence: 1 }],
    ['POST', '/api/admin/opportunity-activation/plans', { requestId: randomUUID(), archive: {}, expected: {} }],
    ['POST', '/api/auth/organization', { requestId: randomUUID(), organizationId: randomUUID() }],
    ['GET', 'http://example.test/api/auth/session'], ['GET', '/api/auth/session?token=opaque'],
    ['POST', '/api/admin/opportunity-activation/calls/11145/collect', { requestId: randomUUID(), expectedSourceFence: 1, actor: {} }]
  ]) assert.throws(() => script.httpCommand(method, url, body));
  assert.doesNotThrow(() => script.httpCommand('POST', '/api/admin/opportunity-activation/calls/11145/collect', { requestId: randomUUID(), expectedSourceFence: 1 }));
});
test('readiness uses the integration router mount shared by the application and frontend', () => {
  assert.doesNotThrow(() => script.httpCommand('GET', '/api/admin/integrations/funding-tenders'));
  assert.throws(() => script.httpCommand('GET', '/api/admin/funding-tenders'));
});
test('catalogue bigint rowVersion accepts canonical safe positive integers and rejects coercible malformed values', () => {
  for (const value of [1, '1', 42, '42', Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)]) assert.equal(script.catalogRowVersion(value), Number(value));
  for (const value of ['01', '+1', '1.0', '1e0', '1 ', ' 1', '', '0', 0, -1, '9007199254740992', Number.MAX_SAFE_INTEGER + 1, 1.1, null, true, {}, 1n]) assert.throws(() => script.catalogRowVersion(value), { code: 'APPROVAL_READER_PARITY_FAILED' });
});
test('expired local authentication or an actor change stops before approval', async () => {
  const value = fixture(), expired = apiFixture(value);
  await assert.rejects(script.execute11145({ window: value.window, request: expired.request, authenticatedAt: value.now - 240000, clock: () => value.now }), { code: 'APPROVAL_REAUTHENTICATION_REQUIRED' });
  assert.equal(expired.calls.length, 0);
  const changed = apiFixture(value); let sessions = 0;
  const request = async (...args) => { const result = await changed.request(...args); if (args[1] === '/api/auth/session' && ++sessions > 1) result.user.id = randomUUID(); return result; };
  await assert.rejects(script.execute11145({ window: value.window, request, authenticatedAt: value.now, clock: () => value.now }), { code: 'APPROVAL_ACTOR_CHANGED' });
  assert.equal(changed.calls.some(c => c.path.endsWith('/approve') || c.path.endsWith('/accept')), false);
});
