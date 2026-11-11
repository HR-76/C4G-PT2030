'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { randomUUID } = require('node:crypto');
const { observe11145, COLLECTION_LIMITS } = require('../src/fundingTenders/source11145');
const actual = require('../src/opportunities/v2/collector11145');
const raw = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../context/references/opportunity-v2/evidence/eu-11145.json'), 'utf8'));
const user = '01900000-0000-7000-8000-000000000001', opportunity = '01900000-0000-7000-8000-000000000002', revision = '01900000-0000-7000-8000-000000000003';
const context = () => ({ actor: { type: 'HUMAN', id: user }, sessionId: 'isolated-collector-session' });
const config = { policyVersion: 'collector-test-v1', recentMfaRequirement: { mfa: false, maxAgeSeconds: 900, acceptedAcr: [], acceptedAmr: [], amrMode: 'any' } };
function validAuthority() { return { userId: user, storedUserId: user, revocationVersion: 1, storedRevocationVersion: 1,
  policyVersion: config.policyVersion, absoluteExpiresAt: 2000000, expiresAt: 2000000, nowSeconds: 1000, cookieExpires: null,
  evidence: { authTime: 950, acr: 'password', amr: ['pwd'], policyVersion: config.policyVersion } }; }

// Unit transaction tests isolate only the expensive schema admission read.
// The executor integration gate uses the unmodified, real preflight/registry.
function unitModule(preflight = async () => ({ currentVersion: '042_opportunity_eu_source_control_v2' })) {
  const filename = require.resolve('../src/opportunities/v2/collector11145');
  const isolated = new Module(filename, module), realRequire = Module.createRequire(filename);
  isolated.filename = filename; isolated.paths = module.paths;
  isolated.require = id => id === '../../security/centralMigrationPreflight' ? { preflightCentral: preflight } : realRequire(id);
  isolated._compile(fs.readFileSync(filename, 'utf8'), filename); return isolated.exports;
}
function fixture({ preflight, failAudit = false, failArchive = false, failCompletion = false } = {}) {
  const state = { runs: [], archives: [], events: [], sql: [], inTransaction: false, checkouts: 0, released: 0,
    authorized: true, sourceFence: 1, sourceActive: true, identity: { opportunity_id: opportunity, current_revision_id: revision, row_version: '1', lifecycle_state: 'ACTIVE' } };
  let saved;
  const client = { release() { assert.equal(state.inTransaction, false); state.released++; }, async query(sql, values = []) {
    state.sql.push(sql);
    if (sql === 'BEGIN') { assert.equal(state.inTransaction, false); state.inTransaction = true; saved = structuredClone({ runs: state.runs, archives: state.archives, events: state.events }); return { rows: [] }; }
    if (sql === 'COMMIT') { state.inTransaction = false; return { rows: [] }; }
    if (sql === 'ROLLBACK') { Object.assign(state, saved); state.inTransaction = false; return { rows: [] }; }
    if (sql.startsWith('SET LOCAL') || sql.startsWith('LOCK TABLE') || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes('authority_api.opportunity_v2_administrator')) return { rows: state.authorized ? [{ authority: validAuthority() }] : [] };
    if (sql.includes('assert_eu_active_v2')) {
      if (!state.sourceActive) throw Object.assign(Error('OPPORTUNITY_V2_EU_SUSPENDED'), { code: 'P0001' });
      return { rows: [{ fence: state.sourceFence }] };
    }
    if (sql.includes('FROM opportunity_catalog.funding_identity')) return { rows: state.identity ? [structuredClone(state.identity)] : [] };
    if (sql.includes('FROM opportunity_catalog.source_identity_v2')) return { rows: [] };
    if (sql.startsWith('SELECT run_id FROM opportunity_catalog.funding_run WHERE request_id')) return { rows: state.runs.filter(row => row.request_id === values[0]) };
    if (sql.startsWith('SELECT * FROM opportunity_catalog.funding_run')) return { rows: state.runs.filter(row => row.run_id === values[0]).map(row => structuredClone(row)) };
    if (sql.includes('AS candidates')) return { rows: [{ candidates: state.archives.filter(row => row.run_id === values[0]).length,
      variants: state.archives.find(row => row.run_id === values[0])?.source_evidence.variants.length, items: 0, batches: 0, cycles: 0 }] };
    if (sql.startsWith('INSERT INTO opportunity_catalog.funding_run(')) {
      state.runs.push({ run_id: values[0], request_id: values[1], requested_by: values[2], source_code: values[3], status: 'QUEUED',
        canonical_v2_required: true, eu_source_fence: state.sourceFence, eu_source_held: false, collected: false, result_count: 0,
        created_count: 0, updated_count: 0, unchanged_count: 0, failed_count: 0, fence: '0', lease_until: null, error_code: null, limited: false });
      return { rowCount: 1, rows: [] };
    }
    if (sql.startsWith('UPDATE opportunity_catalog.funding_run')) {
      const run = state.runs.find(row => row.run_id === values[0]); assert.ok(run);
      if (sql.includes("status='RUNNING',started_at")) {
        Object.assign(run, { status: 'RUNNING', started_at: new Date(), fence: '1', lease_until: new Date(Date.now() + 150000) });
        return { rowCount: 1, rows: [structuredClone(run)] };
      }
      assert.ok(sql.includes("status='SUCCESS',collected=true"));
      if (failCompletion) return { rowCount: 0, rows: [] };
      Object.assign(run, { status: 'SUCCESS', collected: true, observed_at: values[1], result_count: values[3], finished_at: new Date(), lease_until: null });
      return { rowCount: 1, rows: [{ run_id: run.run_id }] };
    }
    if (sql.startsWith('INSERT INTO opportunity_catalog.funding_candidate_v2')) {
      if (failArchive) throw Error('storage failure');
      state.archives.push({ run_id: values[0], external_identifier: values[1], source_selection: values[2], observed_at: values[3], snapshot_schema_version: 2,
        mapping_version: values[4], content_digest: values[5], payload_digest: values[6], canonical_snapshot: JSON.parse(values[7]),
        source_evidence: JSON.parse(values[8]), evidence_fingerprint: values[9], evidence_sha256: values[10] });
      return { rowCount: 1, rows: [{ payload_digest: values[6] }] };
    }
    if (sql.includes('FROM opportunity_catalog.funding_candidate_v2')) return { rows: state.archives.filter(row => row.run_id === values[0] && row.external_identifier === values[1]) };
    if (sql.includes('prepare_platform_append_v1')) return { rows: [{ stream_id: 'PLATFORM:DATA', sequence: state.events.length + 1, previous_hash: '0'.repeat(64), accepted_at: new Date() }] };
    if (sql.includes('append_platform_event_v1')) {
      if (failAudit) throw Error('private SQL detail must not escape');
      state.events.push(JSON.parse(values[22])); return { rows: [{ status: 'APPENDED', event_id: values[0], event_hash: values[21] }] };
    }
    throw Error('Unexpected query: ' + sql);
  } };
  const pool = { async connect() { state.checkouts++; assert.equal(state.inTransaction, false); return client; } };
  let fetches = 0;
  const fetchImpl = async () => { assert.equal(state.inTransaction, false, 'Network must not hold transaction/authority locks'); fetches++; return new Response(JSON.stringify(raw())); };
  const api = unitModule(preflight);
  return { state, client, pool, api, fetchImpl, fetches: () => fetches,
    collector: options => api.createEu11145Collector({ ...config, pool, fetchImpl, ...options }) };
}
test('11145 source fixes the query, preserves public values and reports bounded transport evidence', async () => {
  const response = raw();
  const observed = await observe11145({ fetchImpl: async (url, options) => {
    assert.equal(new URL(url).searchParams.get('pageNumber'), '1'); assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(await options.body.get('query').text()), { bool: { must: [{ term: { type: '8' } }, { term: { callccm2Id: '11145' } }] } });
    return new Response(JSON.stringify(response));
  } });
  assert.equal(observed.batch.canonicalSnapshot.financing.allocations.value[0].money.amount, '120000');
  assert.equal(observed.batch.canonicalSnapshot.financing.allocations.value[0].money.currency.state, 'NOT_FOUND');
  assert.equal(observed.batch.canonicalSnapshot.schedule.deadlines.value.length, 7);
  assert.equal(observed.transport.totalResults, 1); assert.match(observed.transport.sha256, /^[a-f0-9]{64}$/);
  assert.equal(observed.transport.bytes, Buffer.byteLength(JSON.stringify(response)));
  assert.ok(Object.isFrozen(observed.batch.canonicalSnapshot));
});
test('11145 source refuses incomplete, ambiguous, foreign, malformed, missing and oversized responses without retry', async () => {
  const cases = [() => ({ ...raw(), totalResults: 2 }), () => { const x = raw(); delete x.totalResults; return x; },
    () => { const x = raw(); x.results[0].metadata.callccm2Id = ['11146']; return x; },
    () => { const x = raw(); x.results[0].metadata.budget = ['-1']; return x; }, () => ({ results: [], totalResults: 0 })];
  for (const make of cases) await assert.rejects(observe11145({ fetchImpl: async () => new Response(JSON.stringify(make())) }), { code: 'OPPORTUNITY_V2_11145_SOURCE_INVALID' });
  let calls = 0;
  await assert.rejects(observe11145({ fetchImpl: async () => { calls++; return new Response('{}', { status: 503 }); } }), { code: 'OPPORTUNITY_V2_11145_SOURCE_INVALID' });
  assert.equal(calls, 1);
  await assert.rejects(observe11145({ fetchImpl: async () => new Response('{}', { headers: { 'content-length': String(COLLECTION_LIMITS.bytes + 1) } }) }), { code: 'OPPORTUNITY_V2_11145_SOURCE_INVALID' });
});
test('collector DTO and UUID purpose cannot silently adopt legacy or alternate operations', () => {
  const requestId = randomUUID();
  const base = { requestId, actorId: user, sourceFence: 1, opportunityId: opportunity }, id = actual.collectorRunId(base);
  assert.match(id, /^[a-f0-9-]{14}8[a-f0-9-]{21}$/);
  assert.equal(actual.collectorRunId(base), id);
  for (const change of [{ actorId: opportunity }, { requestId: randomUUID() }, { sourceFence: 2 }, { opportunityId: revision }]) assert.notEqual(actual.collectorRunId({ ...base, ...change }), id);
  for (const input of [{ requestId, expectedSourceFence: 0 }, { requestId, expectedSourceFence: 1, externalIdentifier: 'CASCADE:11146' }, { requestId: 'bad', expectedSourceFence: 1 }]) assert.throws(() => actual.command(input), { code: 'OPPORTUNITY_V2_11145_INVALID' });
  let getter = false;
  const hostile = { expectedSourceFence: 1, get requestId() { getter = true; return requestId; } };
  assert.throws(() => actual.command(hostile)); assert.equal(getter, false);
});
test('collector atomically archives, rederives and audits without updating v1 or holding locks over HTTP; replay does no I/O', async () => {
  const f = fixture(), collector = f.collector(), input = { requestId: randomUUID(), expectedSourceFence: 1 };
  const result = await collector.collect(input, context());
  assert.equal(result.replayed, false); assert.equal(result.opportunityId, opportunity); assert.equal(result.sourceFence, 1);
  assert.equal(f.state.runs[0].status, 'SUCCESS'); assert.equal(f.state.archives.length, 1); assert.equal(f.state.events.length, 1);
  assert.equal(f.state.events[0].actor.type, 'HUMAN'); assert.equal(f.state.events[0].payload.detailCode, 'OPPORTUNITY_11145_COLLECTED');
  assert.equal(f.state.sql.some(sql => /(?:INSERT INTO|UPDATE) opportunity_catalog\.(?:opportunity|revision|funding_identity|funding_run_item|funding_observation)\b/.test(sql)), false);
  f.state.sourceActive = false; // A read-only replay is valid after suspension.
  const replay = await collector.collect(input, context());
  assert.equal(replay.runId, result.runId); assert.equal(replay.replayed, true); assert.equal(f.fetches(), 1); assert.equal(f.state.events.length, 1);
  assert.equal(f.state.checkouts, f.state.released);
  await assert.rejects(collector.collect({ ...input, expectedSourceFence: 2 }, context()), { code: 'OPPORTUNITY_V2_IDEMPOTENCY_CONFLICT' });
});
test('collector rolls back run, archive and audit together on storage, completion or audit failure', async () => {
  for (const options of [{ failArchive: true }, { failCompletion: true }, { failAudit: true }]) {
    const f = fixture(options);
    await assert.rejects(f.collector().collect({ requestId: randomUUID(), expectedSourceFence: 1 }, context()), error => error.code.startsWith('OPPORTUNITY_V2_') && !error.message.includes('private'));
    assert.deepEqual(f.state.runs, []); assert.deepEqual(f.state.archives, []); assert.deepEqual(f.state.events, []);
    assert.equal(f.state.checkouts, f.state.released);
  }
});
test('preflight, identity and authenticated authority must precede network and be revalidated after it', async () => {
  for (const setup of [f => { f.state.authorized = false; }, f => { f.state.identity = null; }, f => { f.state.sourceFence = 2; }]) {
    const f = fixture(); setup(f);
    await assert.rejects(f.collector().collect({ requestId: randomUUID(), expectedSourceFence: 1 }, context())); assert.equal(f.fetches(), 0);
  }
  const baseline = fixture({ preflight: async () => ({ currentVersion: '035_funding_source_resolution' }) });
  await assert.rejects(baseline.collector().collect({ requestId: randomUUID(), expectedSourceFence: 1 }, context()), { code: 'OPPORTUNITY_V2_NOT_CONFIGURED' }); assert.equal(baseline.fetches(), 0);
  for (const mutate of [f => { f.state.authorized = false; }, f => { f.state.sourceFence = 2; }, f => { f.state.sourceActive = false; }, f => { f.state.identity.opportunity_id = randomUUID(); }]) {
    const f = fixture();
    const collector = f.collector({ fetchImpl: async () => { assert.equal(f.state.inTransaction, false); mutate(f); return new Response(JSON.stringify(raw())); } });
    await assert.rejects(collector.collect({ requestId: randomUUID(), expectedSourceFence: 1 }, context()));
    assert.deepEqual(f.state.runs, []); assert.deepEqual(f.state.archives, []); assert.deepEqual(f.state.events, []);
  }
});
test('network failure leaves no pending run and the same request may be retried with a real observation', async () => {
  const f = fixture(), input = { requestId: randomUUID(), expectedSourceFence: 1 };
  await assert.rejects(f.collector({ fetchImpl: async () => { throw Error('transport unavailable'); } }).collect(input, context()), { code: 'OPPORTUNITY_V2_11145_SOURCE_INVALID' });
  assert.deepEqual(f.state.runs, []);
  const result = await f.collector().collect(input, context()); assert.equal(result.replayed, false); assert.equal(f.state.runs.length, 1);
});
test('verified collector scope rejects legacy status, actor, counters, ID purpose and modified archive evidence', async () => {
  const f = fixture(), result = await f.collector().collect({ requestId: randomUUID(), expectedSourceFence: 1 }, context());
  const original = structuredClone(f.state.runs[0]);
  for (const changes of [{ requested_by: opportunity }, { status: 'RUNNING' }, { failed_count: 1 }, { result_count: 2 }, { canonical_v2_required: false }, { request_id: randomUUID() }, { eu_source_fence: 2 }]) {
    f.state.runs[0] = { ...original, ...changes };
    await assert.rejects(actual.verifyCollector11145Run(f.client, { runId: result.runId, actorId: user }), { code: 'OPPORTUNITY_V2_11145_RUN_INVALID' });
  }
  f.state.runs[0] = original;
  f.state.archives[0].canonical_snapshot.financing.allocations.value[0].money.amount = '120001';
  await assert.rejects(actual.verifyCollector11145Run(f.client, { runId: result.runId, actorId: user }), { code: 'FUNDING_V2_CANDIDATE_INVALID' });
});
test('collector binding refuses a later reassignment of the known external identity to another opportunity UUID', async () => {
  const f = fixture(), input = { requestId: randomUUID(), expectedSourceFence: 1 };
  const result = await f.collector().collect(input, context());
  f.state.identity.opportunity_id = randomUUID();
  await assert.rejects(actual.verifyCollector11145Run(f.client, { runId: result.runId, actorId: user }), { code: 'OPPORTUNITY_V2_11145_RUN_INVALID' });
  await assert.rejects(f.collector().collect(input, context())); assert.equal(f.fetches(), 1);
});
test('received counts all complete public variants while one canonical candidate is archived', async () => {
  const f = fixture(), response = raw();
  response.results.push(structuredClone(response.results[0])); response.totalResults = 2;
  const result = await f.collector({ fetchImpl: async () => new Response(JSON.stringify(response)) })
    .collect({ requestId: randomUUID(), expectedSourceFence: 1 }, context());
  assert.equal(f.state.runs[0].result_count, 2);
  assert.equal(f.state.archives.length, 1); assert.equal(f.state.archives[0].source_evidence.variants.length, 2);
  assert.equal(result.received, 2); assert.equal(result.candidates, 1); assert.equal(result.transport.totalResults, 2);
});
