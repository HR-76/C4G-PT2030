const test = require('node:test');
const assert = require('node:assert/strict');
const { FILE_CLASSES, LIMITS } = require('../src/documents/constants');
const { createDocumentRepository } = require('../src/documents/repository');

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function intent(expectedSize, overrides = {}) {
  return {
    organizationId: ORG, documentId: uuid(1), versionId: uuid(2), versionNumber: 1, objectId: uuid(3),
    resourceType: 'DOCUMENT_OWNER', resourceId: uuid(4), actorId: uuid(5), expectedSize, fileClass: 'PDF',
    checksum: 'a'.repeat(64), declaredMime: 'application/pdf', displayFilename: 'a.pdf', idempotencyKey: uuid(6),
    correlationId: uuid(7), causationId: null, capabilityDigest: 'b'.repeat(64),
    capabilityExpiresAt: '2026-11-11T12:00:00.000Z', ...overrides
  };
}

function fakeClient(used) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push([String(sql), params]);
      if (/SUM\(/i.test(sql)) return { rows: [{ used: String(used) }] };
      if (/RETURNING version_id/i.test(sql)) return { rows: [{ version_id: uuid(2), state: 'PENDING', lock_version: 0 }] };
      return { rows: [] };
    }
  };
}

async function reserve(used, size, overrides) {
  const client = fakeClient(used);
  const repository = createDocumentRepository({ async connect() { throw new Error('standalone not expected'); } });
  const run = () => repository.withClient(client, ORG, prepared => prepared.createIntent(intent(size, overrides)));
  return { client, run };
}

test('limites por ficheiro e quota por organização aprovados', () => {
  assert.equal(FILE_CLASSES.PDF.maxBytes, 20 * MiB);
  assert.equal(FILE_CLASSES.IMAGE.maxBytes, 10 * MiB);
  assert.equal(FILE_CLASSES.OOXML.maxBytes, 25 * MiB);
  assert.equal(LIMITS.organizationQuotaBytes, 2.5 * GiB);
  assert.equal(LIMITS.organizationQuotaBytes, 2684354560);
  // Um ficheiro nunca excede a quota e o multipart continua a caber nas partes disponíveis.
  for (const policy of Object.values(FILE_CLASSES)) assert.ok(policy.maxBytes <= LIMITS.partBytes * LIMITS.maxParts);
});

test('quota: reserva exatamente até ao limite é aceite', async () => {
  const { client, run } = await reserve(LIMITS.organizationQuotaBytes - 5 * MiB, 5 * MiB);
  const row = await run();
  assert.equal(row.version_id, uuid(2));
  assert.ok(client.calls.some(([sql]) => /INSERT INTO document_storage\.document_version/.test(sql)));
});

test('quota: um byte acima do limite é recusado sem reserva parcial', async () => {
  const { client, run } = await reserve(LIMITS.organizationQuotaBytes - 5 * MiB, 5 * MiB + 1);
  await assert.rejects(run, { code: 'DOCUMENT_QUOTA_EXCEEDED' });
  assert.equal(client.calls.some(([sql]) => /INSERT INTO/.test(sql)), false);
});

test('quota: admissão serializada por organização antes de somar', async () => {
  const { client, run } = await reserve(0, MiB);
  await run();
  const sqls = client.calls.map(([sql]) => sql);
  const lock = sqls.findIndex(sql => /pg_advisory_xact_lock/.test(sql));
  const sum = sqls.findIndex(sql => /SUM\(/i.test(sql));
  const insert = sqls.findIndex(sql => /INSERT INTO document_storage\.document\b/.test(sql));
  assert.ok(lock >= 0 && lock < sum && sum < insert);
  assert.deepEqual(client.calls[sum][1], [ORG]);
  assert.match(client.calls[lock][1][0], new RegExp(ORG));
});

test('quota: só liberta estados comprovadamente sem bytes; quarentena e versões antigas contam', async () => {
  const { client, run } = await reserve(0, MiB);
  await run();
  const sum = client.calls.find(([sql]) => /SUM\(/i.test(sql))[0];
  const excluded = /state NOT IN \(([^)]*)\)/.exec(sum)[1].replace(/['\s]/g, '').split(',').sort();
  assert.deepEqual(excluded, ['CANCELLED', 'DELETED', 'EXPIRED']);
});

test('quota: pedido de outra organização continua recusado pelo contexto tenant', async () => {
  const { run } = await reserve(0, MiB, { organizationId: OTHER });
  await assert.rejects(run, /tenant/);
});
