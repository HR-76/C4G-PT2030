'use strict';

const { tenantFailure } = require('./tenantRuntimeErrors');

function sameSnapshot(left, right) {
  return Boolean(right)
    && left.organizationId === right.organizationId
    && left.tenantId === right.tenantId
    && left.workload === right.workload
    && left.connectionVersion === right.connectionVersion
    && left.connectionRevision === right.connectionRevision
    && left.bindingDigest === right.bindingDigest
    && left.databaseGenerationId === right.databaseGenerationId
    && left.databaseRef === right.databaseRef
    && left.credentialRef === right.credentialRef
    && left.observedSystemIdentifier === right.observedSystemIdentifier
    && left.fence === right.fence
    && left.schema.revision === right.schema.revision
    && left.schema.schemaFingerprint === right.schema.schemaFingerprint
    && JSON.stringify(left.schema.verifiedCapabilities) === JSON.stringify(right.schema.verifiedCapabilities)
    && left.schema.currentVersion === right.schema.currentVersion
    && left.schema.compatibilityState === right.schema.compatibilityState
    && right.connectionState === 'AVAILABLE'
    && right.versionState === 'VALIDATED'
    && right.provisioningStatus === 'READY'
    && ['COMPATIBLE', 'READ_ONLY'].includes(right.schema.compatibilityState);
}

function validateOperationValue(schema, value, internalCode, correlationId) {
  if (!schema) return;
  let valid = false;
  try { valid = schema.validate(value) === true; } catch { valid = false; }
  if (!valid) throw tenantFailure(internalCode, 'TENANT_OPERATION_UNAVAILABLE', { correlationId });
}

function enforceResultLimits(operation, result, correlationId) {
  if (!operation.limits) return;
  const rows = Array.isArray(result) ? result.length
    : (result && Array.isArray(result.rows) ? result.rows.length : 1);
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(result), 'utf8'); }
  catch { throw tenantFailure('RESULT_CONTRACT_MISMATCH', 'TENANT_OPERATION_UNAVAILABLE', { correlationId }); }
  if (rows > operation.limits.maxRows || bytes > operation.limits.maxBytes) {
    throw tenantFailure('RESULT_LIMIT_EXCEEDED', 'TENANT_OPERATION_UNAVAILABLE', { correlationId });
  }
}

module.exports = { sameSnapshot, validateOperationValue, enforceResultLimits };
