'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('../../../backend/node_modules/pg');
const s3 = require('../../../backend/node_modules/@aws-sdk/client-s3');
const { createDocumentRepository } = require('../../../backend/src/documents/repository');
const { createDocumentWorker } = require('../../../backend/src/documents/worker');
const { createScanService } = require('../../../backend/src/documents/scanService');
const { createClamavScanner } = require('../../../backend/src/documents/clamavScanner');
const { createR2AdapterBoundary } = require('../../../backend/src/documents/r2Adapter');
const { createProofSafeguards, reconstructProofJournal } = require('./r2-proof-safeguards');
const { target, databaseUrl, sha, providerClient, SAFEGUARD_LIMITS } = require('./group-c-r2');

const TENANT_DB = 'doc_mvp01_r2_tenant';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function restartInput(env = process.env) {
  const organizationId = env.DOC_MVP01_R2_RESTART_ORGANIZATION_ID;
  const versionId = env.DOC_MVP01_R2_RESTART_VERSION_ID;
  const objectKey = env.DOC_MVP01_R2_RESTART_OBJECT_KEY;
  const uploadId = env.DOC_MVP01_R2_RESTART_UPLOAD_ID;
  const objectId = typeof objectKey === 'string' ? objectKey.split('/').at(-1) : null;
  if (![organizationId, versionId, objectId].every(value => UUID.test(value || '')) || objectKey !== `${organizationId}/${objectId}`
    || typeof uploadId !== 'string' || !uploadId || uploadId.length > 1024 || /[\u0000-\u001f\u007f]/.test(uploadId)) {
    throw new Error('R2_RESTART_INPUT_INVALID');
  }
  return Object.freeze({ organizationId, versionId, objectKey, uploadId });
}

async function run() {
  if (process.env.DOC_MVP01_R2_CONTINUATION_PROOF !== 'C4G_DOC_MVP01_R2_CONTINUATION_V1') throw new Error('R2_CONTINUATION_AUTHORIZATION_REQUIRED');
  const approved = target();
  const { organizationId, versionId, objectKey, uploadId } = restartInput();
  const journalPath = path.join(approved.evidence, 'r2-proof-journal.jsonl'), journalBytes = fs.readFileSync(journalPath);
  const records = journalBytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
  if (records.at(-1)?.event !== 'JOURNAL_CLOSED') throw new Error('R2_RESTART_JOURNAL_NOT_CLOSED');
  const reconstructed = reconstructProofJournal(records);
  const safeguards = createProofSafeguards({ journalPath, proofTag: approved.runId, limits: SAFEGUARD_LIMITS,
    allowedBuckets: [approved.documentsBucket, approved.quarantineBucket], prefix: `${approved.runId}/`,
    allowedFetchOrigin: new URL(approved.configuration.endpoint).origin, resume: true });
  safeguards.recordJournalInterpretation({ sourceSequence: reconstructed.sequence, sourceSha256: sha(journalBytes).toUpperCase() });
  const client = providerClient(approved, safeguards);
  const tenant = new Pool({ connectionString: databaseUrl(approved.url, TENANT_DB), max: 3 });
  const repository = createDocumentRepository(tenant);
  const storage = createR2AdapterBoundary(approved.configuration, { organizationId, credentials: approved.credentials, client });
  const scanner = createClamavScanner({ organizationId, storage, host: '127.0.0.1', port: 53310, timeoutMs: 5000 });
  const audit = Object.freeze({ async accept() {}, async emit() {} });
  const reconciliation = Object.freeze({ async record() {} });
  const worker = createDocumentWorker({ portsForOrganization: requested => { assert.equal(requested, organizationId); return {
    repository, storage, scanService: createScanService({ scanner, repository, storage, audit }), audit, reconciliation }; } });
  try {
    const result = await worker.handlers['document.reconcile']({ payload: { organizationId, limit: 25 },
      fencingToken: `multipart-process-restart:${crypto.randomUUID()}` });
    assert(result.aborted.includes(versionId));
    const listed = await client.send(new s3.ListMultipartUploadsCommand({ Bucket: approved.quarantineBucket, Prefix: objectKey, MaxUploads: 100 }));
    assert.equal((listed.Uploads || []).some(item => item.Key === objectKey && item.UploadId === uploadId), false);
    process.stdout.write(`${JSON.stringify({ abortedVersionId: versionId, exactSessionAbsent: true })}\n`);
  } finally {
    await storage.shutdown().catch(() => {}); await tenant.end().catch(() => {}); safeguards.close();
  }
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${JSON.stringify({ name: error.name, code: error.code || null, message: error.code || error.name || 'R2_RESTART_FAILED' })}\n`);
  process.exitCode = 1;
});

module.exports = { run, restartInput };
