const { tenantFailure } = require('./tenantRuntimeErrors');

function createTenantBindingVerifier(adapter) {
  if (!adapter || typeof adapter.observe !== 'function') {
    throw new TypeError('Tenant binding verifier adapter is unavailable.');
  }
  return Object.freeze({
    async verify({ client, snapshot, requiredCapabilities, correlationId, phase='TRANSACTION' }) {
      let observed;
      try { observed = await adapter.observe({ client, snapshot, correlationId, phase }); }
      catch { throw tenantFailure('TENANT_UNREACHABLE', 'TENANT_NOT_AVAILABLE', { correlationId }); }
      const valid = observed && observed.tenantId === snapshot.tenantId
        && observed.databaseGenerationId === snapshot.databaseGenerationId
        && observed.systemIdentifier === snapshot.observedSystemIdentifier
        && observed.bindingDigest === snapshot.bindingDigest
        && observed.schemaVersion === snapshot.schema.currentVersion
        && observed.schemaFingerprint === snapshot.schema.schemaFingerprint
        && Array.isArray(observed.capabilities)
        && requiredCapabilities.every(code => observed.capabilities.includes(code));
      if (!valid) throw tenantFailure('PHYSICAL_TENANT_MISMATCH', 'TENANT_NOT_AVAILABLE', { correlationId });
      return Object.freeze({ verified: true });
    }
  });
}

module.exports = { createTenantBindingVerifier };
