'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateProbeEvidence } = require('../../test/integration/partner-portal/evidence');
const { validProbeEvidence } = require('./support/partnerPortalGateEvidence');
const caseOf = (group, id) => group.cases.find(item => item.id === id);
const evaluate = fixture => evaluateProbeEvidence(fixture.repository, fixture.authority);
const refused = result => result.failures.length + result.incomplete.length > 0;

test('complete synthetic validator fixture satisfies all declared probe invariants', () => {
  assert.deepEqual(evaluate(validProbeEvidence()), { failures: [], incomplete: [] });
});

test('missing environment and arbitrary PASS flags never establish probe execution', () => {
  assert(refused(evaluateProbeEvidence()));
  const fixture = validProbeEvidence(); fixture.repository.environmentVerified = false;
  assert(refused(evaluate(fixture)));
  const flags = validProbeEvidence(); for (const item of flags.authority.cases) item.evidence = { assertions: 1 };
  assert(refused(evaluate(flags)));
});

test('PASS cases with contradictory RLS, snapshot, cleanup or revocation fields fail', () => {
  for (const mutate of [
    f => { caseOf(f.repository, 'repository.roles-rls').evidence.sessions[0].foreignRows = 1; },
    f => { caseOf(f.repository, 'repository.roles-rls').evidence.sessions[1].limitedLogin = false; },
    f => { caseOf(f.repository, 'snapshot.after-declare').evidence.nextRequestSeesCommit = false; },
    f => { caseOf(f.repository, 'snapshot.before-declare').evidence.activeRemovalCaptured = false; },
    f => { caseOf(f.repository, 'snapshot.between-fetches').evidence.projectedFields = ['body']; },
    f => { caseOf(f.repository, 'cleanup.success').evidence.observedPid = 456; },
    f => { caseOf(f.repository, 'cleanup.sql-abort').evidence.injectedFault = false; },
    f => { caseOf(f.repository, 'cleanup.cancel').evidence.injectedSqlState = '22012'; },
    f => { caseOf(f.authority, 'membership-guard-first').evidence.committedBeforeRelease = true; },
    f => { caseOf(f.authority, 'policy-authority-first').evidence.successfulRead = true; },
    f => { caseOf(f.authority, 'membership-authority-first').evidence.refusalCode = 'ECONNRESET'; },
    f => { caseOf(f.authority, 'session-revoked').evidence.authorityFailure = 'MEMBERSHIP_INVALID'; },
    f => { caseOf(f.authority, 'team-cache-hit').evidence.nextResultTotal = 2; },
    f => { caseOf(f.authority, 'audit-failure').evidence.partialAuditRows = 1; },
    f => { caseOf(f.authority, 'audit-failure').evidence.injectedSqlState = '08006'; }
  ]) { const fixture = validProbeEvidence(); mutate(fixture); assert(evaluate(fixture).failures.length > 0); }
});

test('missing, duplicated, unknown and NOT_RUN cases remain incomplete', () => {
  for (const mutate of [f => f.repository.cases.pop(), f => f.authority.cases.push(f.authority.cases[0]),
    f => { f.repository.cases[0].id = 'unreviewed'; }, f => { f.authority.cases[0].status = 'NOT_RUN'; },
    f => { delete caseOf(f.repository, 'cleanup.disconnect').evidence.verification; }]) {
    const fixture = validProbeEvidence(); mutate(fixture); assert(refused(evaluate(fixture)));
  }
});

function storageFixture() {
  const fixture = validProbeEvidence(), matrix = caseOf(fixture.repository, 'repository.contract-matrix').evidence;
  const origin = matrix.coverage.find(item => item.id === 'authorization-trace');
  Object.assign(origin, { status: 'EXPECTED_STORAGE_REJECTION', reads: 0, sqlState: '23514', constraint: 'application_exact_origin',
    storage: [{ sqlState: '23514', constraint: 'application_exact_origin', category: 'IMPOSSIBLE_ORIGIN_FIXTURE' }] });
  const unicode = matrix.coverage.find(item => item.id === 'canonical-input');
  Object.assign(unicode, { status: 'EXPECTED_STORAGE_REJECTION', reads: 2, sqlState: '22P05',
    storage: [{ sqlState: '22P05', category: 'INVALID_UNICODE_STORAGE' }] });
  Object.assign(matrix, { completeReadCoverage: false, expectedStorageRejections: 2, reason: 'EXPECTED_STORAGE_REJECTION_IS_NOT_READ_COVERAGE' });
  return fixture;
}
test('only reviewed storage rejections are accepted and never labelled complete read coverage', () => {
  assert.deepEqual(evaluate(storageFixture()), { failures: [], incomplete: [] });
  for (const sqlState of ['22P02', '22P05', '22021']) {
    const fixture = storageFixture(), entry = caseOf(fixture.repository, 'repository.contract-matrix').evidence.coverage.find(item => item.id === 'canonical-input');
    entry.sqlState = sqlState; entry.storage[0].sqlState = sqlState;
    assert.deepEqual(evaluate(fixture), { failures: [], incomplete: [] });
  }
});

test('storage rejection cannot hide wrong cases, wrong constraints or later read failures', () => {
  for (const mutate of [
    m => { m.completeReadCoverage = true; }, m => { m.expectedStorageRejections = 1; },
    m => { m.coverage.find(x => x.id === 'authorization-trace').constraint = 'other_constraint'; },
    m => { m.coverage.find(x => x.id === 'authorization-trace').id = 'projection'; },
    m => { m.coverage.find(x => x.id === 'canonical-input').storage[0].sqlState = '08006'; },
    m => { m.coverage.find(x => x.id === 'canonical-input').status = 'FAIL'; },
    m => { m.coverage.find(x => x.id === 'projection').reads = 0; },
    m => { m.coverage.find(x => x.id === 'digest-golden').storage = [{ sqlState: '23514' }]; }
  ]) { const fixture = storageFixture(); mutate(caseOf(fixture.repository, 'repository.contract-matrix').evidence); assert(refused(evaluate(fixture))); }
});

test('malformed JSON case and storage arrays fail closed without throwing', () => {
  for (const mutate of [
    f => { caseOf(f.repository, 'repository.contract-matrix').evidence.coverage[0] = null; },
    f => { caseOf(f.repository, 'repository.contract-matrix').evidence.coverage.find(x => x.id === 'canonical-input').storage = [null]; },
    f => { caseOf(f.repository, 'repository.roles-rls').evidence.sessions = [null, null]; },
    f => { f.authority.cases[0] = null; }
  ]) {
    const fixture = storageFixture(); mutate(fixture);
    assert.doesNotThrow(() => assert(refused(evaluate(fixture))));
  }
});
