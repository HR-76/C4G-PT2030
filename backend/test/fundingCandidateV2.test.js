'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createCandidateArchiveV2 } = require('../src/fundingTenders/candidateRepositoryV2');
const { buildEvidence } = require('../src/fundingTenders/sourceEvidence');
const { adaptEuOpportunityV2 } = require('../src/fundingTenders/adapterV2');

const observedAt = '2026-10-30T22:45:39.461Z';
function input() {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../context/references/opportunity-v2/evidence/eu-11145.json'), 'utf8'));
  const evidence = buildEvidence('CASCADE:11145', raw.results);
  return {
    run: { run_id: randomUUID(), source_code: 'EU_FUNDING_TENDERS', observed_at: new Date(observedAt), created_at: new Date() },
    batch: { outcome: 'FOUND', received: 1, observedAt, record: { externalIdentifier: 'CASCADE:11145', fields: {} }, evidence, canonicalSnapshot: adaptEuOpportunityV2(evidence, { observedAt }) }
  };
}

function database() {
  const state = { stored: null, calls: [] };
  const client = { async query(sql, params) {
    state.calls.push([sql, params]);
    if (sql.startsWith('INSERT INTO opportunity_catalog.funding_candidate_v2')) {
      if (state.stored) return { rowCount: 0, rows: [] };
      state.stored = { run_id: params[0], external_identifier: params[1], source_selection: params[2], observed_at: new Date(params[3]),
        snapshot_schema_version: 2, mapping_version: params[4], content_digest: params[5], payload_digest: params[6],
        canonical_snapshot: JSON.parse(params[7]), source_evidence: JSON.parse(params[8]), evidence_fingerprint: params[9], evidence_sha256: params[10], params: structuredClone(params) };
      return { rowCount: 1, rows: [{ payload_digest: params[6] }] };
    }
    if (sql.startsWith('SELECT payload_digest FROM opportunity_catalog.funding_candidate_v2')) return { rowCount: state.stored ? 1 : 0, rows: state.stored ? [{ payload_digest: state.stored.payload_digest }] : [] };
    if (sql.startsWith('SELECT run_id,external_identifier,source_selection')) return { rowCount: state.stored ? 1 : 0, rows: state.stored ? [state.stored] : [] };
    throw new Error('Unexpected candidate query');
  } };
  return { state, client };
}

test('candidate archive retains full 11145 snapshot and exact evidence before any catalog identity', async () => {
  const value = input(), db = database();
  const result = await createCandidateArchiveV2().stage(db.client, value);
  assert.equal(result.stored, true);
  const params = db.state.stored.params;
  const snapshot = JSON.parse(params[7]), evidence = JSON.parse(params[8]);
  assert.equal(snapshot.financing.allocations.value[0].money.amount, '120000');
  assert.equal(snapshot.relatedProject.grantAgreementNumber.value, '101190010');
  assert.equal(snapshot.schedule.deadlines.value.length, 7);
  assert.deepEqual(evidence, value.batch.evidence);
  assert.equal(params[10], createHash('sha256').update(params[8], 'utf8').digest('hex'));
  assert.equal(snapshot.provenance.observations[0].artifactSha256, params[10]);
  assert.ok(db.state.calls.every(([sql]) => !/funding_identity|opportunity_catalog\.revision|BEGIN|COMMIT|UPDATE/.test(sql)));
  assert.equal(Object.isFrozen(result), true);
});

test('canonical EU writer cannot archive a legacy v1 identity without an OIDC prearchive receipt', async () => {
  const value = input(), db = database();
  value.run.eu_writer_mode = 'CANONICAL_V2';
  const original = db.client.query;
  db.client.query = async (sql, params) => sql.includes('current_schema_version')
    ? { rows: [{ current_schema_version: 1 }] } : original(sql, params);
  await assert.rejects(createCandidateArchiveV2().stage(db.client, value),
    { code: 'FUNDING_V2_PREARCHIVE_APPROVAL_REQUIRED' });
  assert.equal(db.state.stored, null);
  assert.equal(db.state.calls.some(([sql]) => sql.startsWith('INSERT INTO opportunity_catalog.funding_candidate_v2')), false);
});

test('legacy v1 archive refuses malformed or unverifiable receipts before candidate INSERT', async () => {
  for (const preapproval of [
    { eventId: randomUUID() },
    { packageId: randomUUID(), itemDigest: 'a'.repeat(64), bindingDigest: 'b'.repeat(64),
      eventId: randomUUID(), eventHash: 'c'.repeat(64), actorId: randomUUID() },
    { scope: 'PREARCHIVE_ONLY', packageId: randomUUID(), externalIdentifier: 'CASCADE:11145',
      itemDigest: 'a'.repeat(64), bindingDigest: 'b'.repeat(64), requestId: randomUUID(),
      actorId: randomUUID(), eventId: randomUUID(), eventHash: 'c'.repeat(64),
      expiresAt: '2026-10-31T23:00:00.000Z', replayed: false }
  ]) {
    const value = input(), db = database();
    value.run.eu_writer_mode = 'CANONICAL_V2';
    const original = db.client.query;
    db.client.query = async (sql, params) => sql.includes('current_schema_version')
      ? { rows: [{ current_schema_version: 1 }] } : original(sql, params);
    await assert.rejects(createCandidateArchiveV2().stage(db.client, { ...value, preapproval }),
      { code: preapproval.itemDigest ? 'FUNDING_V2_PREARCHIVE_STATE_CHANGED' : 'FUNDING_V2_PREARCHIVE_APPROVAL_REQUIRED' });
    assert.equal(db.state.stored, null);
    assert.equal(db.state.calls.some(([sql]) => sql.includes('authorize_eu_legacy_prearchive_v1')), false);
  }
});

