'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { adaptManualOpportunityV2, manualEditorialId } = require('../src/opportunities/manualV2');
const { createManualCandidateArchiveV2 } = require('../src/opportunities/manualV2Archive');
const { createCentralManualCandidateCompositionV2 } = require('../src/opportunities/manualV2Composition');
const present = value => ({ state: 'PRESENT', value, reason: null });
const declaration = () => ({ kind: 'CALL', fields: { '/description/title': present('Manual'), '/description/summary': present('Original summary') } });
function input() {
  const userId = randomUUID(), requestId = randomUUID(), editorialId = manualEditorialId(userId, requestId), observedAt = '2026-10-30T12:00:00.000Z';
  return { userId, requestId, editorialId, observedAt, ...adaptManualOpportunityV2(declaration(), { editorialId, observedAt }) };
}
function fixture() {
  const state = { rows: [], audits: [], sql: [], revoked: false, failAudit: false, checks: 0, revokeAt: 0 };
  let before;
  const client = { release() {}, async query(sql, p = []) {
    state.sql.push(sql);
    if (sql === 'BEGIN') { before = { rows: structuredClone(state.rows), audits: structuredClone(state.audits) }; return { rows: [] }; }
    if (sql === 'ROLLBACK') { Object.assign(state, before); return { rows: [] }; }
    if (sql === 'COMMIT' || sql.startsWith('SET LOCAL')) return { rows: [] };
    if (sql.includes('FROM public.global_user')) { state.checks++; return { rows: state.revoked || state.revokeAt === state.checks ? [] : [{ id: p[0] }] }; }
    if (sql.includes('FROM public.platform_admin_assignment')) return { rows: state.revoked ? [] : [{ id: p[0] }] };
    if (sql.startsWith('INSERT INTO opportunity_catalog.manual_v2_candidate')) {
      if (state.rows.some(row => row.requested_by === p[1] && row.request_id === p[2])) return { rows: [], rowCount: 0 };
      const row = { candidate_id: p[0], requested_by: p[1], request_id: p[2], editorial_id: p[3], intent_digest: p[4], content_digest: p[5],
        artifact: JSON.parse(p[6]), canonical_snapshot: JSON.parse(p[7]), observed_at: p[8], mapping_version: p[9], mapping_digest: p[10], payload_digest: p[11] };
      state.rows.push(row); return { rows: [row], rowCount: 1 };
    }
    if (sql.startsWith('SELECT candidate_id,requested_by,request_id') && sql.includes('FROM opportunity_catalog.manual_v2_candidate')) return { rows: state.rows.filter(row => row.requested_by === p[0] && row.request_id === p[1]) };
    throw Error('Unexpected SQL ' + sql);
  } };
  const audit = async (actual, event) => { assert.equal(actual, client); if (state.failAudit) throw Error('secret audit details'); state.audits.push(event); };
  const archive = createManualCandidateArchiveV2({ audit }), pool = { connect: async () => client };
  return { state, client, archive, audit, pool };
}

test('manual v2 archive stores raw declaration and factual snapshot without a connector or accepted catalog identity', async () => {
  const f = fixture(), value = input(), receipt = await f.archive.stage(f.client, value);
  assert.equal(receipt.reviewRequired, true); assert.equal(receipt.replayed, false);
  assert.equal(receipt.sourceIdentifier, 'EDITORIAL:' + value.editorialId);
  assert.equal(f.state.rows.length, 1); assert.deepEqual(f.state.rows[0].artifact, value.artifact);
  assert.deepEqual(f.state.rows[0].canonical_snapshot, value.snapshot);
  assert.equal(f.state.audits[0].actor.id, value.userId);
  assert.equal(f.state.audits[0].detailCode, 'MANUAL_V2_CANDIDATE_STAGED');
  assert.equal(f.state.sql.some(sql => /tenant|funding_identity|INSERT INTO opportunity_catalog\.opportunity\b|BEGIN|COMMIT/.test(sql)), false);
});

test('manual v2 retry keeps first observation, candidate and audit; same request changed summary conflicts', async () => {
  const f = fixture(), value = input(), first = await f.archive.stage(f.client, value), later = '2026-10-31T12:00:00.000Z';
  const next = { ...value, observedAt: later, ...adaptManualOpportunityV2(value.artifact.json, { editorialId: value.editorialId, observedAt: later }) };
  const replay = await f.archive.stage(f.client, next);
  assert.deepEqual(replay, { ...first, replayed: true }); assert.equal(f.state.rows.length, 1); assert.equal(f.state.audits.length, 1);
  assert.equal(f.state.rows[0].observed_at, value.observedAt);
  const changed = declaration(); changed.fields['/description/summary'].value = 'Different';
  await assert.rejects(f.archive.stage(f.client, { ...value, ...adaptManualOpportunityV2(changed, valueContext(value)) }), { code: 'MANUAL_V2_IDEMPOTENCY_CONFLICT' });
});
function valueContext(value) { return { editorialId: value.editorialId, observedAt: value.observedAt }; }

