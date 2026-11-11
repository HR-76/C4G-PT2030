const { performance } = require('node:perf_hooks');
const { canonicalizeJcs1 } = require('../src/audit/canonicalJson');
const { eventHash, GENESIS_HASH } = require('../src/audit/integrity');
const { verifyEvents } = require('../src/audit/verifier');

const total = 20000; const rows = []; let previousHash = GENESIS_HASH;
const started = performance.now();
for (let sequence = 1; sequence <= total; sequence += 1) {
  const material = { acceptedAt: '2026-10-08T12:00:00.000Z', eventId: `event-${sequence}`, eventVersion: 1, eventCode: 'AUTHORIZATION_DENIED',
    organizationId: 'synthetic-a', streamId: 'synthetic-a:ACCESS', streamType: 'ACCESS', sequence, previousHash, payload: {}, canonicalizationVersion: 'JCS-1', hashAlgorithm: 'SHA-256' };
  const hash = eventHash(material); rows.push({ ...material, eventHash: hash }); previousHash = hash;
}
const appendMs = performance.now() - started;
const verifyStarted = performance.now(); const verified = verifyEvents(rows); const verifyMs = performance.now() - verifyStarted;
const queryStarted = performance.now(); rows.slice(-100).sort((a, b) => b.sequence - a.sequence).map(canonicalizeJcs1); const queryMs = performance.now() - queryStarted;
if (!verified.valid) throw new Error('F7 benchmark chain failed.');
console.log(JSON.stringify({ workload: total, appendHashMs: Number(appendMs.toFixed(2)), verifyMs: Number(verifyMs.toFixed(2)), query100Ms: Number(queryMs.toFixed(2)) }));
