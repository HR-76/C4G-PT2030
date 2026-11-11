const test = require('node:test');
const assert = require('node:assert/strict');
const { createDocumentDeletionService } = require('../src/documents/deletionService');
const { createDocumentRepository } = require('../src/documents/repository');
const { assertObjectStoragePort } = require('../src/documents/objectStoragePort');
const { createF11ObjectStorageDouble: createDouble } = require('./support/f11ObjectStorageDouble');
const { createR2Storage } = require('../src/documents/r2Storage');

const ORG = '11111111-1111-4111-8111-111111111111';
const APP = '44444444-4444-4444-8444-444444444444';
const DOC = '55555555-5555-4555-8555-555555555555';
const VER = '66666666-6666-4666-8666-666666666666';
const OBJ = '77777777-7777-4777-8777-777777777777';
const context = { actor: { id: 'a', organizationId: ORG } };

function harness({ state = 'AVAILABLE', guardError = null, auditError = null, storageError = null, begin = true } = {}) {
  const log = [];
  const row = { document_id: DOC, version_id: VER, object_id: OBJ, storage_class: 'DOCUMENTS', state };
  const repository = {
    async findVersion() { log.push('find'); return row; },
    async beginDeletion(input) { log.push(['begin', input.fromState, input.resourceId]); return begin ? { ...row, state: 'DELETE_PENDING' } : null; },
    async cancelDeletion(input) { log.push(['cancel', input.toState]); return row; },
    async finishDeletion() { log.push('finish'); return { ...row, state: 'DELETED' }; }
  };
  const storage = { async deleteObject(input) { log.push(['delete', input.objectId, input.storageClass]); if (storageError) throw storageError; return { deleted: true }; } };
  const audit = { async accept(code) { log.push(['audit', code]); if (auditError) throw auditError; } };
  const guard = { async assertDeletable() { log.push('guard'); if (guardError) throw guardError; } };
  return { log, row, service: createDocumentDeletionService({ repository, storage, audit, guard }) };
}
const call = service => service.deleteDocument({ context, applicationId: APP, documentId: DOC, versionId: VER });

test('eliminação: reserva, guarda, auditoria crítica, remoção física e só depois DELETED', async () => {
  const { log, service } = harness();
  assert.deepEqual(await call(service), { documentId: DOC, versionId: VER, state: 'DELETED', replayed: false });
  assert.deepEqual(log, ['find', ['begin', 'AVAILABLE', APP], 'guard', ['audit', 'DOCUMENT_LIFECYCLE_REQUESTED'], ['delete', OBJ, 'DOCUMENT'.concat('S')], 'finish']);
});

test('eliminação: documento protegido é recusado e a reserva é revertida sem tocar no R2', async () => {
  const { log, service } = harness({ guardError: Object.assign(new Error('x'), { code: 'STATE_CONFLICT' }) });
  await assert.rejects(call(service), { code: 'STATE_CONFLICT' });
  assert.deepEqual(log, ['find', ['begin', 'AVAILABLE', APP], 'guard', ['cancel', 'AVAILABLE']]);
});

test('eliminação: falha da auditoria crítica reverte antes de apagar', async () => {
  const { log, service } = harness({ auditError: new Error('audit') });
  await assert.rejects(call(service), /audit/);
  assert.equal(log.some(entry => Array.isArray(entry) && entry[0] === 'delete'), false);
  assert.deepEqual(log.at(-1), ['cancel', 'AVAILABLE']);
});

test('eliminação: falha do R2 deixa DELETE_PENDING (bytes continuam a contar) e o retry retoma', async () => {
  const failing = harness({ storageError: Object.assign(new Error('r2'), { code: 'STORAGE_UNAVAILABLE' }) });
  await assert.rejects(call(failing.service), { code: 'STORAGE_UNAVAILABLE' });
  assert.equal(failing.log.includes('finish'), false);
  assert.equal(failing.log.some(entry => Array.isArray(entry) && entry[0] === 'cancel'), false);
  const retry = harness({ state: 'DELETE_PENDING' });
  assert.deepEqual(await call(retry.service), { documentId: DOC, versionId: VER, state: 'DELETED', replayed: true });
  assert.deepEqual(retry.log, ['find', ['delete', OBJ, 'DOCUMENTS'], 'finish']);
});

test('eliminação: já eliminado é idempotente; estados não elimináveis e documento alheio são recusados', async () => {
  assert.equal((await call(harness({ state: 'DELETED' }).service)).replayed, true);
  await assert.rejects(call(harness({ state: 'SCANNING' }).service), { code: 'STATE_CONFLICT' });
  await assert.rejects(call(harness({ begin: false }).service), { code: 'DOCUMENT_NOT_AVAILABLE' });
});

test('contrato de storage inclui deleteObject e o R2 trata ausência como removido', async () => {
  const double = createDouble();
  assert.equal(typeof assertObjectStoragePort(double).deleteObject, 'function');
  const sent = [];
  const configuration = { enabled: true, jurisdiction: 'eu', endpoint: 'https://x.eu.r2.cloudflarestorage.com', documentsBucket: 'docs-bucket', quarantineBucket: 'quarantine-bucket', bucketAccess: 'PRIVATE', capabilities: { layerCValidated: true } };
  let notFound = false;
  const client = { async send(command) { sent.push(command.constructor.name); if (notFound) throw Object.assign(new Error('nf'), { $metadata: { httpStatusCode: 404 } }); return {}; }, destroy() {} };
  let storage;
  try { storage = createR2Storage(configuration, { organizationId: ORG, credentials: { accessKeyId: 'k', secretAccessKey: 's' }, client }); }
  catch (error) { assert.fail(`R2 construction needs valid configuration in test: ${error.code || error.message}`); }
  assert.deepEqual(await storage.deleteObject({ objectId: OBJ, storageClass: 'DOCUMENTS' }), { deleted: true });
  notFound = true;
  assert.deepEqual(await storage.deleteObject({ objectId: OBJ }), { deleted: true });
  assert.deepEqual(sent, ['DeleteObjectCommand', 'DeleteObjectCommand']);
});

test('repositório: begin/cancel/finish chamam funções SQL com a organização e rejeitam outro tenant', async () => {
  const calls = [];
  const client = { async query(sql, params) { calls.push([String(sql), params]); return { rows: /document_storage\./.test(sql) ? [{ version_id: VER }] : [] }; } };
  const repository = createDocumentRepository({ async connect() { throw new Error('no'); } });
  await repository.withClient(client, ORG, async prepared => {
    await prepared.beginDeletion({ organizationId: ORG, documentId: DOC, versionId: VER, resourceId: APP, fromState: 'AVAILABLE' });
    await prepared.cancelDeletion({ organizationId: ORG, documentId: DOC, versionId: VER, toState: 'AVAILABLE' });
    await prepared.finishDeletion({ organizationId: ORG, documentId: DOC, versionId: VER });
  });
  const fn = calls.map(([sql]) => /document_storage\.(\w+)/.exec(sql)?.[1]).filter(Boolean);
  assert.deepEqual(fn, ['begin_document_deletion', 'cancel_document_deletion', 'finish_document_deletion']);
  await assert.rejects(repository.withClient(client, ORG, prepared => prepared.finishDeletion({ organizationId: '2'.repeat(8) + '-2222-4222-8222-222222222222', documentId: DOC, versionId: VER })), /tenant/);
});
