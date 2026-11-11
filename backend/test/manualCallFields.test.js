'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createCommand, createCentralCommand, editCommand } = require('../src/opportunities/httpContracts');
const { validateSnapshot } = require('../src/opportunities/contracts');
const { readOpportunitySnapshot } = require('../src/opportunities/v2/compatibility');
const { normalizeSnapshot } = require('../src/opportunities/normalization');
const { contentDigest, createIntentionDigest } = require('../src/opportunities/digests');
const ID = '01900000-0000-7000-8000-000000000001', AT = '2026-01-01T00:00:00.000Z';
const body = fields => ({ requestId: ID, fields: { title: 'Historical manual', funderName: 'Historical funder', summary: 'Original', ...fields } });
const limits = { geographySummary: 2000, eligibleGroups: 4000, eligibilitySummary: 4000 };

test('central manual texts preserve normalized paragraphs, remain optional and are plain declarations', () => {
  const fields = { geographySummary: '  Portugal\r\nRemoto  ', eligibleGroups: '  Associac\u0327o\u0303es\n\nPME  ', eligibilitySummary: '  Documento A\rDocumento B <b>literal</b>  ' };
  const command = createCentralCommand(body(fields), AT);
  assert.equal(command.snapshot.geographySummary, 'Portugal\nRemoto');
  assert.equal(command.snapshot.eligibleGroups, 'Associações\n\nPME');
  assert.equal(command.snapshot.eligibilitySummary, 'Documento A\nDocumento B <b>literal</b>');
  assert.equal(command.snapshot.validationState, 'PENDING_REVIEW');
  assert.ok(Object.isFrozen(command.snapshot));
  assert.deepEqual(readOpportunitySnapshot(command.snapshot).snapshot, command.snapshot);
  for (const name of Object.keys(limits)) assert.equal(Object.hasOwn(createCentralCommand(body(), AT).snapshot, name), false);
  assert.equal(command.snapshot.territoryCodes, undefined);
  assert.equal(command.snapshot.beneficiaryTypeCodes, undefined);
});

test('manual text fields enforce individual Unicode limits, types, aggregate text and payload bounds', () => {
  for (const [name, maximum] of Object.entries(limits)) {
    assert.equal([...createCentralCommand(body({ [name]: '😀'.repeat(maximum) }), AT).snapshot[name]].length, maximum);
    assert.throws(() => createCentralCommand(body({ [name]: 'x'.repeat(maximum + 1) }), AT), { code: 'OPPORTUNITY_LIMIT_EXCEEDED' });
    for (const invalid of [null, 1, [], {}, true]) {
      assert.throws(() => createCentralCommand(body({ [name]: invalid }), AT), { code: 'OPPORTUNITY_INVALID_INPUT' });
    }
  }
  const fields = { summary: 'x'.repeat(4000), geographySummary: 'x'.repeat(2000), eligibleGroups: 'x'.repeat(4000), eligibilitySummary: 'x'.repeat(4000), officialUrl: 'https://example.invalid/' + 'x'.repeat(1990), title: 'x'.repeat(300), funderName: 'x'.repeat(200), programmeName: 'x'.repeat(200), callReference: 'x'.repeat(128) };
  assert.throws(() => createCentralCommand(body(fields), AT), { code: 'OPPORTUNITY_LIMIT_EXCEEDED' });
  assert.throws(() => createCentralCommand(body({ summary: '😀'.repeat(4000), eligibleGroups: '😀'.repeat(4000), geographySummary: '😀'.repeat(2000) }), AT), { code: 'OPPORTUNITY_LIMIT_EXCEEDED' });
  assert.throws(() => createCentralCommand(body({ inventedRequirements: 'x' }), AT), { code: 'OPPORTUNITY_INVALID_INPUT' });
});

test('central form fields do not widen the private create or edit allowlists', () => {
  for (const name of Object.keys(limits)) {
    assert.throws(() => createCommand(body({ [name]: 'Declaration' }), AT), { code: 'OPPORTUNITY_INVALID_INPUT' });
    assert.throws(() => editCommand(ID, { requestId: ID, expectedRowVersion: 1, changes: { [name]: 'Declaration' } }), { code: 'OPPORTUNITY_INVALID_INPUT' });
  }
});

test('historical normalization and intention digests stay fixed; added texts bind the central intention', () => {
  const historical = createCommand(body(), AT);
  assert.equal(contentDigest(normalizeSnapshot(historical.snapshot)), 'ac4784d0c03499832df9059989441e65278e6664a27c63c70ce2c767593b66d1');
  assert.equal(createIntentionDigest(historical, 'CENTRAL', 'CENTRAL'), '957bf88ca2a825355f9e601ca1b993e40172f032f630a9e071e89665b6e72925');
  assert.deepEqual(createCentralCommand(body(), AT), historical);
  assert.deepEqual(validateSnapshot(historical.snapshot), historical.snapshot);
  const originalProjection = readOpportunitySnapshot(historical.snapshot).projection;
  for (const name of Object.keys(limits)) {
    const added = createCentralCommand(body({ [name]: 'Declaration' }), AT);
    const changed = createCentralCommand(body({ [name]: 'Changed' }), AT);
    assert.equal(contentDigest(normalizeSnapshot(added.snapshot)), contentDigest(normalizeSnapshot(historical.snapshot)));
    assert.notEqual(createIntentionDigest(added, 'CENTRAL', 'CENTRAL'), createIntentionDigest(historical, 'CENTRAL', 'CENTRAL'));
    assert.notEqual(createIntentionDigest(added, 'CENTRAL', 'CENTRAL'), createIntentionDigest(changed, 'CENTRAL', 'CENTRAL'));
    assert.equal(createIntentionDigest(added, 'CENTRAL', 'CENTRAL'), createIntentionDigest(createCentralCommand(body({ [name]: 'Declaration' }), '2026-01-02T00:00:00.000Z'), 'CENTRAL', 'CENTRAL'));
    // Existing eligibilitySummary retains its established legacy meaning. The
    // new free text does not invent canonical geographic/beneficiary concepts.
    if (name !== 'eligibilitySummary') assert.deepEqual(readOpportunitySnapshot(added.snapshot).projection, originalProjection);
  }
});
