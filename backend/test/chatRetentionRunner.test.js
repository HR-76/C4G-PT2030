const test = require('node:test');
const assert = require('node:assert/strict');
const { runChatRetention } = require('../src/applications/chatRetentionRunner');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function fakeTenants(script) {
  // script: organizationId -> array of outcomes per runOnce call (rows or an Error)
  const state = { opened: [], closed: [], queries: [] };
  return {
    state,
    listTenants: async () => Object.keys(script).map(organizationId => ({ organizationId })),
    openTenant: async tenant => {
      state.opened.push(tenant.organizationId);
      const outcomes = [...script[tenant.organizationId]];
      const client = {
        async query(sql, params) {
          state.queries.push(String(sql).split('(')[0].trim());
          if (!/purge_closed_application_chat_v1/.test(sql)) return { rows: [] };
          const next = outcomes.shift() ?? [];
          if (next instanceof Error) throw next;
          return { rows: next.map(([id, count]) => ({ purged_application_id: id, purged_message_count: count })) };
        },
        release() {}
      };
      return { pool: { async connect() { return client; } }, close: async () => { state.closed.push(tenant.organizationId); } };
    }
  };
}

test('executor: repete lotes cheios até esgotar e soma por organização', async () => {
  const { state, listTenants, openTenant } = fakeTenants({ [A]: [[['a1', 3], ['a2', 2]], [['a3', 1], ['a4', 1]], [['a5', 4]]] });
  const logs = [];
  const summary = await runChatRetention({ listTenants, openTenant, batchSize: 2, log: entry => logs.push(entry) });
  assert.deepEqual(summary, { tenants: 1, applications: 5, messages: 11, failures: 0, incomplete: 0 });
  assert.deepEqual(state.closed, [A]);
  assert.equal(logs.at(-1).event, 'CHAT_RETENTION_RUN_DONE');
});

test('executor: falha de uma organização não impede as seguintes e fica contada', async () => {
  const { state, listTenants, openTenant } = fakeTenants({ [A]: [Object.assign(new Error('x'), { code: 'BOOM' })], [B]: [[['b1', 2]]] });
  const logs = [];
  const summary = await runChatRetention({ listTenants, openTenant, log: entry => logs.push(entry) });
  assert.deepEqual(summary, { tenants: 1, applications: 1, messages: 2, failures: 1, incomplete: 0 });
  assert.deepEqual(state.closed, [A, B]);
  assert.deepEqual(logs.find(entry => entry.event === 'CHAT_RETENTION_TENANT_FAILED'), { event: 'CHAT_RETENTION_TENANT_FAILED', organizationId: A, code: 'BOOM' });
});

test('executor: limite de lotes evita ciclos infinitos e assinala trabalho por concluir', async () => {
  const endless = Array.from({ length: 10 }, () => [['x', 1]]);
  const { listTenants, openTenant } = fakeTenants({ [A]: endless });
  const summary = await runChatRetention({ listTenants, openTenant, batchSize: 1, maxBatches: 3 });
  assert.equal(summary.incomplete, 1);
  assert.equal(summary.applications, 3);
});

test('executor: registos nunca incluem texto e parâmetros inválidos são recusados', async () => {
  const { listTenants, openTenant } = fakeTenants({ [A]: [[['a1', 1]]] });
  const logs = [];
  await runChatRetention({ listTenants, openTenant, log: entry => logs.push(entry) });
  assert.ok(logs.every(entry => !Object.keys(entry).some(key => /body|text|message(?!s)/i.test(key))));
  await assert.rejects(runChatRetention({ listTenants, openTenant, maxBatches: 0 }), /batch cap/);
  await assert.rejects(runChatRetention({}), /tenant adapters/);
});

test('executor: retenção abaixo de 90 dias conta como falha da organização, não corre nada', async () => {
  const { state, listTenants, openTenant } = fakeTenants({ [A]: [[['a1', 1]]] });
  const summary = await runChatRetention({ listTenants, openTenant, retentionDays: 30 });
  assert.equal(summary.failures, 1);
  assert.equal(state.queries.some(query => /purge_closed/.test(query)), false);
});
