'use strict';
const { createAppendService } = require('./appendService');
const { PostgresAppendRepository } = require('./postgresAppendRepository');
const { canonicalizeJcs1 } = require('./canonicalJson');
const { inputDigest } = require('./integrity');

// A transaction-local staging buffer, never a durable acceptance receipt.
function createReadAuditBuffer({ organizationId, tenantId, streamType }) {
  const append = createAppendService({ appendPort: new PostgresAppendRepository() });
  const events = [];
  let phase = 'OPEN', failure = null, count = 0, bytes = 0;
  function reject(code) {
    failure ||= Object.assign(new Error(code), { code });
    throw failure;
  }
  function assertHealthy() { if (failure) throw failure; }
  return Object.freeze({
    enqueue(candidate) {
      assertHealthy();
      if (phase !== 'OPEN') reject('READ_AUDIT_CLOSED');
      try {
        const event = candidate?.event;
        if (!Object.isFrozen(candidate) || !Object.isFrozen(event)
          || event?.eventCode !== 'AUTHORIZATION_ALLOWED' || event.auditClass !== 'OBSERVATIONAL_RECONCILABLE'
          || event.decision !== 'ALLOW' || event.outcome !== 'SUCCESS'
          || event.ledgerLocation !== 'TENANT' || event.organizationId !== organizationId || event.tenantId !== tenantId
          || event.streamType !== streamType || candidate.digest !== inputDigest(event)) reject('READ_AUDIT_INVALID');
        const size = Buffer.byteLength(canonicalizeJcs1(candidate), 'utf8');
        if (count >= 128 || bytes + size > 262144) reject('READ_AUDIT_LIMIT');
        // Copy validated material: no mutable producer reference survives until flush.
        events.push(JSON.parse(JSON.stringify(candidate)));
        count++; bytes += size;
      } catch (error) { failure ||= error; throw failure; }
    },
    async flush(client, final = false) {
      assertHealthy();
      if (phase !== 'OPEN') reject('READ_AUDIT_CLOSED');
      phase = 'FLUSHING';
      try {
        for (const candidate of events) {
          assertHealthy();
          const receipt = await append.append(candidate, client);
          if (!['APPENDED', 'DUPLICATE'].includes(receipt?.status)) reject('READ_AUDIT_APPEND_FAILED');
        }
        events.length = 0;
        assertHealthy();
        phase = final ? 'CLOSED' : 'OPEN';
      } catch (error) { failure ||= error; throw failure; }
    },
    assertComplete() { assertHealthy(); if (phase !== 'CLOSED' || events.length) reject('READ_AUDIT_INCOMPLETE'); },
    dispose() { events.length = 0; phase = 'CLOSED'; }
  });
}
module.exports = { createReadAuditBuffer };
