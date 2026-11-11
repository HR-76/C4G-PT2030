'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRepository } = require('../src/prequalification/repository');
const { tuple, limits } = require('../src/prequalification/release');
const { digest } = require('../src/organizationalProfile/pq1Material');

function fixture() {
  const calls = [];
  let transaction = '42';
  const client = { async query(sql) {
    calls.push(sql);
    if (sql.startsWith('SET LOCAL ROLE') || sql.includes('set_config(')) return { rows: [] };
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [{ id: '42' }] };
    if (sql === 'SHOW transaction_isolation') return { rows: [{ transaction_isolation: 'read committed' }] };
    if (sql.includes('FROM organization_profile.pq1_effective_release')) return { rows: [{ definition: { tuple, limits }, definition_digest: digest({ tuple, limits }) }] };
    if (sql === 'SELECT pg_current_xact_id()::text AS id') return { rows: [{ id: transaction }] };
    if (sql.includes('FROM organization_profile.profile_active_baseline')) return { rows: [] };
    if (sql.includes('FROM organization_profile.pq1_publication')) return { rows: [] };
    throw Error(`Unexpected query: ${sql}`);
  } };
  const repository = createRepository({ organizationId: 'org', actor: { id: 'actor', type: 'HUMAN' },
    protect: async () => calls.push('protect'), audit: async () => calls.push('audit'),
    ui: { capability: async () => ({ allowed: true }) } });
  return { repository, client, calls, changeTransaction: () => { transaction = '43'; } };
}

test('active read authorizes before returning and audits after transaction verification', async () => {
  const { repository, client, calls } = fixture();
  assert.deepEqual(await repository.run(client, 'active', {}), { active: null });
  assert.ok(calls.indexOf('protect') < calls.lastIndexOf('SELECT pg_current_xact_id()::text AS id'));
  assert.ok(calls.indexOf('audit') > calls.indexOf('protect'));
});

test('context preserves empty page, capability and active baseline', async () => {
  const { repository, client } = fixture();
  assert.deepEqual(await repository.run(client, 'context', { cursor: null }),
    { items: [], nextCursor: null, canEvaluate: true, active: null });
});

test('transaction change refuses before authorization or audit', async () => {
  const { repository, client, calls, changeTransaction } = fixture();
  changeTransaction();
  await assert.rejects(repository.run(client, 'active', {}), { code: 'TRANSACTION_REQUIRED' });
  assert.equal(calls.includes('protect'), false);
  assert.equal(calls.includes('audit'), false);
});

test('a failed authorization does not emit an access audit', async () => {
  const { client } = fixture();
  let audited = false;
  const repository = createRepository({ organizationId: 'org', actor: { id: 'actor' },
    protect: async () => { throw Object.assign(new Error('denied'), { code: 'DENIED' }); },
    audit: async () => { audited = true; } });
  await assert.rejects(repository.run(client, 'active', {}), { code: 'DENIED' });
  assert.equal(audited, false);
});

test('an invalid activation cursor is rejected before the page query', async () => {
  const { client, calls } = fixture();
  const repository = createRepository({ organizationId: 'org', actor: { id: 'actor' },
    protect: async () => {}, audit: async () => {}, ui: { openCursor: () => 0 } });
  await assert.rejects(repository.run(client, 'activations', { cursor: 'bad' }), { code: 'INVALID_CURSOR' });
  assert.equal(calls.some(sql => sql.includes('FROM organization_profile.pq1_activation')), false);
});
