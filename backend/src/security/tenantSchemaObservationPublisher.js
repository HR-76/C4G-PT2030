const { manifest, allRegisteredMigrations } = require('./tenantMigrationManifest');

function createTenantSchemaObservationPublisher(repository) {
  if (!repository || typeof repository.recordObservation !== 'function') {
    throw new TypeError('Tenant schema observation repository is invalid.');
  }
  return Object.freeze({
    async publish({ expectedRevision, correlationId, idempotencyKey, evidence }) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1
          || typeof correlationId !== 'string' || correlationId.length === 0
          || typeof idempotencyKey !== 'string' || idempotencyKey.length === 0
          || !evidence || typeof evidence.currentVersion !== 'string') {
        throw new TypeError('Tenant schema observation input is invalid.');
      }
      const entry = allRegisteredMigrations.find(candidate => candidate.version === evidence.currentVersion);
      if (!entry || evidence.schemaFingerprint !== entry.schemaFingerprint
          || entry.ordinal > manifest.at(-1).ordinal && !require('./tenantMigrationPreflight').isTenantCapabilityEvidence(evidence)
          || !Array.isArray(evidence.capabilities)
          || evidence.capabilities.length !== entry.capabilities.length
          || entry.capabilities.some(code => !evidence.capabilities.includes(code))) {
        throw new TypeError('Tenant schema observation evidence is invalid.');
      }
      const verifiedCapabilities = Object.freeze(Object.fromEntries([
        ...entry.capabilities.map(code => [code, true]), ['schemaFingerprint', evidence.schemaFingerprint]
      ]));
      return repository.recordObservation({
        tenantId: evidence.tenantId,
        expectedRevision,
        compatibilityState: 'COMPATIBLE',
        currentVersion: evidence.currentVersion,
        targetVersion: entry.ordinal > manifest.at(-1).ordinal ? entry.version : manifest.at(-1).version,
        minimumReadVersion: entry.compatibility.readVersions[0],
        minimumWriteVersion: entry.compatibility.writeVersions[0],
        verifiedCapabilities,
        migrationLockRef: null,
        lockExpiresAt: null,
        lastErrorCode: null,
        correlationId,
        idempotencyKey
      });
    }
  });
}

module.exports = { createTenantSchemaObservationPublisher };
