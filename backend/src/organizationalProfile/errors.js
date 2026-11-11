'use strict';

const PUBLIC_CODES = Object.freeze([
  'F13_AUTHORIZATION_REQUIRED',
  'F13_DIGEST_MISMATCH',
  'F13_INCOMPATIBLE_VERSION',
  'F13_IDEMPOTENCY_CONFLICT',
  'F13_INVALID_INPUT',
  'F13_LIMIT_EXCEEDED',
  'F13_REFERENCE_INCOMPATIBLE',
  'F13_DOCUMENT_REQUIRED',
  'F13_PROVENANCE_UNRESOLVED',
  'F13_SOURCE_INTEGRITY_UNAVAILABLE',
  'F13_AUTHORSHIP_EVIDENCE_UNAVAILABLE',
  'F13_POLICY_UNAVAILABLE',
  'F13_COMPLETION_INCOMPLETE',
  'F13_APPROVAL_STALE',
  'F13_PERSISTENCE_UNAVAILABLE',
  'F13_RESOURCE_NOT_AVAILABLE',
  'F13_STATE_CONFLICT',
  'F13_STALE_REVISION',
  'F13_UNKNOWN_FIELD'
]);

class OrganizationalProfileContractError extends Error {
  constructor(code = 'F13_INVALID_INPUT') {
    if (!PUBLIC_CODES.includes(code)) code = 'F13_INVALID_INPUT';
    super('Organizational profile contract rejected.');
    this.name = 'OrganizationalProfileContractError';
    this.code = code;
  }
}

module.exports = { OrganizationalProfileContractError, PUBLIC_CODES };
