'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildEvidence } = require('../src/fundingTenders/sourceEvidence');
const { verifyResolvedFields } = require('../src/fundingTenders/resolutions');
const { extractEnrichment } = require('../src/fundingTenders/enrichment');

function fixture() {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../context/references/opportunity-v2/evidence/eu-11145.json'), 'utf8'));
  const id = 'CASCADE:11145', evidence = buildEvidence(id, raw.results), resolutionId = randomUUID();
  const identity = { opportunity_id: randomUUID(), last_source_fields: { title: 'Preserved reviewed title' } };
  const input = { identity, previous: { snapshot: { sourceResolution: { resolutionId, sourceFingerprint: evidence.fingerprint } } },
    stored: { external_identifier: id, source_resolution_id: resolutionId, source_fields: structuredClone(identity.last_source_fields) },
    observedAt: '2026-10-30T22:45:39.461Z', enrichmentEnabled: true, requireArchive: true };
  const state = { archive: { resolution_id: resolutionId, source_fingerprint: evidence.fingerprint, evidence }, calls: [] };
  const client = { async query(sql, parameters) {
    assert.match(sql, /FROM opportunity_catalog\.funding_resolution/);
    state.calls.push(parameters);
    return { rows: state.archive ? [state.archive] : [] };
  } };
  return { input, state, client };
}

test('v2 archive exemption verifies the P2 archive even when staged and previous fields are identical', async () => {
  for (const mode of ['missing', 'resolution', 'fingerprint', 'evidence', 'identity']) {
    const f = fixture();
    if (mode === 'missing') f.state.archive = null;
    if (mode === 'resolution') f.state.archive.resolution_id = randomUUID();
    if (mode === 'fingerprint') f.state.archive.source_fingerprint = 'f'.repeat(64);
    if (mode === 'evidence') f.state.archive.evidence.fingerprint = 'f'.repeat(64);
    if (mode === 'identity') f.input.stored.external_identifier = 'CASCADE:999';
    assert.equal(await verifyResolvedFields(f.client, f.input), false, mode);
    assert.equal(f.state.calls.length, 1, mode);
  }
});

test('strict P2 verification binds the archive query before accepting equal fields or a rederived overlay', async () => {
  for (const enrichmentEnabled of [false, true]) {
    const f = fixture(); f.input.enrichmentEnabled = enrichmentEnabled;
    assert.equal(await verifyResolvedFields(f.client, f.input), true);
    assert.deepEqual(f.state.calls, [[f.input.previous.snapshot.sourceResolution.resolutionId, f.input.identity.opportunity_id, f.input.stored.external_identifier]]);
  }
  const f = fixture();
  f.input.stored.source_fields.sourceEnrichment = extractEnrichment(f.state.archive.evidence.variants, {
    externalIdentifier: f.input.stored.external_identifier, observedAt: f.input.observedAt
  });
  assert.equal(await verifyResolvedFields(f.client, f.input), true);
  f.input.stored.source_fields.title = 'Unreviewed change';
  assert.equal(await verifyResolvedFields(f.client, f.input), false);
});

test('legacy P2 equality remains compatible when canonical archive verification is not requested', async () => {
  const f = fixture();
  delete f.input.requireArchive;
  f.input.enrichmentEnabled = false;
  f.state.archive = null;
  assert.equal(await verifyResolvedFields(f.client, f.input), true);
  assert.equal(f.state.calls.length, 0);
  f.input.stored.source_fields.title = 'Unreviewed change';
  assert.equal(await verifyResolvedFields(f.client, f.input), false);
  assert.equal(f.state.calls.length, 0);
});
