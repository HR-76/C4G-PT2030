const OUTCOMES = Object.freeze([
  'SUCCESS', 'RETRYABLE', 'PERMANENT', 'CANCELLED', 'EXPIRED',
  'AUTHORIZATION_REVOKED', 'INCOMPATIBLE', 'POISON_MESSAGE', 'CLEANUP_FAILURE'
]);

const DEFAULTS = Object.freeze({
  pollMs: 1000, batchSize: 10, heartbeatMs: 30000, refreshMs: 10000,
  fencingMarginMs: 5000, handlerTimeoutMs: 120000, deadlineMs: 300000,
  shutdownGraceMs: 30000, maxClockSkewMs: 2000, maxAttempts: 5,
  retryBaseMs: 2000, retryCapMs: 60000, globalConcurrency: 8,
  typeConcurrency: 4, organizationConcurrency: 2, operationalReserve: 2
});
const CAPS = Object.freeze({ globalConcurrency: 64, typeConcurrency: 16, organizationConcurrency: 8 });
const RETENTION_MS = Object.freeze({ completed: 86400000, outbox: 604800000, failed: 604800000, cancelled: 604800000, deadLetter: 2592000000, inbox: 2592000000 });

module.exports = { CAPS, DEFAULTS, OUTCOMES, RETENTION_MS };
