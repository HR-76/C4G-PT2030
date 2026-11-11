const schemaFailures = new WeakSet();
const schemaFailureAggregates = new WeakSet();

class TenantMigrationError extends Error {
  constructor() {
    super('Tenant schema operation could not be completed safely.');
    this.name = 'TenantMigrationError';
  }
}

function tenantMigrationFailure(internalCode) {
  const error = new TenantMigrationError();
  Object.defineProperty(error, 'internalCode', { value: internalCode, enumerable: false });
  schemaFailures.add(error);
  return error;
}

function isTenantMigrationFailure(error) {
  return schemaFailures.has(error) || schemaFailureAggregates.has(error);
}

function aggregateTenantMigrationFailures(primary, cleanupFailures) {
  const failures = [primary, ...cleanupFailures];
  if (!failures.every(isTenantMigrationFailure)) {
    throw new TypeError('Tenant migration aggregate input is invalid.');
  }
  const aggregate = new AggregateError(
    failures,
    'Tenant schema operation and cleanup could not be completed safely.'
  );
  aggregate.name = 'TenantMigrationAggregateError';
  schemaFailureAggregates.add(aggregate);
  return aggregate;
}

module.exports = {
  TenantMigrationError,
  aggregateTenantMigrationFailures,
  isTenantMigrationFailure,
  tenantMigrationFailure
};
