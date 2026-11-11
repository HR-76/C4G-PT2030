const { createEnvelope } = require('../async/envelope');

function createAuditIntent({ candidate, trustedContext, registry, clock, executionId }) {
  if (!candidate || !candidate.event || candidate.event.organizationId !== trustedContext.organizationId) throw new TypeError('Audit intent context mismatch.');
  return createEnvelope({ trustedContext: Object.freeze({ organizationId: trustedContext.organizationId,
    actor: trustedContext.actor, operation: 'audit.append', correlationId: candidate.event.correlationId,
    causationId: candidate.event.causationId || candidate.event.correlationId }), job: Object.freeze({ type: 'audit.append', version: 1,
    payloadVersion: 1, idempotencyKey: candidate.event.idempotencyKey, deadlineMs: 300000 }),
  payload: Object.freeze({ eventId: candidate.event.eventId, inputDigest: candidate.digest }), registry, clock, id: () => executionId });
}
module.exports = { createAuditIntent };
