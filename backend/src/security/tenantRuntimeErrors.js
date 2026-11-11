const PUBLIC_CODES = Object.freeze(new Set([
  'TENANT_NOT_AVAILABLE', 'TENANT_READ_ONLY', 'TENANT_OPERATION_UNAVAILABLE'
]));
const runtimeFailures = new WeakSet();
const cleanupAggregates = new WeakSet();

class TenantRuntimeError extends Error {
  constructor(internalCode, publicCode = 'TENANT_OPERATION_UNAVAILABLE', options = {}) {
    if (!PUBLIC_CODES.has(publicCode)) throw new TypeError('Tenant public error code is invalid.');
    super('Tenant operation could not be completed safely.');
    this.name = 'TenantRuntimeError';
    this.code = publicCode;
    Object.defineProperty(this, 'internalCode', { value: internalCode, enumerable: false });
    Object.defineProperty(this, 'correlationId', { value: options.correlationId || null, enumerable: false });
  }
}

function tenantFailure(internalCode, publicCode, options) {
  const error = new TenantRuntimeError(internalCode, publicCode, options);
  runtimeFailures.add(error);
  return error;
}

function aggregateCleanup(primary, cleanup, message = 'Tenant operation and cleanup failed.') {
  const aggregate = new AggregateError([primary, cleanup], message, { cause: primary });
  if (isTrustedRuntimeFailure(primary) && isTrustedRuntimeFailure(cleanup)) cleanupAggregates.add(aggregate);
  return aggregate;
}

function isTrustedRuntimeFailure(error) {
  return runtimeFailures.has(error) || cleanupAggregates.has(error);
}

module.exports = { PUBLIC_CODES, TenantRuntimeError, aggregateCleanup, isTrustedRuntimeFailure, tenantFailure };
