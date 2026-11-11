'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CONTINUATION_PROOF, CONTINUATION_PLAN, PLAN_TOTAL, EXPECTED_JOURNAL, assertPlanFits } = require('./group-c-r2-continuation');
const { SAFEGUARD_LIMITS } = require('./group-c-r2');
const { restartInput } = require('./group-c-r2-restart-worker');

const tests = [];
const test = (name, callback) => tests.push({ name, callback });

test('budgets every pending scenario without repeating the completed simple and full multipart proofs', () => {
  assert.equal(CONTINUATION_PROOF, 'C4G_DOC_MVP01_R2_CONTINUATION_V1');
  assert.deepEqual(Object.keys(CONTINUATION_PLAN), ['initialAndFinalInventory', 'readiness', 'remoteEffectRecoveryAndRevocation',
    'persistedMultipartRestart', 'eicarBlocked', 'scannerTimeoutRecovery', 'scannerUnavailableRecovery']);
  assert.equal(PLAN_TOTAL.functionalRequests, 32); assert.equal(PLAN_TOTAL.cleanupRequests, 14);
  assert.equal(PLAN_TOTAL.objectIntentions, 5); assert.equal(PLAN_TOTAL.completedObjects, 4);
  assert.equal(PLAN_TOTAL.multipartIntentions, 1); assert.equal(PLAN_TOTAL.unresolvedMultipart, 1);
  assert(PLAN_TOTAL.applicationBytes > 8 * 1024 * 1024); assert(PLAN_TOTAL.applicationBytes < 9 * 1024 * 1024);
});

test('fits the continuation into the existing cumulative authorization with the cleanup reserve intact', () => {
  const margin = assertPlanFits();
  assert.deepEqual(margin, { functionalRequestsRemaining: 1, cleanupRequestsRemaining: 5,
    applicationBytesRemaining: SAFEGUARD_LIMITS.applicationBytes - EXPECTED_JOURNAL.budget.applicationBytes - PLAN_TOTAL.applicationBytes,
    objectIntentionsRemaining: 0, completedObjectsRemaining: 0, multipartIntentionsRemaining: 0 });
  assert.equal(margin.applicationBytesRemaining, 8387443);
  assert.throws(() => assertPlanFits(EXPECTED_JOURNAL.budget, { ...SAFEGUARD_LIMITS, functionalRequests: 72 }));
});

test('makes non-eligibility, synthetic aging, process-memory discard and rehydration explicit', () => {
  const source = fs.readFileSync(path.join(__dirname, 'group-c-r2-continuation.js'), 'utf8');
  const beforeAge = source.indexOf("fencingToken: `not-eligible:");
  const restart = source.indexOf('await restartRuntime();', beforeAge);
  const age = source.indexOf("interval '6 minutes'", restart);
  const afterAge = source.indexOf("fencingToken: `eligible:", age);
  assert(beforeAge > 0 && restart > beforeAge && age > restart && afterAge > age);
  const multipartBefore = source.indexOf("fencingToken: `multipart-not-eligible:");
  const multipartAge = source.indexOf("interval '1 minute'", multipartBefore);
  const processBoundary = source.indexOf("group-c-r2-restart-worker.js", multipartAge);
  const journalResume = source.indexOf('createProofSafeguards({ journalPath', processBoundary);
  assert(multipartBefore > 0 && multipartAge > multipartBefore && processBoundary > multipartAge && journalResume > processBoundary);
  assert.match(source, /UPDATE document_storage\.document_version SET updated_at=/);
  assert.match(source, /UPDATE document_storage\.multipart_upload SET expires_at=/);
  const restartWorker = fs.readFileSync(path.join(__dirname, 'group-c-r2-restart-worker.js'), 'utf8');
  assert.match(restartWorker, /handlers\['document\.reconcile'\]/);
  assert.match(restartWorker, /ListMultipartUploadsCommand/);
});

test('keeps production recovery windows and the completed proof gate unchanged', () => {
  const continuation = fs.readFileSync(path.join(__dirname, 'group-c-r2-continuation.js'), 'utf8');
  const migration = fs.readFileSync(path.resolve(__dirname, '../../../backend/database/tenant/migrations/031_application_document_transport.up.sql'), 'utf8');
  assert.match(migration, /state='UPLOADING' AND v\.updated_at<=transaction_timestamp\(\)-interval '5 minutes'/);
  assert.doesNotMatch(continuation, /SIMPLE_UPLOAD_SCAN_AND_DOWNLOAD|CONDITIONAL_CREATE|phase = 'MULTIPART';/);
  assert.match(continuation, /ooxmlStructuralInspection: 'NOT_IMPLEMENTED'/);
});

test('binds the restart helper to exact persisted organization, object, version and UploadId values', () => {
  const organizationId = 'df1f6c0b-c107-4509-af52-73b4eefb244b';
  const versionId = '11111111-1111-4111-8111-111111111111';
  const objectId = '22222222-2222-4222-8222-222222222222';
  const input = restartInput({ DOC_MVP01_R2_RESTART_ORGANIZATION_ID: organizationId,
    DOC_MVP01_R2_RESTART_VERSION_ID: versionId, DOC_MVP01_R2_RESTART_OBJECT_KEY: `${organizationId}/${objectId}`,
    DOC_MVP01_R2_RESTART_UPLOAD_ID: 'synthetic-upload-id' });
  assert.deepEqual(input, { organizationId, versionId, objectKey: `${organizationId}/${objectId}`, uploadId: 'synthetic-upload-id' });
  assert.throws(() => restartInput({ DOC_MVP01_R2_RESTART_ORGANIZATION_ID: organizationId,
    DOC_MVP01_R2_RESTART_VERSION_ID: versionId, DOC_MVP01_R2_RESTART_OBJECT_KEY: `${organizationId}/not-a-uuid`,
    DOC_MVP01_R2_RESTART_UPLOAD_ID: 'synthetic-upload-id' }), /R2_RESTART_INPUT_INVALID/);
});

test('records real signed URL timing without persisting the signed URL', () => {
  const source = fs.readFileSync(path.join(__dirname, 'group-c-r2-continuation.js'), 'utf8');
  assert.match(source, /const issuanceStartedAt = new Date\(\)\.toISOString\(\);/);
  assert.match(source, /const issuedAt = new Date\(\)\.toISOString\(\);/);
  assert.match(source, /beforeExpiryVerificationAt/);
  assert.match(source, /afterExpiryVerificationAt/);
  assert.match(source, /inspectSignedCapability/);
  assert.doesNotMatch(source, /Math\.ceil\(\(Date\.parse\(download\.capability\.expiresAt\)/);
  assert.match(source, /Math\.max\(Date\.parse\(download\.capability\.expiresAt\), Date\.parse\(signedTiming\.signedExpiresAt\)\)/);
  const observation = source.slice(source.indexOf('observations.revocation = Object.freeze'), source.indexOf("phase = 'REMOTE_CLEANUP'"));
  assert.doesNotMatch(observation, /capability\.url/);
});

(async () => {
  let passed = 0;
  for (const item of tests) {
    try { await item.callback(); passed += 1; process.stdout.write(`ok ${passed} - ${item.name}\n`); }
    catch (error) { process.stderr.write(`not ok ${passed + 1} - ${item.name}\n${error.stack}\n`); process.exitCode = 1; return; }
  }
  process.stdout.write(`1..${tests.length}\n`);
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
