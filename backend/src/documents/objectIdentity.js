const crypto = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function createObjectIdentity({ documentId, versionId, storageClass = 'QUARANTINE', uuid = crypto.randomUUID }) {
  if (!UUID.test(documentId) || !UUID.test(versionId) || !['DOCUMENTS', 'QUARANTINE'].includes(storageClass)) throw new TypeError('Trusted object identity is invalid.');
  return Object.freeze({ namespace: storageClass, objectId: uuid(), documentId, versionId });
}
module.exports = { UUID, createObjectIdentity };
