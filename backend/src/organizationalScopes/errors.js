'use strict';

const PUBLIC = Object.freeze({
  ORGANIZATIONAL_SCOPE_INVALID_INPUT: 'INVALID_INPUT',
  ORGANIZATIONAL_SCOPE_NOT_AVAILABLE: 'RESOURCE_NOT_AVAILABLE',
  ORGANIZATIONAL_SCOPE_STATE_CONFLICT: 'STATE_CONFLICT',
  ORGANIZATIONAL_SCOPE_STALE_REVISION: 'STALE_REVISION',
  ORGANIZATIONAL_SCOPE_IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  ORGANIZATIONAL_SCOPE_DEPENDENCY_CONFLICT: 'DEPENDENCY_CONFLICT',
  ORGANIZATIONAL_SCOPE_INCOMPATIBLE: 'INCOMPATIBLE_VERSION',
  ORGANIZATIONAL_SCOPE_PERSISTENCE_UNAVAILABLE: 'PERSISTENCE_UNAVAILABLE'
});

class OrganizationalScopeError extends Error {
  constructor(code) {
    super(PUBLIC[code] || 'PERSISTENCE_UNAVAILABLE');
    this.name = 'OrganizationalScopeError';
    this.code = code;
    this.publicCode = PUBLIC[code] || 'PERSISTENCE_UNAVAILABLE';
  }
}

function mapDatabaseError(error) {
  if (error instanceof OrganizationalScopeError) return error;
  if (error && error.code === '23505') return new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_STATE_CONFLICT');
  if (error && ['40001', '40P01'].includes(error.code)) return new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_STATE_CONFLICT');
  return new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_PERSISTENCE_UNAVAILABLE');
}

function aggregateOrganizationalScopeFailures(primary, cleanupFailures) {
  const aggregate = new AggregateError(
    [primary, ...cleanupFailures],
    'Organizational scope operation and transaction cleanup could not be completed safely.',
    { cause: primary }
  );
  aggregate.name = 'OrganizationalScopeAggregateError';
  aggregate.code = 'ORGANIZATIONAL_SCOPE_TRANSACTION_CLEANUP_FAILED';
  aggregate.publicCode = 'PERSISTENCE_UNAVAILABLE';
  return aggregate;
}

module.exports = { OrganizationalScopeError, aggregateOrganizationalScopeFailures, mapDatabaseError };
