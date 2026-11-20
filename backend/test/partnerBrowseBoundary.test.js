'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { canonicalize } = require('../src/organizationalProfile/canonicalization');
const { createPartnersRepository } = require('../src/applications/partners');

const org = '00000000-0000-4000-8000-000000000001';
function fixture(count, allowed = () => true, transform = row => row) {
  const stats = { selected: 0, authorizationCalls: 0, limits: [] };
  const rows = Array.from({ length: count }, (_, index) => ({
    partner_id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    application_id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    opportunity_id: '30000000-0000-4000-8000-000000000001',
    evaluation_id: null, application_title: 'Candidatura', application_status: 'PREPARATION',
    opportunity_title: 'Oportunidade', created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:00Z',
    body: { entity_name: `Parceiro ${String(index).padStart(5, '0')}`, country: 'Portugal',
      research_area_interest: '', responsible_person: '', contact: '', email: '', people: [] }
  })).map(transform);
  const client = { async query(sql, values) {
    if (sql.includes('to_regclass')) return { rows: [{ relation: 'application_partner' }] };
    assert.ok(sql.includes('WHERE p.organization_id=$1'), 'SQL retains tenant scoping');
    assert.equal(values[0], org);
    const limit = Number(sql.match(/LIMIT (\d+)/)[1]);
    stats.limits.push(limit);
    const start = values[1] ? rows.findIndex(row => row.partner_id === values[1]) + 1 : 0;
    const selected = rows.slice(start, start + limit);
    stats.selected += selected.length;
    return { rows: selected };
  } };
  const repository = createPartnersRepository({ organizationId: org, actor: { id: 'actor' },
    protect: async () => {}, audit: async () => {},
    authorize: async (operation, target) => { stats.authorizationCalls++; return allowed(operation, target); },
    cursor: { cursor: (position, binding) => JSON.stringify({ position, binding }),
      openCursor: (token, binding) => { const value = JSON.parse(token); assert.deepEqual(value.binding, binding); return value.position; } }
  });
  const input = { q: '', country: '', person_role: '', cursor: null };
  return { stats, browse: overrides => repository.partnersBrowse(client, null, { ...input, ...overrides }) };
}

test('partners allows exactly 10000 candidates and preserves page totals and cursor', async () => {
  const { browse, stats } = fixture(10000);
  const first = await browse();
  assert.equal(first.total, 10000); assert.equal(first.items.length, 25); assert.equal(first.page, 1);
  assert.deepEqual(first.countries, ['Portugal']); assert.equal(first.previousCursor, null);
  assert.equal(stats.limits.at(-1), 1, 'bounded exhaustion probe');
  assert.equal(stats.selected, 10000);
  const second = await browse({ cursor: first.nextCursor });
  assert.equal(second.page, 2); assert.equal(second.total, first.total);
  assert.ok(second.items.every(item => !first.items.some(prior => prior.id === item.id)));
});

test('partners refuses the 10001st candidate without authorizing overflow', async () => {
  const { browse, stats } = fixture(10001);
  await assert.rejects(browse(), { code: 'LIMIT_EXCEEDED' });
  assert.equal(stats.selected, 10001);
  assert.equal(stats.limits.at(-1), 1);
  assert.equal(stats.authorizationCalls, 20000);
});

test('partners retains empty, filtered and denied results below the boundary', async () => {
  assert.equal((await fixture(0).browse()).total, 0);
  const denied = fixture(100, operation => operation !== 'APPLICATION_READ');
  assert.equal((await denied.browse()).total, 0);
  assert.deepEqual((await denied.browse()).countries, []);
  assert.equal((await fixture(26).browse({ q: '00025' })).total, 1);
  const first = await fixture(26).browse();
  const changed = JSON.parse(first.nextCursor); changed.position.digest = 'changed';
  await assert.rejects(fixture(26).browse({ cursor: JSON.stringify(changed) }), { code: 'INVALID_CURSOR' });
});

test('partner page digests remain byte-compatible with existing canonical cursors', async () => {
  const { browse } = fixture(26, () => true, row => ({ ...row, body: { ...row.body,
    entity_name: `Ciência "A"\n${row.body.entity_name}`, research_area_interest: 'Investigação / educação',
    people: [{ id: row.partner_id, name: 'Inês', role: 'OUTRO', research_area: 'Saúde',
      contact: 'Linha\\extensão', email: 'ines@example.org', active: true }]
  } }));
  const first = await browse();
  const second = await browse({ cursor: first.nextCursor });
  const legacyDigest = createHash('sha256').update(canonicalize([...first.items, ...second.items])).digest('hex');
  assert.equal(JSON.parse(first.nextCursor).position.digest, legacyDigest);
  assert.equal(JSON.parse(second.previousCursor).position.digest, legacyDigest);
});

test('the cross-application partner list is refused to profiles that may not browse it, before any read', async () => {
  const queries = []; let protectedCalls = 0;
  const repository = createPartnersRepository({ organizationId: org, actor: { id: 'actor' }, protect: async () => { protectedCalls++; }, audit: async () => {},
    authorize: async () => true, browseAllowed: async () => false, cursor: { cursor: String, openCursor: String } });
  await assert.rejects(repository.partnersBrowse({ query: async sql => { queries.push(sql); return { rows: [] }; } }, null, { q: '', country: '', person_role: '', cursor: null }), { code: 'NOT_AUTHORIZED' });
  assert.equal(queries.length, 0); assert.equal(protectedCalls, 1);
});
