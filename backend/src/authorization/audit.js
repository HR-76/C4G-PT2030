const AUDIT_CLASSES = Object.freeze({
  CRITICAL: 'CRITICAL_PRE_EFFECT',
  DENY: 'DENY_PRESERVING',
  OBSERVATIONAL: 'OBSERVATIONAL_RECONCILABLE',
  OUTSIDE: 'OUTSIDE_F5'
});

const EVENT_CATALOG = Object.freeze({
  AUTHORIZATION_ALLOWED: AUDIT_CLASSES.OBSERVATIONAL,
  AUTHORIZATION_DENIED: AUDIT_CLASSES.DENY,
  AUTHORIZATION_POLICY_INVALID: AUDIT_CLASSES.DENY,
  AUTHORIZATION_MFA_REQUIRED: AUDIT_CLASSES.DENY,
  AUTHORIZATION_VERSION_ADVANCED: AUDIT_CLASSES.OBSERVATIONAL,
  GRANT_CHANGED: AUDIT_CLASSES.CRITICAL,
  PROFILE_CHANGED: AUDIT_CLASSES.CRITICAL,
  SOD_CHANGED: AUDIT_CLASSES.CRITICAL,
  SENSITIVE_ACTION_ALLOWED: AUDIT_CLASSES.CRITICAL,
  SUPPORT_GRANTED: AUDIT_CLASSES.CRITICAL,
  SUPPORT_STARTED: AUDIT_CLASSES.CRITICAL,
  SUPPORT_USED: AUDIT_CLASSES.CRITICAL,
  SUPPORT_REVOKED: AUDIT_CLASSES.CRITICAL,
  SUPPORT_EXPIRED: AUDIT_CLASSES.OBSERVATIONAL,
  SERVICE_JOB_DISPATCHED: AUDIT_CLASSES.CRITICAL,
  SERVICE_JOB_COMPLETED: AUDIT_CLASSES.OBSERVATIONAL,
  EXPORT_ALLOWED: AUDIT_CLASSES.CRITICAL,
  EXPORT_COMPLETED: AUDIT_CLASSES.OBSERVATIONAL,
  DOCUMENT_ALLOWED: AUDIT_CLASSES.CRITICAL,
  DOCUMENT_COMPLETED: AUDIT_CLASSES.OBSERVATIONAL,
  DOCUMENT_UPLOAD_INTENT_ACCEPTED: AUDIT_CLASSES.CRITICAL,
  DOCUMENT_UPLOAD_CONFIRMED: AUDIT_CLASSES.OBSERVATIONAL,
  DOCUMENT_SCAN_COMPLETED: AUDIT_CLASSES.OBSERVATIONAL,
  DOCUMENT_ACCESS_CAPABILITY_ISSUED: AUDIT_CLASSES.CRITICAL,
  DOCUMENT_VERSION_CREATED: AUDIT_CLASSES.CRITICAL,
  DOCUMENT_ACCESS_BLOCKED: AUDIT_CLASSES.DENY,
  DOCUMENT_RECONCILIATION_DETECTED: AUDIT_CLASSES.OBSERVATIONAL,
  DOCUMENT_UPLOAD_CANCELLED: AUDIT_CLASSES.OBSERVATIONAL,
  DOCUMENT_LIFECYCLE_REQUESTED: AUDIT_CLASSES.CRITICAL
});

const ALLOWED_FIELDS = Object.freeze([
  'eventId', 'schemaVersion', 'occurredAt', 'eventType', 'actorType', 'actorId', 'membershipId',
  'serviceExecutionId', 'organizationId', 'operationCode', 'permissionCode', 'resourceType',
  'resourceId', 'scopeType', 'scopeDigest', 'result', 'reasonCode', 'catalogVersion',
  'policyVersion', 'membershipVersion', 'authorizationVersion', 'correlationId', 'assuranceLevel'
]);
const allowedFieldSet = new Set(ALLOWED_FIELDS);

function sanitizeAuditEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('Audit event is invalid.');
  if (!Object.prototype.hasOwnProperty.call(EVENT_CATALOG, event.eventType)) {
    throw new TypeError('Audit event is not allowlisted.');
  }
  const required = ['eventId', 'schemaVersion', 'occurredAt', 'eventType', 'actorType', 'actorId',
    'organizationId', 'operationCode', 'permissionCode', 'result', 'reasonCode', 'correlationId'];
  if (required.some(key => typeof event[key] !== 'string' || event[key].length === 0)) {
    throw new TypeError('Audit event is missing required allowlisted evidence.');
  }
  const keys = Reflect.ownKeys(event);
  if (Object.hasOwn(event, 'assuranceLevel') && !['SESSION', 'RECENT_MFA'].includes(event.assuranceLevel)) {
    throw new TypeError('Audit assurance level is invalid.');
  }
  if (keys.some(key => typeof key !== 'string' || !allowedFieldSet.has(key))) {
    throw new TypeError('Audit event contains a forbidden field.');
  }
  const sanitized = {};
  for (const key of keys) {
    const value = event[key];
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) sanitized[key] = value;
    else throw new TypeError('Audit event values must be scalar.');
  }
  return Object.freeze(sanitized);
}

function createAuditCoordinator({ port, timeoutMs, scheduler = { setTimeout, clearTimeout } }) {
  if (!port || typeof port.accept !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('Audit coordinator configuration is invalid.');
  }
  async function accept(event) {
    const sanitized = sanitizeAuditEvent(event);
    let timer;
    const timeout = new Promise(resolve => { timer = scheduler.setTimeout(() => resolve('TIMEOUT'), timeoutMs); });
    try {
      const outcome = await Promise.race([Promise.resolve().then(() => port.accept(sanitized)), timeout]);
      // Pending is explicitly NOT durable acceptance. Only read observations may
      // be staged by their transaction owner, which must flush before commit.
      if (outcome === 'TRANSACTION_PENDING' && EVENT_CATALOG[sanitized.eventType] === AUDIT_CLASSES.OBSERVATIONAL)
        return 'TRANSACTION_PENDING';
      return outcome === 'ACCEPTED' ? 'ACCEPTED' : outcome === 'TIMEOUT' ? 'TIMEOUT' : 'REJECTED';
    } catch { return 'REJECTED'; }
    finally { scheduler.clearTimeout(timer); }
  }
  async function emit(event) {
    const auditClass = EVENT_CATALOG[event.eventType];
    if (auditClass === AUDIT_CLASSES.OUTSIDE) throw new TypeError('Outside-F5 events cannot be emitted by F5.');
    const outcome = await accept(event);
    if (auditClass === AUDIT_CLASSES.CRITICAL && outcome !== 'ACCEPTED') {
      const error = new Error('Critical audit event was not accepted.');
      error.code = 'AUDIT_CRITICAL_UNAVAILABLE';
      throw error;
    }
    return Object.freeze({ auditClass, outcome });
  }
  return Object.freeze({ emit });
}

module.exports = { ALLOWED_FIELDS, AUDIT_CLASSES, EVENT_CATALOG, createAuditCoordinator, sanitizeAuditEvent };
