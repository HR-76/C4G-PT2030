'use strict';
// Physical deletion of one document owned by an application. Order matters:
// 1) DELETE_PENDING reserves the document (no new links/downloads), 2) the guard
// refuses protected documents and the reservation is rolled back, 3) critical audit,
// 4) provider deletion, 5) DELETED, which is the only state that frees quota.
const DELETABLE = Object.freeze(['AVAILABLE', 'QUARANTINED', 'REJECTED']);
const error = code => Object.assign(new Error(code), { code });
function createDocumentDeletionService({ repository, storage, audit, guard }) {
  for (const [name, value] of Object.entries({ repository, storage, audit, guard })) if (!value) throw new TypeError(`Document deletion dependency ${name} is required.`);
  return Object.freeze({
    async deleteDocument({ context, applicationId, documentId, versionId }) {
      const organizationId = context.actor.organizationId;
      const row = await repository.findVersion({ organizationId, versionId });
      if (!row || row.document_id !== documentId) throw error('DOCUMENT_NOT_AVAILABLE');
      if (row.state === 'DELETED') return Object.freeze({ documentId, versionId, state: 'DELETED', replayed: true });
      const resumed = row.state === 'DELETE_PENDING';
      if (!resumed && !DELETABLE.includes(row.state)) throw error('STATE_CONFLICT');
      if (!resumed) {
        const reserved = await repository.beginDeletion({ organizationId, documentId, versionId, resourceId: applicationId, fromState: row.state });
        if (!reserved) throw error('DOCUMENT_NOT_AVAILABLE');
        try {
          await guard.assertDeletable({ organizationId, applicationId, documentId, versionId });
          await audit.accept('DOCUMENT_LIFECYCLE_REQUESTED', { context, documentId, versionId, result: 'DELETE' });
        } catch (failure) {
          await repository.cancelDeletion({ organizationId, documentId, versionId, toState: row.state });
          throw failure;
        }
      }
      // A failure here leaves DELETE_PENDING: bytes still count and the same request resumes safely.
      await storage.deleteObject({ objectId: row.object_id, storageClass: row.storage_class });
      const finished = await repository.finishDeletion({ organizationId, documentId, versionId });
      if (!finished) throw error('SERVICE_UNAVAILABLE');
      return Object.freeze({ documentId, versionId, state: 'DELETED', replayed: resumed });
    }
  });
}
module.exports = { DELETABLE, createDocumentDeletionService };
