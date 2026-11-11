'use strict';
const { types: { isProxy, isNativeError } } = require('node:util');
const { isTenantMigrationFailure } = require('../../../backend/src/security/tenantMigrationErrors');

// Finite source-backed identifiers, never prefixes or arbitrary error text.
// tenantMigrationRunner.js (including its finite stage/timeout codes) and
// tenantMigrationPreflight.js issue branded errors with non-enumerable internalCode.
const migrationCodes = new Set([
  'TENANT_MIGRATION_OWNER_MISMATCH', 'TENANT_MIGRATION_FAILED', 'CENTRAL_OBSERVATION_FAILED',
  'CENTRAL_OBSERVATION_TIMEOUT', 'RECONCILIATION_REQUIRED', 'TENANT_POSTCHECK_TIMEOUT',
  'TENANT_MIGRATION_CONNECT_TIMEOUT', 'LOCK_CONFLICT', 'TENANT_BASELINE_AMBIGUOUS',
  'TENANT_LEDGER_MISMATCH', 'TENANT_SCHEMA_FINGERPRINT_MISMATCH', 'TENANT_DOWNGRADE_BASELINE_MISMATCH',
  'MIGRATION_CHECKSUM_MISMATCH', 'TENANT_UPGRADE_INCOMPLETE', 'TENANT_MIGRATION_ROLLBACK_FAILED',
  'TENANT_MIGRATION_CLIENT_CLEANUP_FAILED', 'POSTCHECK_FAILED',
  ...['CONNECT', 'BEGIN', 'PREFLIGHT', 'DOWNGRADE_SQL', 'LEDGER', 'DATABASE_CONTRACT', 'MIGRATION_SQL', 'MARKER', 'COMMIT']
    .map(stage => `TENANT_MIGRATION_${stage}_FAILED`),
  'POSTGRES_VERSION_MISMATCH', 'DATABASE_CONFIGURATION_MISMATCH', 'EXTENSION_ALLOWLIST_MISMATCH',
  'ROLE_CONTRACT_MISMATCH', 'OBJECT_OWNER_MISMATCH', 'PRIVILEGE_CONTRACT_MISMATCH', 'SEARCH_PATH_MISMATCH',
  'CAPABILITY_EVIDENCE_MISMATCH', 'UNEXPECTED_SCHEMA', 'TENANT_MARKER_AMBIGUOUS', 'TENANT_MARKER_MISMATCH',
  'TENANT_LEDGER_EMPTY', 'TENANT_VERSION_UNKNOWN', 'TENANT_SCHEMA_SHAPE_MISMATCH', 'PHYSICAL_IDENTITY_UNAVAILABLE',
  'TENANT_PREFLIGHT_FAILED', 'TENANT_PREFLIGHT_CLIENT_CLEANUP_FAILED', 'TENANT_PREFLIGHT_ROLLBACK_FAILED'
]);
// platformOnboarding/contracts.js + postgresProvisioner.js use .code;
// tenantRepositorySupport.js exposes only these two directory domain codes.
const provisioningCodes = new Set(['ONBOARDING_INPUT_INVALID', 'PROVISIONING_IDENTIFIER_INVALID',
  'PROVISIONING_OWNERSHIP_CONFLICT', 'PROVISIONING_DIRECTORY_MISMATCH', 'PROVISIONING_LOGIN_INVALID', 'PROVISIONING_INTENT_CONFLICT']);
const directoryCodes = new Set(['TRANSITION_CONFLICT', 'COMMITTED_CLEANUP_FAILED']);
// Legacy helpers below use Error('FIXED_IDENTIFIER') without .code. Compare only
// exact own data messages from native Error objects and return a known constant.
// Never include free text or interpolate a message into the result.
// Sources: localTenantIdentityProvisioner.js and tenantWorkloadDirectoryRepository.js.
const identityMessages = new Set(['LOCAL_IDENTITY_ROLE_MISSING', 'LOCAL_IDENTITY_ATTRIBUTE_DRIFT',
  'LOCAL_IDENTITY_UNEXPECTED_MEMBERSHIP', 'LOCAL_IDENTITY_MEMBERSHIP_DRIFT', 'LOCAL_IDENTITY_MEMBERSHIP_MISSING',
  'LOCAL_IDENTITY_OBJECT_OWNERSHIP', 'LOCAL_IDENTITY_ROLE_CHAIN_INVALID', 'LOCAL_IDENTITY_INCOMPATIBLE',
  'METADATA_ROLES_MUST_REMAIN_NOLOGIN', 'UNSAFE_WORKLOAD_MEMBERSHIP', 'C4G_TENANT_RUNTIME_ALLOWLIST_UNPROVEN',
  'CROSS_WORKLOAD_MEMBERSHIP']);
