const CHECKPOINT_INTERVAL = 10000;
function shouldCheckpoint(sequence, { monthBoundary = false } = {}) { return Number.isSafeInteger(sequence) && sequence > 0 && (sequence % CHECKPOINT_INTERVAL === 0 || monthBoundary === true); }
function createCheckpoint({ streamId, firstSequence, lastSequence, firstHash, lastHash, sealedMonth = null }) {
  if (![firstSequence, lastSequence].every(Number.isSafeInteger) || firstSequence < 1 || lastSequence < firstSequence || !/^[a-f0-9]{64}$/.test(firstHash) || !/^[a-f0-9]{64}$/.test(lastHash)) throw new TypeError('Audit checkpoint is invalid.');
  return Object.freeze({ streamId, firstSequence, lastSequence, firstHash, lastHash, sealedMonth });
}
function createCheckpointService({ port }) {
  if (!port || typeof port.persist !== 'function') throw new TypeError('CheckpointPort is invalid.');
  async function seal(boundary) {
    if (!shouldCheckpoint(boundary.lastSequence, { monthBoundary: boundary.monthBoundary })) return Object.freeze({ status: 'NOT_DUE' });
    return port.persist(createCheckpoint(boundary));
  }
  return Object.freeze({ seal });
}
module.exports = { CHECKPOINT_INTERVAL, createCheckpoint, createCheckpointService, shouldCheckpoint };