test('manual v2 archive rederives candidate and rejects altered evidence, actor binding or unsafe objects before SQL', async () => {
  const original = input();
  for (const change of [value => { value.snapshot.description.title.value = 'Forged'; }, value => { value.artifact.sha256 = 'f'.repeat(64); },
    value => { value.userId = randomUUID(); }, value => { value.editorialId = 'f'.repeat(64); }, value => { value.tenantId = randomUUID(); }]) {
    const f = fixture(), value = structuredClone(original); change(value);
    await assert.rejects(f.archive.stage(f.client, value), { code: 'MANUAL_V2_CANDIDATE_INVALID' }); assert.equal(f.state.sql.length, 0);
  }
});

test('manual v2 replay detects stored snapshot, digest, provenance, declaration and receipt tampering', async () => {
  for (const change of [row => { row.content_digest = 'f'.repeat(64); }, row => { row.candidate_id = 'bad'; },
    row => { row.canonical_snapshot.description.title.value = 'Changed'; }, row => { row.artifact.json.fields['/description/summary'].value = 'Changed'; },
    row => { row.mapping_digest = 'f'.repeat(64); }, row => { row.payload_digest = 'f'.repeat(64); }, row => { row.editorial_id = 'f'.repeat(64); }]) {
    const f = fixture(), value = input(); await f.archive.stage(f.client, value); change(f.state.rows[0]);
    await assert.rejects(f.archive.stage(f.client, value), { code: 'MANUAL_V2_CANDIDATE_INVALID' });
    assert.equal(f.state.rows.length, 1); assert.equal(f.state.audits.length, 1);
  }
});

test('manual v2 composition authorizes current administrator on create/replay and after preparation', async () => {
  const f = fixture(), value = input(), service = createCentralManualCandidateCompositionV2({ pool: f.pool, audit: f.audit,
    clock: () => new Date(value.observedAt) });
  const command = { userId: value.userId, input: { requestId: value.requestId, ...value.artifact.json } };
  await service.create(command); assert.equal(f.state.rows.length, 1);
  f.state.revoked = true; f.state.sql.length = 0;
  await assert.rejects(service.create(command), { code: 'FUNDING_FORBIDDEN' });
  assert.equal(f.state.sql.some(sql => sql.includes('manual_v2_candidate')), false);
  f.state.revoked = false; f.state.revokeAt = f.state.checks + 2; f.state.sql.length = 0;
  await assert.rejects(service.create(command), { code: 'FUNDING_FORBIDDEN' });
  assert.equal(f.state.sql.some(sql => sql.includes('manual_v2_candidate')), false);
  assert.ok(f.state.sql.some(sql => sql.includes('FOR SHARE')));
});

test('manual v2 audit failure rolls back the candidate and retry can safely create it', async () => {
  const f = fixture(), value = input(), service = createCentralManualCandidateCompositionV2({ pool: f.pool, audit: f.audit,
    clock: () => new Date(value.observedAt) });
  const command = { userId: value.userId, input: { requestId: value.requestId, ...value.artifact.json } };
  f.state.failAudit = true;
  await assert.rejects(service.create(command), error => error.code === 'MANUAL_V2_ARCHIVE_UNAVAILABLE' && !error.message.includes('secret'));
  assert.equal(f.state.rows.length, 0); assert.equal(f.state.audits.length, 0);
  f.state.failAudit = false; assert.equal((await service.create(command)).replayed, false);
  assert.equal(f.state.rows.length, 1); assert.equal(f.state.audits.length, 1);
});

test('manual candidate SQL is additive, immutable and unavailable to catalog readers', () => {
  const sql = readFileSync(join(__dirname, '../database/central/candidates/manual_opportunity_v2.up.sql'), 'utf8');
  assert.match(sql, /UNIQUE\(requested_by,request_id\)/); assert.match(sql, /BEFORE UPDATE OR DELETE/); assert.match(sql, /BEFORE TRUNCATE/);
  assert.match(sql, /FROM PUBLIC,c4g_catalog_reader/); assert.match(sql, /GRANT SELECT,INSERT/);
  assert.doesNotMatch(sql, /funding_identity|CREATE TABLE opportunity_catalog\.opportunity\s|GRANT UPDATE|GRANT DELETE/);
  assert.throws(() => createManualCandidateArchiveV2(), TypeError);
  assert.throws(() => createCentralManualCandidateCompositionV2(), TypeError);
});