const workloadMessages = new Set(['F44_CANDIDATE_CONFLICT', 'F44_VERSION_REGRESSION', 'F44_CANDIDATE_NOT_FOUND',
  'F44_INVALID_TRANSITION', 'F44_BINDING_NOT_FOUND', 'F44_PUBLISH_CONFLICT', 'F44_CANDIDATE_NOT_READY',
  'F44_PREVIOUS_VERSION_INVALID', 'F44_VERSION_NOT_FOUND']);
const sqlStates = new Set(['08006', '22023', '23502', '23503', '23505', '23514', '28P01', '3D000',
  '40001', '40P01', '42501', '42601', '42703', '42704', '42P01', '42P07', '53300', '57014']);
const connectionCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']);
const result = (classification = 'UNKNOWN', errorCode = null) => ({ classification, errorCode });
function object(value) { return value !== null && (typeof value === 'object' || typeof value === 'function') && !isProxy(value); }
function data(value, key) {
  if (!object(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}
function errorType(value) {
  if (!isNativeError(value)) return 'UNKNOWN';
  let prototype = Object.getPrototypeOf(value);
  for (let depth = 0; object(prototype) && depth < 8; depth++, prototype = Object.getPrototypeOf(prototype)) {
    if (prototype === TypeError.prototype) return 'TYPE_ERROR';
    if (prototype === RangeError.prototype) return 'RANGE_ERROR';
  }
  return 'UNKNOWN';
}

function classifySetupError(error) {
  let remainingCauses = 8;
  const ancestors = new Set();
  function visit(value, depth = 0) {
    if (!object(value)) return result();
    if (isTenantMigrationFailure(value)) {
      const internalCode = data(value, 'internalCode');
      if (internalCode !== undefined) return result('TENANT_MIGRATION', migrationCodes.has(internalCode) ? internalCode : null);
      const aggregate = { ...result('TENANT_MIGRATION_AGGREGATE'), causes: [], causesTruncated: false };
      const errors = data(value, 'errors');
      if (!Array.isArray(errors) || isProxy(errors) || depth >= 3) { aggregate.causesTruncated = true; return aggregate; }
      ancestors.add(value);
      try {
        const length = data(errors, 'length');
        for (let index = 0; index < length; index++) {
          if (remainingCauses === 0 || index >= 8) { aggregate.causesTruncated = true; break; }
          const child = data(errors, String(index));
          if (!object(child) || ancestors.has(child)) { aggregate.causesTruncated = true; continue; }
          remainingCauses--;
          aggregate.causes.push(visit(child, depth + 1));
        }
      } finally { ancestors.delete(value); }
      return aggregate;
    }
    const code = data(value, 'code');
    if (provisioningCodes.has(code)) return result('PROVISIONING', code);
    if (directoryCodes.has(code)) return result('TENANT_DIRECTORY', code);
    if (sqlStates.has(code)) return result('POSTGRESQL', code);
    if (connectionCodes.has(code)) return result('CONNECTION', code);
    if (code === 'MODULE_NOT_FOUND') return result('DEPENDENCY', code);
    if (code === 'ERR_ASSERTION') return result('ASSERTION', code);
    if (isNativeError(value)) {
      const message = data(value, 'message');
      if (identityMessages.has(message)) return result('LOCAL_IDENTITY', message);
      if (workloadMessages.has(message)) return result('WORKLOAD_DIRECTORY', message);
    }
    return result(errorType(value));
  }
  // Defensive boundary: diagnostics must not mask the original thrown object.
  try { return visit(error); } catch { return result(); }
}

module.exports = { classifySetupError };
