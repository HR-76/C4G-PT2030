const test = require('node:test');
const assert = require('node:assert/strict');
const { createApplicationDocumentTransport } = require('../src/documents/applicationTransport');

const ORG = '11111111-1111-4111-8111-111111111111';
const APP = '44444444-4444-4444-8444-444444444444';
const DOC = '55555555-5555-4555-8555-555555555555';
const VER = '66666666-6666-4666-8666-666666666666';
const OBJ = '77777777-7777-4777-8777-777777777777';

function build({ protectedDocument = false } = {}) {
  const log = [];
  const row = { document_id: DOC, version_id: VER, object_id: OBJ, storage_class: 'DOCUMENTS', state: 'AVAILABLE' };
  const repository = {
    async findVersion() { return row; },
    async beginDeletion() { log.push('begin'); return row; },
    async cancelDeletion() { log.push('cancel'); return row; },
    async finishDeletion() { log.push('finish'); return row; }
  };
  const accessPort = {
    async authorize({ operationCode }) { log.push(['authorize', operationCode]); return { context: { actor: { id: 'a', organizationId: ORG } } }; },
    async assertDeletable({ documentId }) { log.push(['guard', documentId]); if (protectedDocument) throw Object.assign(new Error('x'), { code: 'STATE_CONFLICT' }); }
  };
  const transport = createApplicationDocumentTransport({
    accessPort, jobs: {}, clock: () => new Date(),
    repositoryFactory: () => repository,
    storageFactory: () => ({ async deleteObject() { log.push('delete'); } }),
    auditFactory: () => ({ async accept(code) { log.push(['audit', code]); } }),
    reconciliationFactory: () => ({})
  });
  return { log, transport };
}

test('transporte: elimina com a autorização de quem pode carregar versões e guarda de candidatura', async () => {
  const { log, transport } = build();
  const result = await transport.deleteDocument({ request: {}, applicationId: APP, documentId: DOC, versionId: VER });
  assert.equal(result.state, 'DELETED');
  assert.deepEqual(log, [['authorize', 'DOCUMENT_VERSION_CREATE'], 'begin', ['guard', DOC], ['audit', 'DOCUMENT_LIFECYCLE_REQUESTED'], 'delete', 'finish']);
});

test('transporte: documento protegido não chega ao R2', async () => {
  const { log, transport } = build({ protectedDocument: true });
  await assert.rejects(transport.deleteDocument({ request: {}, applicationId: APP, documentId: DOC, versionId: VER }), { code: 'STATE_CONFLICT' });
  assert.equal(log.includes('delete'), false);
  assert.equal(log.at(-1), 'cancel');
});

test('transporte: identificadores inválidos são recusados antes de autorizar', async () => {
  const { log, transport } = build();
  await assert.rejects(transport.deleteDocument({ request: {}, applicationId: APP, documentId: 'x', versionId: VER }), { code: 'DOCUMENT_NOT_AVAILABLE' });
  assert.deepEqual(log, []);
});
