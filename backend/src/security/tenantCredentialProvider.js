const OPAQUE_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const { tenantFailure } = require('./tenantRuntimeErrors');
const {requireTenantWorkload}=require('./tenantWorkload');

function createTenantCredentialProvider(adapter) {
  if (!adapter || typeof adapter.resolve !== 'function') {
    throw new TypeError('Tenant credential adapter is unavailable.');
  }
  return Object.freeze({
    async resolve({ credentialRef, tenantId, workload,connectionVersion, correlationId }) {
      requireTenantWorkload(workload);
      if (!OPAQUE_REF.test(credentialRef || '') || typeof tenantId !== 'string'
          || !Number.isSafeInteger(connectionVersion) || connectionVersion <= 0) {
        throw new TypeError('Tenant credential request is invalid.');
      }
      let resolved;
      try {
        resolved = await adapter.resolve(Object.freeze({ credentialRef, tenantId, workload,connectionVersion, correlationId }));
      } catch {
        throw tenantFailure('CREDENTIAL_UNAVAILABLE', 'TENANT_NOT_AVAILABLE', { correlationId });
      }
      if (!resolved || typeof resolved !== 'object' || !('material' in resolved)
          || typeof resolved.dispose !== 'function') {
        throw new TypeError('Tenant credential adapter returned an invalid result.');
      }
      let disposed = false;
      return Object.freeze({
        workload,
        material: resolved.material,
        async dispose() {
          if (disposed) return;
          disposed = true;
          try { await resolved.dispose(); }
          catch { throw tenantFailure('CREDENTIAL_CLEANUP_FAILED', 'TENANT_OPERATION_UNAVAILABLE', { correlationId }); }
        }
      });
    }
  });
}

module.exports = { createTenantCredentialProvider };
