'use strict';

const f12ReplayCapacity = Object.freeze({
  lockReplay: (client, replay) => client.query('SELECT f12_replay_capacity.lock_replay($1,$2)',
    [replay.organizationId, replay.replayRequestId]),
  async reserveReplay(client, replay) {
    const { rows } = await client.query('SELECT f12_replay_capacity.reserve_replay($1,$2,$3) AS reserved',
      [replay.organizationId, replay.replayRequestId, replay.reservedExecutionId]);
    return rows[0]?.reserved === true;
  }
});

async function resolveReplayTerminalExecution(projection, executionId, root, organizationId, jobType, digest) {
  const seen = new Set();
  let next = executionId;
  for (let index = 0; index < 5; index += 1) {
    if (seen.has(next)) break;
    seen.add(next);
    const lineage = await projection.load(next);
    if (lineage.executionId !== next || lineage.organizationId !== organizationId || lineage.jobType !== jobType
        || lineage.rootExecutionId !== root || lineage.contentDigest !== digest) break;
    if (lineage.deliveryKind === 'INITIAL') {
      if (next === root) return null;
      break;
    }
    if (lineage.deliveryKind === 'REPLAY') return next;
    next = lineage.previousExecutionId;
  }
  throw new Error('F12_CAPACITY_LINEAGE_INVALID');
}

function createF12ReplayCapacityRelease({ organizationId, recoveryCentral, receipts }) {
  let after = null;
  return async function poll() {
    const { rows } = await recoveryCentral.query('SELECT * FROM f12_replay_capacity.pending_proofs($1,$2)', [organizationId, after]);
    after = rows.length === 10 ? rows.at(-1).execution_id : null;
    for (const proof of rows) {
      try {
        if (await receipts.recover(proof.transaction_id) === 'COMMITTED') {
          await recoveryCentral.query('SELECT f12_replay_capacity.release($1,$2,$3,$4)',
            [organizationId, proof.root_execution_id, proof.execution_id, proof.transaction_id]);
        }
      } catch { /* Keep the reservation until proof and current bindings can be verified. */ }
    }
  };
}

module.exports = { f12ReplayCapacity, resolveReplayTerminalExecution, createF12ReplayCapacityRelease };
