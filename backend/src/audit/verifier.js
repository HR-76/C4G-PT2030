const { eventHash, GENESIS_HASH } = require('./integrity');

function verifyEvents(events, { expectedPreviousHash = GENESIS_HASH, expectedSequence = 1, telemetryPort = null } = {}) {
  let previousHash = expectedPreviousHash;
  let sequence = expectedSequence;
  for (const row of events) {
    if (!row || row.sequence !== sequence || row.previousHash !== previousHash) { try { telemetryPort?.record('F7',1,{ledgerLocation:'TENANT',auditClass:'OBSERVATIONAL',result:'MISMATCH',reasonBucket:'chain_gap',source:'WORKER',operation:'verify'}); } catch {} return Object.freeze({ valid: false, sequence, reasonCode: 'AUDIT_CHAIN_GAP' }); }
    const { eventHash: stored, ...material } = row;
    if (eventHash(material) !== stored) { try { telemetryPort?.record('F7',1,{ledgerLocation:'TENANT',auditClass:'OBSERVATIONAL',result:'MISMATCH',reasonBucket:'hash_mismatch',source:'WORKER',operation:'verify'}); } catch {} return Object.freeze({ valid: false, sequence, reasonCode: 'AUDIT_HASH_MISMATCH' }); }
    previousHash = stored; sequence += 1;
  }
  try { telemetryPort?.record('F7',1,{ledgerLocation:'TENANT',auditClass:'OBSERVATIONAL',result:'SUCCESS',reasonBucket:'none',source:'WORKER',operation:'verify'}); } catch {}
  return Object.freeze({ valid: true, nextSequence: sequence, lastHash: previousHash });
}
module.exports = { verifyEvents };
