const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createChatRetentionService, MIN_RETENTION_DAYS } = require('../src/applications/chatRetention');
const manifest = require('../src/security/tenantMigrationManifest');

const ORG = '11111111-1111-4111-8111-111111111111';

function fakePool({ rows = [], failAt = null } = {}) {
  const calls = [];
  let released = 0;
  const client = {
    async query(sql, params) {
      calls.push([String(sql), params]);
      if (failAt && String(sql).includes(failAt)) throw new Error('boom');
      return { rows: /purge_closed_application_chat_v1/.test(sql) ? rows : [] };
    },
    release() { released += 1; }
  };
  return { calls, released: () => released, pool: { async connect() { return client; } } };
}

test('retenção do chat: uma transação com o papel dedicado e a organização', async () => {
  const { calls, pool, released } = fakePool({ rows: [{ purged_application_id: 'a', purged_message_count: 3 }, { purged_application_id: 'b', purged_message_count: '2' }] });
  const result = await createChatRetentionService({ pool, organizationId: ORG, batchSize: 50 }).runOnce();
  assert.deepEqual(result, { applications: 2, messages: 5, more: false });
  assert.deepEqual(calls.map(([sql]) => sql.split('(')[0].trim()), ['BEGIN', 'SET LOCAL ROLE c4g_chat_retention_runtime', 'SELECT purged_application_id, purged_message_count FROM opportunity_catalog.purge_closed_application_chat_v1', 'COMMIT']);
  assert.deepEqual(calls[2][1], [ORG, 90, 50]);
  assert.equal(released(), 1);
});

test('retenção do chat: lote cheio indica que pode haver mais', async () => {
  const { pool } = fakePool({ rows: [{ purged_application_id: 'a', purged_message_count: 1 }] });
  assert.equal((await createChatRetentionService({ pool, organizationId: ORG, batchSize: 1 }).runOnce()).more, true);
});

test('retenção do chat: falha reverte e liberta a ligação', async () => {
  const { calls, pool, released } = fakePool({ failAt: 'purge_closed_application_chat_v1' });
  await assert.rejects(createChatRetentionService({ pool, organizationId: ORG }).runOnce(), /boom/);
  assert.equal(calls.at(-1)[0], 'ROLLBACK');
  assert.equal(calls.some(([sql]) => sql === 'COMMIT'), false);
  assert.equal(released(), 1);
});

test('retenção do chat: nunca abaixo de 90 dias e parâmetros válidos', () => {
  const { pool } = fakePool();
  assert.equal(MIN_RETENTION_DAYS, 90);
  for (const retentionDays of [89, 30, 0, -1, 90.5, '90']) assert.throws(() => createChatRetentionService({ pool, organizationId: ORG, retentionDays }), /shorter than 90|TypeError/);
  for (const batchSize of [0, 501, 1.5]) assert.throws(() => createChatRetentionService({ pool, organizationId: ORG, batchSize }), /batch size/);
  assert.throws(() => createChatRetentionService({ pool, organizationId: 'x' }), /organization/);
  assert.doesNotThrow(() => createChatRetentionService({ pool, organizationId: ORG, retentionDays: 180 }));
});

test('migração 040 registada depois da 039, com checksum do ficheiro e capacidade própria', () => {
  const entry = manifest.chatRetentionManifest.at(-1);
  assert.equal(entry.version, manifest.CHAT_RETENTION_SCHEMA_VERSION);
  assert.equal(entry.ordinal, 40);
  assert.equal(manifest.chatRetentionManifest.at(-2).version, manifest.DOCUMENT_DELETION_SCHEMA_VERSION);
  assert.ok(entry.capabilities.includes('APPLICATION_CHAT_RETENTION'));
  const sql = fs.readFileSync(path.resolve(__dirname, '../database/tenant/migrations/040_application_chat_retention.up.sql'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha256').update(sql, 'utf8').digest('hex'), entry.sqlChecksum);
  assert.throws(() => manifest.migrationSql(entry.version, 'down'), /irreversible/);
});

test('migração 040: piso de 90 dias, só estados finais, sem DELETE para o runtime', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../database/tenant/migrations/040_application_chat_retention.up.sql'), 'utf8');
  assert.match(sql, /p_retention_days < 90/);
  assert.match(sql, /a\.status IN \('APPROVED','REJECTED','CANCELLED','ARCHIVED'\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION opportunity_catalog\.purge_closed_application_chat_v1\(uuid, integer, integer\) FROM PUBLIC;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION[^;]*TO c4g_chat_retention_runtime;/);
  assert.doesNotMatch(sql, /GRANT[^;]*DELETE[^;]*c4g_opportunity_tenant_runtime/);
});