test('candidate archive retry is idempotent and a changed observation cannot overwrite the same run identity', async () => {
  const value = input(), db = database(), archive = createCandidateArchiveV2();
  await archive.stage(db.client, value);
  assert.equal((await archive.stage(db.client, value)).stored, false);
  const changed = structuredClone(value);
  changed.batch.observedAt = '2026-10-30T22:46:00.000Z';
  changed.batch.canonicalSnapshot = adaptEuOpportunityV2(changed.batch.evidence, { observedAt: changed.batch.observedAt });
  await assert.rejects(archive.stage(db.client, changed), { code: 'FUNDING_V2_CANDIDATE_REPLAY_CONFLICT' });
  assert.ok(db.state.calls.every(([sql]) => !sql.startsWith('UPDATE')));
});

test('candidate archive rederives facts and refuses forged snapshot, source, evidence or observation binding', async () => {
  for (const mode of ['money', 'project', 'time', 'identity', 'fingerprint', 'selection']) {
    const value = input(), db = database();
    value.batch.canonicalSnapshot = structuredClone(value.batch.canonicalSnapshot);
    if (mode === 'money') value.batch.canonicalSnapshot.financing.allocations.value[0].money.amount = '999999';
    if (mode === 'project') value.batch.canonicalSnapshot.relatedProject.acronym.value = 'INVENTED';
    if (mode === 'time') value.batch.observedAt = '2026-10-30T23:00:00.000Z';
    if (mode === 'identity') value.batch.record.externalIdentifier = 'CASCADE:46214053';
    if (mode === 'fingerprint') value.batch.evidence.fingerprint = 'f'.repeat(64);
    if (mode === 'selection') value.run.source_code = 'CORDIS';
    await assert.rejects(createCandidateArchiveV2().stage(db.client, value), { code: 'FUNDING_V2_CANDIDATE_INVALID' }, mode);
    assert.equal(db.state.calls.length, 0, mode);
  }
});

test('candidate archive rejects partial/failed lookup, missing candidate and invalid run before SQL', async () => {
  for (const mode of ['conflict', 'limited', 'count', 'missing', 'run']) {
    const value = input(), db = database();
    if (mode === 'conflict') value.batch.outcome = 'CONFLICT';
    if (mode === 'limited') value.batch.limited = true;
    if (mode === 'count') value.batch.received = 2;
    if (mode === 'missing') delete value.batch.canonicalSnapshot;
    if (mode === 'run') value.run.run_id = 'not-a-uuid';
    await assert.rejects(createCandidateArchiveV2().stage(db.client, value), { code: 'FUNDING_V2_CANDIDATE_INVALID' }, mode);
    assert.equal(db.state.calls.length, 0);
  }
});

test('candidate archive does not execute getters and reports sanitized storage failures', async () => {
  const value = input(); let invoked = false;
  Object.defineProperty(value.batch, 'evidence', { enumerable: true, get() { invoked = true; throw Error('secret'); } });
  await assert.rejects(createCandidateArchiveV2().stage(database().client, value), { code: 'FUNDING_V2_CANDIDATE_INVALID' });
  assert.equal(invoked, false);
  await assert.rejects(createCandidateArchiveV2().stage({ query: async () => { throw Object.assign(new Error('private connection and SQL'), { code: '42P01' }); } }, input()), error => error.code === 'FUNDING_V2_ARCHIVE_UNAVAILABLE' && !/private|connection|SQL/.test(error.message));
});

test('candidate verification after restart rederives preserved JSON evidence despite JSONB snapshot key order', async () => {
  const value = input(), db = database(), archive = createCandidateArchiveV2();
  const staged = await archive.stage(db.client, value);
  function reorder(object) {
    if (Array.isArray(object)) return object.map(reorder);
    if (!object || typeof object !== 'object') return object;
    return Object.fromEntries(Object.keys(object).reverse().map(key => [key, reorder(object[key])]));
  }
  db.state.stored.canonical_snapshot = reorder(db.state.stored.canonical_snapshot);
  const checked = await archive.verify(db.client, { run: value.run, externalIdentifier: 'CASCADE:11145' });
  assert.equal(checked.contentDigest, staged.contentDigest);
  assert.equal(checked.payloadDigest, staged.payloadDigest);
  assert.deepEqual(checked.canonicalSnapshot, value.batch.canonicalSnapshot);
  assert.equal(Object.isFrozen(checked.canonicalSnapshot), true);
});

