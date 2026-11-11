'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { command, sourceState, sourceControlError, assertEuQuiescent, createEuSourceControlV2 } = require('../src/opportunities/v2/euSourceControl');
const { createFundingRepository } = require('../src/fundingTenders/repository');
const id = '01900000-0000-7000-8000-000000000001';
const active = () => ({ family: 'EU_FUNDING_TENDERS', state: 'SUSPEND_REQUESTED', fence: 2, queuedRuns: 1, pendingRuns: 2, otherPendingRuns: 0, activeRunLeases: 0, activeOutboxLeases: 0, activeInboxLeases: 0, expiredPendingRuns: 0, unrecoverablePendingRuns: 0, acceptedV2: 0 });
test('source control commands bind request and expected integer fence and reject injected authority or source', () => {
  assert.deepEqual(command({ requestId: 'source-request', expectedFence: 1 }), { requestId: 'source-request', expectedFence: 1 });
  for (const input of [{ requestId: 'source-request', expectedFence: '1' }, { requestId: 'source-request', expectedFence: 0 }, { requestId: 'source-request', expectedFence: 1, source: 'INTERREG_EUROPE' }, { requestId: 'source-request', expectedFence: 1, actor: id }]) assert.throws(() => command(input), { code: 'OPPORTUNITY_V2_SOURCE_CONTROL_INVALID' });
});
test('quiescence distinguishes queued work from live source, inbox and relay leases', async () => {
  const row = active(), client = { query: async () => ({ rows: [{ state: row }] }) };
  let result = await sourceState(client);
  assert.equal(result.canQuiesce, true); assert.equal(result.pendingRuns, 2); assert.equal(result.queuedRuns, 1);
  for (const key of ['activeRunLeases', 'activeOutboxLeases', 'activeInboxLeases']) {
    row[key] = 1; result = await sourceState(client); assert.equal(result.canQuiesce, false); assert.equal(result.canResume, false); row[key] = 0;
  }
});
test('legacy resumption requires recoverable non-expired work and no accepted EU v2', async () => {
  const row = active(), client = { query: async () => ({ rows: [{ state: row }] }) };
  assert.equal((await sourceState(client)).canResume, true);
  for (const key of ['expiredPendingRuns', 'unrecoverablePendingRuns', 'acceptedV2', 'otherPendingRuns']) {
    row[key] = 1; assert.equal((await sourceState(client)).canResume, false); row[key] = 0;
  }
  row.activeRunLeases = '0'; await assert.rejects(sourceState(client), { code: 'OPPORTUNITY_V2_SOURCE_CONTROL_UNAVAILABLE' });
});
test('EU acceptance requires a current SQL quiescence guard for all shared selections', async () => {
  const calls = [], client = { async query(sql, values) { calls.push({ sql, values }); } };
  for (const source of ['EU_FUNDING_TENDERS', 'CORDIS', 'ERASMUS']) await assertEuQuiescent(client, source, 3);
  assert.equal(calls.length, 3); assert.ok(calls.every(call => call.sql.includes('assert_eu_quiescent_v2') && call.values[0] === 3));
  await assertEuQuiescent(client, 'INTERREG_EUROPE'); await assertEuQuiescent(client, 'POCTEP'); assert.equal(calls.length, 3);
  await assert.rejects(assertEuQuiescent(client, 'EU_FUNDING_TENDERS'), { code: 'OPPORTUNITY_V2_SOURCE_FENCE_STALE' });
  await assert.rejects(assertEuQuiescent({ query: async () => { throw Object.assign(Error('SQL details'), { code: '42883' }); } }, 'EU_FUNDING_TENDERS', 3), { code: 'OPPORTUNITY_V2_SOURCE_CONTROL_UNAVAILABLE' });
});
test('only allowlisted SQL barrier errors become public application codes', () => {
  for (const message of ['OPPORTUNITY_V2_EU_SUSPENDED', 'OPPORTUNITY_V2_SOURCE_FENCE_STALE']) assert.equal(sourceControlError(Object.assign(Error(message), { code: 'P0001' })).code, message);
  const unrelated = Object.assign(Error('secret database diagnostic'), { code: 'P0001' }); assert.equal(sourceControlError(unrelated), unrelated);
});
test('opt-in repository rejects suspended admissions and old claims before writes and preserves the baseline when disabled', async () => {
  const calls = [], client = { release() {}, async query(sql) {
    calls.push(sql);
    if (sql.includes('assert_eu_active_v2')) throw Object.assign(Error('OPPORTUNITY_V2_EU_SUSPENDED'), { code: 'P0001' });
    if (sql.includes('FROM public.')) return { rows: [{ id }] };
    if (sql.includes('FROM opportunity_catalog.funding_run')) return { rows: [{ run_id: id, requested_by: id, source_code: 'EU_FUNDING_TENDERS', status: 'QUEUED' }] };
    return { rows: [] };
  } };
  const pool = { connect: async () => client }, repository = createFundingRepository({ pool, euSourceControlEnabled: true });
  await assert.rejects(repository.enqueue(id, id), { code: 'OPPORTUNITY_V2_EU_SUSPENDED' });
  await assert.rejects(repository.claim(id), { code: 'OPPORTUNITY_V2_EU_SUSPENDED' });
  assert.equal(calls.some(sql => /^INSERT|^UPDATE/.test(sql)), false);
  const writerIntent = calls.findIndex(sql => sql === 'LOCK TABLE opportunity_catalog.funding_run IN ROW EXCLUSIVE MODE');
  assert.ok(writerIntent >= 0 && writerIntent < calls.findIndex(sql => sql.includes('assert_eu_active_v2')), 'writer table intent must precede control-row locking');
  const count = calls.length;
  assert.equal(await createFundingRepository({ pool }).sourceExecutionAllowed(id), true); assert.equal(calls.length, count);
});

