const { createTenantLeaseExecutor } = require('./tenantLeaseExecutor');
const { createTenantResolver } = require('./tenantResolver');

function createTenantRuntime(dependencies) {
  const leaseExecutor = createTenantLeaseExecutor(dependencies);
  const resolver = createTenantResolver({ ...dependencies, leaseExecutor });
  return Object.freeze({
    resolve: resolver.resolve,
    drainVersion: dependencies.poolManager.drainVersion,
    revokeVersion: dependencies.poolManager.revokeVersion,
    blockTenant: dependencies.poolManager.blockTenant,
    allowTenant: dependencies.poolManager.allowTenant,
    snapshot: dependencies.poolManager.snapshot,
    close: dependencies.poolManager.closeAll
  });
}

module.exports = { createTenantRuntime };
