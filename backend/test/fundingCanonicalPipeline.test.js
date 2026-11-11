'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createSource } = require('../src/fundingTenders/source');
const { createFundingRepository } = require('../src/fundingTenders/repository');
const { workerHealth } = require('../src/fundingTenders/workerHealth');
const observedAt = '2026-10-30T22:45:39.461Z';
async function packet() {
  const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../context/references/opportunity-v2/evidence/eu-11145.json'), 'utf8'));
  return createSource({ enrichmentEnabled: true, canonicalV2Enabled: true, clock: () => Date.parse(observedAt), fetchImpl: async () => new Response(JSON.stringify(data)) }).lookup({ externalIdentifier: 'CASCADE:11145' });
}
function fixture({ phase = 'DISCOVERY_DETAIL', archive = false, enrichmentEnabled = true, refreshEnabled = true } = {}) {
  const run = { run_id: randomUUID(), fence: 1, source_code: 'EU_FUNDING_TENDERS' };
  const checkpoint = { run_id: run.run_id, cycle_id: randomUUID(), ordinal: 2, input_cursor: phase ? { phase, externalIdentifier: 'CASCADE:11145' } : null, next_cursor: null };
  run.checkpoint = checkpoint;
  const row = { ...run, requested_by: randomUUID(), collected: false, status: 'RUNNING', observed_at: observedAt };
  const state = { checkpoint, row, stored: null, identity: null, previous: null, commands: [], archiveCalls: [], revoked: false, stale: false, observations: [] };
  const client = { release() {}, async query(sql, p = []) {
    if (['BEGIN', 'COMMIT', 'ROLLBACK', 'RESET ROLE'].includes(sql) || sql.startsWith('SET LOCAL')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM public.global_user') || sql.includes('FROM public.platform_admin_assignment')) return { rows: state.revoked ? [] : [{ id: row.requested_by }], rowCount: state.revoked ? 0 : 1 };
    if (sql.startsWith('SELECT * FROM opportunity_catalog.funding_run WHERE')) return { rows: state.stale ? [] : [state.row], rowCount: state.stale ? 0 : 1 };
    if (sql.startsWith('SELECT * FROM opportunity_catalog.funding_batch WHERE')) return { rows: [state.checkpoint], rowCount: 1 };
    if (sql.startsWith('UPDATE opportunity_catalog.funding_batch SET next_cursor=COALESCE')) { state.checkpoint.next_cursor = { ...state.checkpoint.next_cursor, canonicalV2Required: true }; return { rows: [{ run_id: run.run_id }], rowCount: 1 }; }
    if (sql.startsWith('UPDATE opportunity_catalog.funding_batch SET next_cursor=')) { state.checkpoint.next_cursor = structuredClone(p[1]); return { rows: [{ run_id: run.run_id }], rowCount: 1 }; }
    if (sql.startsWith('INSERT INTO opportunity_catalog.funding_run_item')) { state.stored = { external_identifier: p[1], source_fields: structuredClone(p[2]), source_resolution_id: p[3] || null }; return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('UPDATE opportunity_catalog.funding_run SET collected=')) { Object.assign(state.row, { collected: true, observed_at: p[1], result_count: p[2] }); return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('SELECT * FROM opportunity_catalog.funding_run_item')) return { rows: state.stored ? [state.stored] : [], rowCount: state.stored ? 1 : 0 };
    if (sql.startsWith('SELECT last_source_fields FROM opportunity_catalog.funding_identity')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT * FROM opportunity_catalog.funding_identity')) return { rows: state.identity ? [state.identity] : [], rowCount: state.identity ? 1 : 0 };
    if (sql.startsWith('SELECT o.*,r.snapshot')) return { rows: state.previous ? [state.previous] : [], rowCount: state.previous ? 1 : 0 };
    if (sql.includes('FROM opportunity_catalog.funding_resolution')) return { rows: state.resolutionArchive ? [state.resolutionArchive] : [], rowCount: state.resolutionArchive ? 1 : 0 };
    if (sql.startsWith('INSERT INTO opportunity_catalog.funding_identity')) { state.identity = { external_identifier: p[0], opportunity_id: p[1], last_source_fields: structuredClone(p[2]), corrections: structuredClone(p[3]) }; return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('INSERT INTO opportunity_catalog.funding_observation')) { state.observations.push(structuredClone(p)); return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('UPDATE opportunity_catalog.funding_run_item SET result=')) { state.stored.result = p[2]; return { rows: [], rowCount: 1 }; }
    if (/^UPDATE opportunity_catalog.funding_run SET (created|updated|unchanged)_count=/.test(sql)) return { rows: [], rowCount: 1 };
    // Deliberately no handler for INSERT funding_refresh_target: a NEW identity
    // must not need that FK-bound queue before or after first publication.
    throw new Error('Unexpected query: ' + sql);
  } };
  const catalog = { withTransactionClient: async (_client, work) => work(), async create(command) {
    state.commands.push(structuredClone(command));
    const opportunityId = randomUUID(), revisionId = randomUUID();
    state.previous = { current_revision_id: revisionId, row_version: 1, lifecycle_state: 'ACTIVE', validation_state: 'PENDING_REVIEW', snapshot: structuredClone(command.snapshot) };
    return { opportunityId, revisionId };
  } };
  const candidateArchive = archive ? { async stage(_client, input) { state.archiveCalls.push(['stage', input]); return { stored: true }; }, async verify(_client, input) { state.archiveCalls.push(['verify', input]); return { canonicalSnapshot: state.archiveCalls[0][1].batch.canonicalSnapshot }; } } : null;
  const repository = createFundingRepository({ pool: { connect: async () => client }, catalog, audit: async () => {}, coverageEnabled: true, refreshEnabled, enrichmentEnabled, candidateArchive });
  const withoutArchive = () => createFundingRepository({ pool: { connect: async () => client }, catalog, audit: async () => {}, coverageEnabled: true, refreshEnabled, enrichmentEnabled });
  const withResolution = () => createFundingRepository({ pool: { connect: async () => client }, catalog, audit: async () => {}, coverageEnabled: true, refreshEnabled, enrichmentEnabled, candidateArchive, resolutionEnabled: true });
  return { state, run, client, repository, withoutArchive, withResolution };
}

test('P3 apply refuses NEW discovery records before a durable complete lookup', async () => {
  const f = fixture({ phase: null }), batch = await packet();
  f.state.stored = { external_identifier: batch.record.externalIdentifier, source_fields: batch.record.fields };
  await assert.rejects(f.repository.apply(f.run, f.state.stored), { code: 'FUNDING_DISCOVERY_REQUIRES_LOOKUP' });
  assert.equal(f.state.commands.length, 0);
});

test('canonical packet cannot be silently discarded when durable archive is not configured', async () => {
  const f = fixture();
  await assert.rejects(f.repository.stage(f.run, await packet()), { code: 'FUNDING_V2_ARCHIVE_REQUIRED' });
  assert.equal(f.state.stored, null);
});

test('configured canonical archive refuses a legacy-only FOUND result', async () => {
  const f = fixture({ archive: true }), batch = await packet();
  delete batch.canonicalSnapshot;
  await assert.rejects(f.repository.stage(f.run, batch), { code: 'FUNDING_V2_CANDIDATE_REQUIRED' });
  assert.equal(f.state.stored, null);
  assert.equal(f.state.archiveCalls.length, 0);
});

test('source to canonical archive to detail-first legacy apply preserves scope and supports replay', async () => {
  const f = fixture({ archive: true }), batch = await packet();
  await f.repository.stage(f.run, batch);
  assert.equal(f.state.commands.length, 0);
  assert.equal(f.state.archiveCalls[0][1].batch.canonicalSnapshot.financing.allocations.value[0].money.amount, '120000');
  assert.equal(f.state.archiveCalls[0][1].run.run_id, f.run.run_id);
  await f.repository.apply(f.run, f.state.stored);
  assert.equal(f.state.commands.length, 1);
  assert.equal(f.state.commands[0].snapshot.schemaVersion, 1);
  assert.equal(f.state.commands[0].snapshot.canonicalSnapshot, undefined);
  assert.equal(f.state.archiveCalls.filter(call => call[0] === 'verify').length, 1);
  assert.equal(f.state.observations.length, 1);
  await f.repository.apply(f.run, f.state.stored);
  assert.equal(f.state.commands.length, 1);
});

test('P3 apply checks the durable checkpoint after restart and rejects staged field tampering', async () => {
  for (const mode of ['fields', 'phase', 'time']) {
    const f = fixture(), batch = await packet(); delete batch.canonicalSnapshot;
    await f.repository.stage(f.run, batch);
    if (mode === 'fields') f.state.stored.source_fields.title = 'Forged title';
    if (mode === 'phase') f.state.checkpoint = { ...f.state.checkpoint, input_cursor: null };
    if (mode === 'time') f.state.row.observed_at = '2026-10-31T00:00:00.000Z';
    await assert.rejects(f.repository.apply(f.run, f.state.stored), { code: 'FUNDING_DISCOVERY_REQUIRES_LOOKUP' });
    assert.equal(f.state.commands.length, 0);
  }
});

test('canonical archive remains mandatory after a restart without its configured port', async () => {
  const f = fixture({ archive: true });
  await f.repository.stage(f.run, await packet());
  await assert.rejects(f.withoutArchive().apply(f.run, f.state.stored), { code: 'FUNDING_V2_ARCHIVE_REQUIRED' });
  assert.equal(f.state.commands.length, 0);
});

test('an existing P2 resolution cannot waive a canonical candidate already required by its checkpoint', async () => {
  const f = fixture({ archive: true }), batch = await packet();
  await f.repository.stage(f.run, batch);
  const resolutionId = randomUUID(), opportunityId = randomUUID();
  const fields = structuredClone(f.state.stored.source_fields);
  f.state.stored.source_resolution_id = resolutionId;
  f.state.identity = { opportunity_id: opportunityId, last_source_fields: fields, corrections: {} };
  f.state.previous = { current_revision_id: randomUUID(), snapshot: { ...fields, sourceResolution: { resolutionId, sourceFingerprint: batch.evidence.fingerprint } } };
  f.state.resolutionArchive = { resolution_id: resolutionId, source_fingerprint: batch.evidence.fingerprint, evidence: batch.evidence };
  await f.withResolution().apply(f.run, f.state.stored);
  assert.equal(f.state.archiveCalls.find(call => call[0] === 'verify')[1].required, true);
  assert.equal(f.state.commands.length, 0);
});

test('candidate archive receives no write after authority revocation or stale fence', async () => {
  for (const flag of ['revoked', 'stale']) {
    const f = fixture({ archive: true }); f.state[flag] = true;
    await assert.rejects(f.repository.stage(f.run, await packet()), { code: flag === 'revoked' ? 'FUNDING_FORBIDDEN' : 'FUNDING_FENCE_STALE' });
    assert.equal(f.state.archiveCalls.length, 0);
  }
});

test('a staged detail cannot create an identity after its mode is disabled on restart', async () => {
  for (const refreshEnabled of [true, false]) {
    const f = fixture({ enrichmentEnabled: false, refreshEnabled }), batch = await packet();
    delete batch.canonicalSnapshot;
    await assert.rejects(f.repository.stage(f.run, batch), { code: 'FUNDING_DISCOVERY_MODE_DISABLED' });
    f.state.row.collected = true;
    f.state.stored = { external_identifier: batch.record.externalIdentifier, source_fields: batch.record.fields };
    await assert.rejects(f.repository.apply(f.run, f.state.stored), { code: 'FUNDING_DISCOVERY_MODE_DISABLED' });
    assert.equal(f.state.commands.length, 0);
  }
});

test('archive configuration and worker detail capability cannot imply an unsafe rollout', () => {
  assert.throws(() => createFundingRepository({ pool: {}, candidateArchive: { stage() {}, verify() {} } }), /requires|configuration/i);
  const now = Date.parse(observedAt), heartbeat = { at: now, installationId: 'local', mode: 'PROCESSING', lastPollAt: now, consecutiveFailures: 0, enrichmentSupported: true, discoveryDetailSupported: true };
  assert.equal(workerHealth(heartbeat, { now, installationId: 'local' }).discoveryDetailSupported, true);
  assert.equal(workerHealth(heartbeat, { now, installationId: 'other' }).discoveryDetailSupported, undefined);
  // supported is a physical schema capability, independent of disabling new
  // cycles. A restart on Central035 must still load durable P3 checkpoints.
  const coverage = require('../src/fundingTenders/coverageConfig').coverageConfig('disabled', '035_funding_source_resolution');
  assert.equal(coverage.enabled, false);
  assert.equal(coverage.supported, true);
  assert.equal(coverage.temporalSupported, true);
});

test('enriched collection admission rejects workers that cannot look up new identities first', async () => {
  const userId = randomUUID();
  const pool = { connect: async () => ({ release() {}, async query(sql) {
    if (sql.includes('FROM public.global_user') || sql.includes('FROM public.platform_admin_assignment')) return { rows: [{ id: userId }] };
    if (sql.includes('WHERE request_id') || /^(BEGIN|SET LOCAL|SELECT pg_advisory|ROLLBACK)/.test(sql)) return { rows: [] };
    throw new Error('Unexpected admission before worker capability validation');
  } }) };
  const repository = createFundingRepository({ pool, coverageEnabled: true, refreshEnabled: true, enrichmentEnabled: true,
    workerHealth: async () => ({ ready: true, coverageSupported: true, refreshSupported: true, enrichmentSupported: true }) });
  await assert.rejects(repository.enqueue(userId, randomUUID()), { code: 'FUNDING_WORKER_UPGRADE_REQUIRED' });
});