test('candidate verification refuses missing, corrupted or differently bound durable records', async () => {
  for (const mode of ['missing', 'money', 'evidence', 'payload', 'hash', 'schema', 'selection', 'identity', 'time']) {
    const value = input(), db = database(), archive = createCandidateArchiveV2();
    if (mode !== 'missing') await archive.stage(db.client, value);
    if (mode === 'money') db.state.stored.canonical_snapshot.financing.allocations.value[0].money.amount = '999';
    if (mode === 'evidence') db.state.stored.source_evidence.variants[0].content = 'Forged';
    if (mode === 'payload') db.state.stored.payload_digest = 'a'.repeat(64);
    if (mode === 'hash') db.state.stored.evidence_sha256 = 'a'.repeat(64);
    if (mode === 'schema') db.state.stored.snapshot_schema_version = 1;
    if (mode === 'selection') db.state.stored.source_selection = 'CORDIS';
    if (mode === 'identity') db.state.stored.external_identifier = 'CASCADE:999';
    if (mode === 'time') db.state.stored.observed_at = new Date('2026-10-31T00:00:00.000Z');
    await assert.rejects(archive.verify(db.client, { run: value.run, externalIdentifier: 'CASCADE:11145' }), { code: 'FUNDING_V2_CANDIDATE_INVALID' }, mode);
  }
});

test('candidate verification binds the archived observation to the collected run without assuming the staging run is already observed', async () => {
  const value = input(), db = database(), archive = createCandidateArchiveV2();
  delete value.run.observed_at;
  await archive.stage(db.client, value);
  value.run.observed_at = new Date(observedAt);
  await archive.verify(db.client, { run: value.run, externalIdentifier: 'CASCADE:11145' });
  value.run.observed_at = '2026-10-30T23:45:39.461+01:00';
  await archive.verify(db.client, { run: value.run, externalIdentifier: 'CASCADE:11145' });
  for (const observation of ['2026-10-30T23:00:00.000Z', '2026-10-30T22:45:39.461', null, undefined, new Date('invalid')]) {
    value.run.observed_at = observation;
    await assert.rejects(archive.verify(db.client, { run: value.run, externalIdentifier: 'CASCADE:11145' }), { code: 'FUNDING_V2_CANDIDATE_INVALID' });
  }
  let invoked = false;
  Object.defineProperty(value.run, 'observed_at', { enumerable: true, get() { invoked = true; throw Error('private'); } });
  await assert.rejects(archive.verify(db.client, { run: value.run, externalIdentifier: 'CASCADE:11145' }), { code: 'FUNDING_V2_CANDIDATE_INVALID' });
  assert.equal(invoked, false);
});

test('only the trusted optional verification path allows absence; a present corrupt row still fails', async () => {
  const value = input(), db = database(), archive = createCandidateArchiveV2();
  assert.equal(await archive.verify(db.client, { run: value.run, externalIdentifier: 'CASCADE:11145', required: false }), null);
  await assert.rejects(archive.verify(db.client, { run: value.run, externalIdentifier: 'CASCADE:11145', required: 'false' }), { code: 'FUNDING_V2_CANDIDATE_INVALID' });
  await archive.stage(db.client, value);
  db.state.stored.payload_digest = 'f'.repeat(64);
  await assert.rejects(archive.verify(db.client, { run: value.run, externalIdentifier: 'CASCADE:11145', required: false }), { code: 'FUNDING_V2_CANDIDATE_INVALID' });
});

test('candidate storage preserves safe retry codes without exposing driver details', async () => {
  const value = input(), archive = createCandidateArchiveV2();
  const client = { async query() { throw Object.assign(new Error('private driver details'), { code: '40001' }); } };
  for (const operation of [() => archive.stage(client, value), () => archive.verify(client, { run: value.run, externalIdentifier: 'CASCADE:11145' })]) {
    await assert.rejects(operation(), error => error.code === '40001' && error.message === 'FUNDING_V2_ARCHIVE_UNAVAILABLE' && error.cause === undefined);
  }
});

test('candidate SQL is outside executable migrations and keeps discovery independent from catalogue identity', () => {
  const file = path.resolve(__dirname, '../database/central/candidates/funding_canonical_v2.up.sql');
  const sql = fs.readFileSync(file, 'utf8');
  assert.match(sql, /source_evidence json NOT NULL/);
  assert.match(sql, /octet_length\(canonical_snapshot::text\)<=262144/);
  assert.match(sql, /octet_length\(source_evidence::text\)<=2097152/);
  assert.match(sql, /PRIMARY KEY\(run_id,external_identifier\)/);
  assert.doesNotMatch(sql, /REFERENCES opportunity_catalog\.(funding_identity|opportunity|revision)\(/);
  assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../src/security/centralMigrationManifest.js'), 'utf8'), /funding_canonical_v2/);
});