test('active EU control refuses legacy writer admission and claim with a specific code', async () => {
  const calls = [], state = { source: 'EU_FUNDING_TENDERS' };
  const client = { release() {}, async query(sql) {
    calls.push(sql);
    if (sql.includes('FROM public.')) return { rows: [{ id }] };
    if (sql.includes('FROM opportunity_catalog.funding_run')) return { rows: [{ run_id: id, requested_by: id, source_code: state.source, status: 'QUEUED' }] };
    return { rows: [] };
  } };
  const repository = createFundingRepository({ pool: { connect: async () => client }, euSourceControlEnabled: true });
  for (const source of ['EU_FUNDING_TENDERS', 'CORDIS', 'ERASMUS']) {
    state.source = source;
    await assert.rejects(repository.enqueue(id, id, source), { code: 'FUNDING_EU_V2_WRITER_REQUIRED' });
    await assert.rejects(repository.claim(id), { code: 'FUNDING_EU_V2_WRITER_REQUIRED' });
  }
  state.source = 'EU_FUNDING_TENDERS';
  await assert.rejects(repository.stage({ run_id: id, fence: 1 }, { records: [] }), { code: 'FUNDING_EU_V2_WRITER_REQUIRED' });
  assert.equal(calls.some(sql => /^INSERT|^UPDATE/.test(sql)), false);
  assert.equal(calls.filter(sql => sql.includes('assert_eu_active_v2')).length, 7);
});

test('resumption rolls back if a durable deadline expires between the initial guard and rearming the outbox', async () => {
  let progressed = false, auditTouched = false; const sqlCalls = [];
  const state = { ...active(), state: 'QUIESCED', fence: 3 };
  const authority = { userId: id, storedUserId: id, revocationVersion: 1, storedRevocationVersion: 1, policyVersion: 'source-test-v1', absoluteExpiresAt: 2000000, expiresAt: 2000000, nowSeconds: 1000, cookieExpires: null,
    evidence: { authTime: 950, acr: null, amr: ['pwd'], policyVersion: 'source-test-v1' } };
  const client = { release() {}, async query(sql) {
    sqlCalls.push(sql);
    if (sql.includes('authority_api.opportunity_v2_administrator')) return { rows: [{ authority }] };
    if (sql.includes('FROM opportunity_catalog.eu_source_control_v2')) return { rows: [{ state: state.state, fence: state.fence }] };
    if (sql.includes('eu_source_control_receipt_v2')) return { rows: [] };
    if (sql.includes('eu_source_state_v2()')) return { rows: [{ state: progressed ? { ...state, state: 'ACTIVE', fence: 4, expiredPendingRuns: 1, unrecoverablePendingRuns: 1 } : state }] };
    if (sql.includes('resume_eu_outbox_v2')) progressed = true;
    if (sql.includes('audit.')) { auditTouched = true; throw Error('Audit must not run after deadline drift'); }
    return { rows: [], rowCount: 1 };
  } };
  const control = createEuSourceControlV2({ pool: { connect: async () => client }, policyVersion: 'source-test-v1', recentMfaRequirement: { mfa: false, maxAgeSeconds: 900, acceptedAcr: [], acceptedAmr: [], amrMode: 'any' } });
  await assert.rejects(control.resume({ requestId: 'resume-deadline-drift', expectedFence: 3 }, { actor: { type: 'HUMAN', id }, sessionId: 'source-session-id' }), { code: 'OPPORTUNITY_V2_EU_LEGACY_RESUME_BLOCKED' });
  assert.equal(auditTouched, false); assert.equal(sqlCalls.at(-1), 'ROLLBACK');
});
