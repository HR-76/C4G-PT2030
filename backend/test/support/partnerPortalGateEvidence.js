'use strict';

// Synthetic validator inputs only. Never persisted as PostgreSQL execution
// evidence or used to replace the executable probes.
const contractIds = ['ordered-pages', 'empty-and-last-page', 'countries-before-filters', 'literal-search-fields',
  'projection', 'authorization-trace', 'error-precedence', 'digest-golden', 'cursor-binding', 'cursor-expiration-and-position',
  'unseen-mutation', 'membership-between-pages', 'excluded-changes', 'fresh-authority', 'canonical-input', 'raw-limit'];
function validProbeEvidence() {
  const scope = 'REAL_POSTGRESQL_REPOSITORY_WITH_CONTROLLED_AUTHORITY_PORTS';
  const repositoryCases = [
    ['repository.roles-rls', { sessions: [0, 1].map(() => ({ limitedLogin: true, forcedRls: true, ownRows: 1, foreignRows: 0,
      ownPartnerRows: 1, foreignPartnerRows: 0, mismatchedWriteSqlState: '42501' })) }],
    ['repository.cross-tenant-connect', { rejectedConnections: 2, sqlState: '42501' }],
    ['repository.equivalence', { responseDigest: 'a'.repeat(64), responseBytes: 100, candidates: 101, cursorsAcceptedBothDirections: true }],
    ['repository.collation', { zeroComparisonPairs: 3, idTiebreakerPreserved: true }],
    ['repository.contract-matrix', { coverage: contractIds.map(id => ({ id, status: 'PASS', reads: 1, storage: [] })),
      completeReadCoverage: true, expectedStorageRejections: 0, reason: null }],
    ...['before-declare', 'after-declare', 'between-fetches'].map(point => [`snapshot.${point}`, {
      writerCommitted: true, independentWriter: true, capturedExpectedVersion: true, nextRequestSeesCommit: true,
      activeRemovalCaptured: true, projectedFields: ['body', 'people', 'application_title', 'application_status', 'opportunity_title', 'updatedAt'] }]),
    ...['success', 'local-error', 'sql-abort', 'cancel'].map(phase => [`cleanup.${phase}`, { requestPid: 123, observedPid: 123,
      portals: 0, roleReset: true, errorCode: phase === 'success' ? null : phase === 'local-error' ? 'INVALID_CURSOR' : 'SERVICE_UNAVAILABLE',
      rollbackObserved: phase !== 'success', ...(['sql-abort', 'cancel'].includes(phase) ? { injectedFault: true,
        injectedSqlState: phase === 'sql-abort' ? '22012' : '57014' } : {}) }]),
    ['cleanup.disconnect', { backendTerminated: true, verification: 'PG_STAT_ACTIVITY_BACKEND_ABSENCE_NOT_FOREIGN_PG_CURSORS' }],
    ['cleanup.session-reuse', { samePhysicalSession: true, crossOrganizationGucReturnsNoRows: true, tenantDatabaseUnchanged: true }]
  ].map(([id, evidence]) => ({ id, status: 'PASS', evidence: { scope, ...evidence } }));
  const authorityCases = [
    ...['membership', 'policy'].flatMap(kind => [
      [`${kind}-authority-first`, { authorizedBefore: true, writerCommittedBeforeRead: true, successfulRead: false, realCentralWriter: true,
        refusalCode: kind === 'membership' ? 'AUTHORITY_REQUIRED' : 'AUTHORITY_UNAVAILABLE',
        authorityFailure: kind === 'membership' ? 'MEMBERSHIP_INVALID' : null }],
      [`${kind}-guard-first`, { realCentralWriter: true, writerWaitObserved: true, committedBeforeRelease: false,
        firstReadSucceeded: true, nextReadRefused: true, durableAudit: true,
        refusalCode: kind === 'membership' ? 'AUTHORITY_REQUIRED' : 'AUTHORITY_UNAVAILABLE',
        authorityFailure: kind === 'membership' ? 'MEMBERSHIP_INVALID' : null }]
    ]),
    ['session-revoked', { authorizedBefore: true, realSessionRegistry: true, successfulRead: false,
      refusalCode: 'AUTHORITY_REQUIRED', authorityFailure: 'SESSION_INVALID' }],
    ['team-before-read', { removalThroughApplicationService: true, resultTotal: 0 }],
    ['team-during-unseen-resource', { writerKind: 'synthetic-direct-team-update', realReaderAuthorityAndAudit: true,
      changedUnseenResource: true, resultTotal: 1 }],
    ['team-cache-hit', { writerKind: 'synthetic-direct-team-update', existingCacheSemanticsPreserved: true,
      applicationPortCalls: 2, actualTeamQueries: 2, firstResultTotal: 2, nextResultTotal: 0 }],
    ['audit-failure', { realPostgresFault: true, successfulRead: false, partialAuditRows: 0, activeLeases: 0,
      injectedSqlState: '22012', refusalCode: '22012' }]
  ].map(([id, evidence]) => ({ id, status: 'PASS', evidence }));
  return { repository: { environmentVerified: true, cases: repositoryCases }, authority: { environmentVerified: true, cases: authorityCases } };
}
module.exports = { validProbeEvidence };
