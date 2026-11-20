'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createFundingRepository } = require('../src/fundingTenders/repository');
const { createOrganizationMatching, projectMatchOpportunity, currentForMatching } = require('../src/organizationDirectory/matching');
const area = require('../src/organizationDirectory/thematicAreas');

const snapshot = require('../../context/references/opportunity-v2/examples/pt2030-8614.json');
function records(count) {
  return Array.from({ length: count }, (_, i) => {
    const copy = structuredClone(snapshot);
    copy.description.title.value = `Aviso ${i}`;
    return { opportunityId: '01900000-0000-7000-8000-' + String(i + 1).padStart(12, '0'), revisionId: '01900000-0000-7000-8000-' + String(900000 + i).padStart(12, '0'),
      lifecycleState: 'ACTIVE', temporalSnapshot: copy };
  });
}
function fixture(count) {
  const rows = records(count), sql = [];
  const repository = createFundingRepository({ clock: () => new Date('2026-11-01T12:00:00Z'), pool: { connect: async () => ({ release() {}, async query(text, values) {
    sql.push(text);
    if (text.startsWith('SELECT o.opportunity_id')) return { rows: rows.filter(row => !values[0] || row.opportunityId > values[0]).slice(0, 26) };
    return { rows: [] };
  } }) } });
  return { repository, sql };
}
const programmeReads = sql => sql.filter(text => text.startsWith('SELECT DISTINCT programme')).length;

test('the matching read of the catalogue skips the programme list and the per-opportunity presentation', async () => {
  const f = fixture(60);
  const page = await f.repository.listForMatching({});
  assert.equal(page.items.length, 25);
  assert.equal(programmeReads(f.sql), 0);
  for (const item of page.items) {
    assert.ok(item.readModel, 'matching projects from the read model');
    assert.equal(item.catalogPresentation, undefined);
    assert.equal(item.interventionClassification, undefined);
  }
  // The catalogue listing itself is unchanged.
  const listed = await f.repository.list({});
  assert.equal(programmeReads(f.sql), 1);
  assert.ok(listed.items[0].interventionClassification);
});

test('the matching read pages through the same opportunities and projects them exactly as the listing does', async () => {
  const f = fixture(60), asOf = '2026-11-01T12:00:00.000Z', today = '2026-11-01';
  async function all(read) { const items = []; let cursor; do { const page = await read(cursor ? { cursor } : {}); items.push(...page.items); cursor = page.nextCursor; } while (cursor); return items; }
  const listed = await all(query => f.repository.list(query)), matching = await all(query => f.repository.listForMatching(query));
  assert.equal(matching.length, 60);
  assert.deepEqual(matching.map(item => item.opportunityId), listed.map(item => item.opportunityId));
  const project = item => projectMatchOpportunity(item, { origin: 'CENTRAL', opportunityId: item.opportunityId, asOf });
  assert.deepEqual(matching.map(project), listed.map(project));
  assert.deepEqual(matching.map(item => currentForMatching(item, today)), listed.map(item => currentForMatching(item, today)));
});

test('the matching read accepts only a cursor', async () => {
  const f = fixture(1);
  for (const input of [{ q: 'x' }, { source: 'POCTEP' }, { interventionArea: 'DIGITAL' }, { sort: 'closing_asc' }, { cursor: 'not-a-uuid' }])
    await assert.rejects(f.repository.listForMatching(input), { code: 'INVALID_INPUT' });
});

test('matching uses the dedicated catalogue read when the reader offers one, and the listing otherwise', async () => {
  const areaId = (area.areas || area.catalog || [])[0]?.id || 'area';
  const directory = { execute: async () => ({ person: { active: true }, profile: { areaIds: [areaId] } }) };
  const opportunities = { list: async () => ({ items: [] }) };
  const calls = { list: 0, matching: 0 };
  const dedicated = createOrganizationMatching({ directory, opportunities,
    central: { list: async () => { calls.list++; return { items: [] }; }, listForMatching: async () => { calls.matching++; return { items: [] }; } } });
  assert.equal((await dedicated.execute({}, {})).state, 'READY');
  assert.deepEqual(calls, { list: 0, matching: 1 });
  const legacy = createOrganizationMatching({ directory, opportunities, central: { list: async () => { calls.list++; return { items: [] }; } } });
  assert.equal((await legacy.execute({}, {})).state, 'READY');
  assert.deepEqual(calls, { list: 1, matching: 1 });
});

test('the catalogue reader exposes the matching read', () => {
  const { createCatalogReader } = require('../src/fundingTenders/catalogReader');
  class Pool { on() {} end() { return Promise.resolve(); } }
  const reader = createCatalogReader({ env: { CATALOG_DATABASE_URL: 'postgresql://reader:secret@localhost:5432/central' }, Pool });
  assert.equal(typeof reader.listForMatching, 'function');
});
