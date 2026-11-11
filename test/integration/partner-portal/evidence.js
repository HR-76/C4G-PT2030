'use strict';
const policy = require('./policy.json');
const contractIds = Object.freeze(['ordered-pages', 'empty-and-last-page', 'countries-before-filters', 'literal-search-fields',
  'projection', 'authorization-trace', 'error-precedence', 'digest-golden', 'cursor-binding', 'cursor-expiration-and-position',
  'unseen-mutation', 'membership-between-pages', 'excluded-changes', 'fresh-authority', 'canonical-input', 'raw-limit']);
const scope = 'REAL_POSTGRESQL_REPOSITORY_WITH_CONTROLLED_AUTHORITY_PORTS';
const record = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => integer(value) && value > 0;
const unicodeStates = new Set(['22P02', '22P05', '22021']);

// Pure offline validation. Valid structure is not proof of execution by itself:
// the runner must also bind actual execution, owned environment and source hashes.
function evaluateProbeEvidence(repository, authority) {
  const failures = [], incomplete = [];
  const fail = code => failures.push(code), missing = code => incomplete.push(code);
  function field(value, key, predicate, id) {
    if (!record(value) || !Object.hasOwn(value, key)) missing(`MISSING_EVIDENCE:${id}:${key}`);
    else if (!predicate(value[key])) fail(`INVALID_EVIDENCE:${id}:${key}`);
  }
  const expected = (value, keys, id) => { for (const [key, wanted] of Object.entries(keys)) field(value, key, actual => actual === wanted, id); };
  function matrix(value, id) {
    if (!Array.isArray(value.coverage)) { missing(`MISSING_EVIDENCE:${id}:coverage`); return; }
    const rows = value.coverage, ids = rows.map(row => row?.id);
    if (rows.length !== contractIds.length || new Set(ids).size !== rows.length || ids.some(name => !contractIds.includes(name))) {
      fail('INVALID_CONTRACT_MATRIX_COVERAGE');
    }
    let rejected = 0;
    for (const name of contractIds) {
      const row = rows.find(entry => entry?.id === name), label = `${id}:${name}`;
      if (!row) { missing(`MISSING_CONTRACT_CASE:${name}`); continue; }
      field(row, 'reads', integer, label);
      field(row, 'storage', Array.isArray, label);
      if (row.status === 'PASS') {
        field(row, 'reads', positive, label);
        if (!Array.isArray(row.storage) || row.storage.length || row.sqlState || row.constraint) fail(`STORAGE_MISLABELLED_READ_PASS:${name}`);
      } else if (row.status === 'EXPECTED_STORAGE_REJECTION') {
        rejected++;
        const origin = name === 'authorization-trace', unicode = name === 'canonical-input';
        if (!origin && !unicode) { fail(`UNAPPROVED_STORAGE_REJECTION:${name}`); continue; }
        if (!Array.isArray(row.storage) || !row.storage.length) { missing(`MISSING_STORAGE_REJECTION:${name}`); continue; }
        if (origin) {
          expected(row, { sqlState: '23514', constraint: 'application_exact_origin' }, label);
          for (const entry of row.storage) expected(entry, { sqlState: '23514', constraint: 'application_exact_origin', category: 'IMPOSSIBLE_ORIGIN_FIXTURE' }, label);
        } else {
          field(row, 'sqlState', state => unicodeStates.has(state), label);
          field(row, 'reads', positive, label); // The earlier NFC read is exercised before the lone surrogate.
          if (row.constraint) fail(`UNEXPECTED_STORAGE_CONSTRAINT:${name}`);
          for (const entry of row.storage) {
            field(entry, 'sqlState', state => unicodeStates.has(state), label);
            expected(entry, { category: 'INVALID_UNICODE_STORAGE' }, label);
            if (entry?.constraint) fail(`UNEXPECTED_STORAGE_CONSTRAINT:${name}`);
          }
          if (!row.storage.some(entry => entry?.sqlState === row.sqlState)) fail(`STORAGE_SQLSTATE_MISMATCH:${name}`);
        }
      } else if (row.status === 'NOT_RUN') missing(`CONTRACT_CASE_NOT_RUN:${name}`);
      else fail(`CONTRACT_CASE_FAILED:${name}`);
    }
    expected(value, { completeReadCoverage: rejected === 0 && rows.every(row => row?.status === 'PASS'),
      expectedStorageRejections: rejected, reason: rejected ? 'EXPECTED_STORAGE_REJECTION_IS_NOT_READ_COVERAGE' : null }, id);
  }
  function repositoryEvidence(id, value) {
    expected(value, { scope }, id);
    if (id === 'repository.roles-rls') {
      field(value, 'sessions', sessions => Array.isArray(sessions) && sessions.length === 2, id);
      if (Array.isArray(value.sessions)) for (const session of value.sessions) {
        expected(session, { limitedLogin: true, forcedRls: true, foreignRows: 0, ownPartnerRows: 1,
          foreignPartnerRows: 0, mismatchedWriteSqlState: '42501' }, id);
        field(session, 'ownRows', positive, id);
      }
    } else if (id === 'repository.cross-tenant-connect') expected(value, { rejectedConnections: 2, sqlState: '42501' }, id);
    else if (id === 'repository.equivalence') {
      expected(value, { candidates: 101, cursorsAcceptedBothDirections: true }, id);
      field(value, 'responseDigest', digest => typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest), id);
      field(value, 'responseBytes', positive, id);
    } else if (id === 'repository.collation') expected(value, { zeroComparisonPairs: 3, idTiebreakerPreserved: true }, id);
    else if (id === 'repository.contract-matrix') matrix(value, id);
    else if (id.startsWith('snapshot.')) {
      expected(value, { writerCommitted: true, independentWriter: true, capturedExpectedVersion: true,
        nextRequestSeesCommit: true, activeRemovalCaptured: true }, id);
      const fields = ['body', 'people', 'application_title', 'application_status', 'opportunity_title', 'updatedAt'];
      field(value, 'projectedFields', actual => Array.isArray(actual) && actual.length === fields.length &&
        new Set(actual).size === fields.length && fields.every(name => actual.includes(name)), id);
    }
    else if (id === 'cleanup.disconnect') expected(value, { backendTerminated: true,
      verification: 'PG_STAT_ACTIVITY_BACKEND_ABSENCE_NOT_FOREIGN_PG_CURSORS' }, id);
    else if (id === 'cleanup.session-reuse') expected(value, {
      samePhysicalSession: true, crossOrganizationGucReturnsNoRows: true, tenantDatabaseUnchanged: true }, id);
    else if (id.startsWith('cleanup.')) {
      field(value, 'requestPid', positive, id); field(value, 'observedPid', pid => positive(pid) && pid === value.requestPid, id);
      expected(value, { portals: 0, roleReset: true, rollbackObserved: id !== 'cleanup.success',
        errorCode: id === 'cleanup.success' ? null : id === 'cleanup.local-error' ? 'INVALID_CURSOR' : 'SERVICE_UNAVAILABLE' }, id);
      if (['cleanup.sql-abort', 'cleanup.cancel'].includes(id)) expected(value, {
        injectedFault: true, injectedSqlState: id === 'cleanup.cancel' ? '57014' : '22012' }, id);
    }
  }
  function authorityEvidence(id, value) {
    if (id.startsWith('membership-') || id.startsWith('policy-') || id === 'session-revoked') {
      const policyCase = id.startsWith('policy-');
      expected(value, { refusalCode: policyCase ? 'AUTHORITY_UNAVAILABLE' : 'AUTHORITY_REQUIRED',
        authorityFailure: policyCase ? null : id === 'session-revoked' ? 'SESSION_INVALID' : 'MEMBERSHIP_INVALID' }, id);
    }
    if (id.endsWith('-authority-first')) expected(value, {
      authorizedBefore: true, writerCommittedBeforeRead: true, successfulRead: false, realCentralWriter: true }, id);
    else if (id.endsWith('-guard-first')) expected(value, { realCentralWriter: true, writerWaitObserved: true,
      committedBeforeRelease: false, firstReadSucceeded: true, nextReadRefused: true, durableAudit: true }, id);
    else if (id === 'session-revoked') expected(value, { authorizedBefore: true, realSessionRegistry: true, successfulRead: false }, id);
    else if (id === 'team-before-read') expected(value, { removalThroughApplicationService: true, resultTotal: 0 }, id);
    else if (id === 'team-during-unseen-resource') expected(value, { writerKind: 'synthetic-direct-team-update',
      realReaderAuthorityAndAudit: true, changedUnseenResource: true, resultTotal: 1 }, id);
    else if (id === 'team-cache-hit') expected(value, { writerKind: 'synthetic-direct-team-update', existingCacheSemanticsPreserved: true,
      applicationPortCalls: 2, actualTeamQueries: 2, firstResultTotal: 2, nextResultTotal: 0 }, id);
    else if (id === 'audit-failure') {
      expected(value, { realPostgresFault: true, successfulRead: false, partialAuditRows: 0, activeLeases: 0, injectedSqlState: '22012' }, id);
      // Observed runtime refusal is recorded; the injected PostgreSQL fault and
      // rolled-back ledger establish this case, not an asserted authorization denial.
      field(value, 'refusalCode', code => typeof code === 'string' && /^[A-Z0-9_]{2,80}$/.test(code), id);
    }
  }
  for (const [group, value, validate] of [['repository', repository, repositoryEvidence], ['authority', authority, authorityEvidence]]) {
    if (!record(value)) { missing(`MISSING_PROBE_GROUP:${group}`); continue; }
    expected(value, { environmentVerified: true }, group);
    if (!Array.isArray(value.cases)) { missing(`MISSING_PROBE_CASES:${group}`); continue; }
    const required = policy.requiredCases[group], ids = value.cases.map(item => item?.id);
    if (ids.length !== required.length || new Set(ids).size !== ids.length || ids.some(id => !required.includes(id))) fail(`INVALID_PROBE_COVERAGE:${group}`);
    for (const id of required) {
      const item = value.cases.find(entry => entry?.id === id);
      if (!item || item.status === 'NOT_RUN') { missing(`PROBE_NOT_RUN:${id}`); continue; }
      if (item.status !== 'PASS') { fail(`PROBE_FAILED:${id}`); continue; }
      if (!record(item.evidence)) { missing(`MISSING_PROBE_EVIDENCE:${id}`); continue; }
      validate(id, item.evidence);
    }
  }
  return { failures: [...new Set(failures)], incomplete: [...new Set(incomplete)] };
}

module.exports = { evaluateProbeEvidence };
