const { eventHash, GENESIS_HASH } = require('./integrity');
const { assertAuditAppendPort } = require('./ports');
const { canonicalizeJcs1 } = require('./canonicalJson');

function createAppendService({ appendPort, telemetryPort = null }) {
  assertAuditAppendPort(appendPort);
  async function append(candidate, transaction) {
    const position = await appendPort.prepare({
      ledgerLocation: candidate.event.ledgerLocation, organizationId: candidate.event.organizationId,
      streamType: candidate.event.streamType, idempotencyKey: candidate.event.idempotencyKey,
      inputDigest: candidate.digest
    }, transaction);
    if (position.duplicate) {
      if (position.inputDigest !== candidate.digest) throw Object.assign(new Error('Audit idempotency digest mismatch.'), { code: 'AUDIT_DIGEST_MISMATCH' });
      try { telemetryPort?.record('F7', 1, { ledgerLocation: candidate.event.ledgerLocation, auditClass: candidate.event.auditClass || 'OBSERVATIONAL', result: 'DUPLICATE', reasonBucket: 'duplicate', source: candidate.event.source || 'API', operation: 'append' }); } catch { /* non-authoritative */ }
      return Object.freeze({ status: 'DUPLICATE', eventId: position.eventId, eventHash: position.eventHash });
    }
    const persisted = Object.freeze({ ...candidate.event, acceptedAt: position.acceptedAt,
      streamId: position.streamId, sequence: position.sequence, previousHash: position.previousHash || GENESIS_HASH });
    const hash = eventHash(persisted);
    if (Buffer.byteLength(canonicalizeJcs1({ ...persisted, eventHash: hash }), 'utf8') > 16 * 1024) throw new TypeError('Persisted audit event exceeds 16 KiB.');
    const result = await appendPort.append({ event: Object.freeze({ ...persisted, eventHash: hash }), inputDigest: candidate.digest, reservation: position.reservation }, transaction);
    try { telemetryPort?.record('F7', 1, { ledgerLocation: candidate.event.ledgerLocation, auditClass: candidate.event.auditClass || 'OBSERVATIONAL', result: 'SUCCESS', reasonBucket: 'none', source: candidate.event.source || 'API', operation: 'append' }); } catch { /* non-authoritative */ }
    return result;
  }
  return Object.freeze({ append });
}
module.exports = { createAppendService };
