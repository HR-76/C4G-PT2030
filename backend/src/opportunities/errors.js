'use strict';

const CODES = Object.freeze(['OPPORTUNITY_AUTHORIZATION_REQUIRED', 'OPPORTUNITY_UNAVAILABLE', 'OPPORTUNITY_INVALID_INPUT', 'OPPORTUNITY_LIMIT_EXCEEDED', 'OPPORTUNITY_UNKNOWN_FIELD', 'OPPORTUNITY_INVALID_STATE', 'OPPORTUNITY_STALE_REVISION', 'OPPORTUNITY_IDENTITY_REUSED', 'OPPORTUNITY_DIGEST_MISMATCH', 'OPPORTUNITY_CATALOG_INVALID', 'OPPORTUNITY_NOT_FOUND', 'OPPORTUNITY_PERSISTENCE_CONFLICT', 'OPPORTUNITY_DATABASE_UNAVAILABLE', 'OPPORTUNITY_CURSOR_INVALID']);
class OpportunityError extends Error {
  constructor(code) { super('Opportunity operation failed.'); if (!CODES.includes(code)) throw new TypeError('Opportunity error code is invalid.'); this.name = 'OpportunityError'; this.code = code; }
}
function sanitizeError(error) { return Object.freeze({ code: error instanceof OpportunityError ? error.code : 'OPPORTUNITY_INVALID_INPUT' }); }
module.exports = { CODES, OpportunityError, sanitizeError };
