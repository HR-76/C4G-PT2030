'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const s3 = require('../../../backend/node_modules/@aws-sdk/client-s3');
const { loadApplicationDocumentConfiguration } = require('../../../backend/src/config/applicationDocuments');
const { createProofSafeguards, reconstructProofJournal } = require('./r2-proof-safeguards');
const { providerClient } = require('./group-c-r2');

const PROOF = 'C4G_DOC_MVP01_R2_MINIMAL_WRITE_V1';
const RUN_ID = 'df1f6c0b-c107-4509-af52-73b4eefb244b';
const BUCKET = 'c4g-test-quarantine';
const EXPECTED_BASELINE = Object.freeze({ functionalRequests: 10, cleanupRequests: 1, applicationBytes: 40,
  objectIntentions: 1, completedObjects: 1, multipartIntentions: 0, unresolvedMultipart: 0 });
const LIMITS = Object.freeze({ functionalRequests: 64, cleanupRequests: 32, applicationBytes: 64 * 1024 * 1024,
  objectIntentions: 8, completedObjects: 7, multipartIntentions: 3, unresolvedMultipart: 2 });
const failure = code => Object.assign(new Error(code), { code });
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function target(env = process.env) {
  if (env.DOC_MVP01_R2_PROOF !== PROOF || env.DOC_MVP01_R2_RUN_ID !== RUN_ID) throw failure('R2_MINIMAL_PROOF_AUTHORIZATION_REQUIRED');
  const loaded = loadApplicationDocumentConfiguration(env), endpointHash = sha256(Buffer.from(loaded.r2.endpoint, 'utf8'));
  if (endpointHash !== env.DOC_MVP01_R2_APPROVED_ENDPOINT_SHA256) throw failure('R2_MINIMAL_PROOF_ENDPOINT_MISMATCH');
  if (loaded.r2.quarantineBucket !== BUCKET || env.DOC_MVP01_R2_APPROVED_BUCKET !== BUCKET) throw failure('R2_MINIMAL_PROOF_BUCKET_MISMATCH');
  const evidence = env.DOC_MVP01_R2_EVIDENCE;
  if (!evidence || !path.isAbsolute(evidence)) throw failure('R2_MINIMAL_PROOF_EVIDENCE_REQUIRED');
  return Object.freeze({ configuration: loaded.r2, credentials: loaded.credentials, endpointHash, evidence,
    runId: RUN_ID, bucket: BUCKET, prefix: `${RUN_ID}/` });
}

function currentBaseline(journalPath) {
  const records = fs.readFileSync(journalPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  if (!records.length || records[0].proofTag !== RUN_ID) throw failure('R2_MINIMAL_PROOF_JOURNAL_IDENTITY_MISMATCH');
  const reconstructed = reconstructProofJournal(records), last = records.at(-1);
  if (last.event !== 'JOURNAL_CLOSED') throw failure('R2_MINIMAL_PROOF_JOURNAL_NOT_CLOSED');
  assert.deepEqual(reconstructed.budget, EXPECTED_BASELINE);
  return reconstructed;
}

async function bodyBytes(body, maximum) {
  const chunks = []; let size = 0;
  for await (const raw of body) { const chunk = Buffer.from(raw); size += chunk.length;
    if (size > maximum) throw failure('R2_MINIMAL_PROOF_DOWNLOAD_TOO_LARGE'); chunks.push(chunk); }
  return Buffer.concat(chunks, size);
}

function sanitized(error, phase, budget) {
  return Object.freeze({ at: new Date().toISOString(), phase, error: Object.freeze({ name: error?.name || 'Error',
    code: error?.code || error?.name || 'R2_MINIMAL_PROOF_FAILED', message: error?.code || error?.name || 'R2_MINIMAL_PROOF_FAILED',
    httpStatusCode: error?.$metadata?.httpStatusCode || null, requestIdPresent: Boolean(error?.$metadata?.requestId),
    extendedRequestIdPresent: Boolean(error?.$metadata?.extendedRequestId), cfIdPresent: Boolean(error?.$metadata?.cfId) }), budget });
}

async function run() {
  const approved = target(), journalPath = path.join(approved.evidence, 'r2-proof-journal.jsonl');
  const initial = currentBaseline(journalPath), resultPath = path.join(approved.evidence, 'r2-minimal-write-cleanup-result.json');
  if (fs.existsSync(resultPath)) throw failure('R2_MINIMAL_PROOF_RESULT_ALREADY_EXISTS');
  const safeguards = createProofSafeguards({ journalPath, proofTag: approved.runId, limits: LIMITS,
    allowedBuckets: [approved.bucket], prefix: approved.prefix, allowedFetchOrigin: new URL(approved.configuration.endpoint).origin, resume: true });
  assert.deepEqual(safeguards.snapshot(), EXPECTED_BASELINE);
  const client = providerClient(approved, safeguards); let cleanup = null, phase = 'PREPARE', proofStarted = false;
  const marker = crypto.randomUUID(), content = Buffer.from(`C4G synthetic R2 write proof ${marker}\n`, 'utf8');
  assert(content.length <= 1024); const contentHash = sha256(content), key = `${approved.prefix}write-cleanup-${marker}`;
  try {
    safeguards.registerObjectIntent({ Bucket: approved.bucket, Key: key, sha256: contentHash, size: content.length }); proofStarted = true;
    phase = 'PUT_OBJECT';
    await client.send(new s3.PutObjectCommand({ Bucket: approved.bucket, Key: key, Body: content, ContentLength: content.length,
      ContentType: 'application/octet-stream', IfNoneMatch: '*', Metadata: { sha256: contentHash, purpose: 'minimal-write-cleanup-proof' } }));
    phase = 'HEAD_OBJECT';
    const head = await client.send(new s3.HeadObjectCommand({ Bucket: approved.bucket, Key: key }));
    assert.equal(Number(head.ContentLength), content.length); assert.equal(head.Metadata?.sha256, contentHash); assert.equal(head.Metadata?.c4gproof, RUN_ID);
    phase = 'GET_OBJECT';
    const fetched = await client.send(new s3.GetObjectCommand({ Bucket: approved.bucket, Key: key, Range: `bytes=0-${content.length - 1}` }));
    assert.deepEqual(await bodyBytes(fetched.Body, content.length), content);
    phase = 'CLEANUP'; cleanup = await safeguards.cleanupKnownResources(client, s3); proofStarted = false;
    assert.equal(cleanup.status, 'COMPLETE');
    const finalBudget = safeguards.snapshot(); assert.equal(finalBudget.functionalRequests - initial.budget.functionalRequests, 3);
    assert.equal(finalBudget.cleanupRequests - initial.budget.cleanupRequests, 3);
    const result = Object.freeze({ result: 'PASS', endpointSha256: approved.endpointHash, bucket: approved.bucket, prefix: approved.prefix,
      key, contentSha256: contentHash, contentBytes: content.length, cleanup, initialBudget: initial.budget, finalBudget });
    fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    if (proofStarted) cleanup = await safeguards.cleanupKnownResources(client, s3).catch(cleanupError => ({ status: 'UNCERTAIN', code: cleanupError.code || cleanupError.name }));
    const diagnostic = sanitized(error, phase, safeguards.snapshot()), failurePath = path.join(approved.evidence, `r2-minimal-write-cleanup-failure-${Date.now()}.json`);
    fs.writeFileSync(failurePath, `${JSON.stringify({ ...diagnostic, cleanup }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    error.diagnostic = diagnostic; error.failurePath = failurePath; throw error;
  } finally { client.destroy(); safeguards.close(); }
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${JSON.stringify({ code: error.code || error.name || 'R2_MINIMAL_PROOF_FAILED', diagnostic: error.diagnostic || null,
    failurePath: error.failurePath || null })}\n`); process.exitCode = 1;
});

module.exports = { run, target, currentBaseline, reconstructJournal: reconstructProofJournal, EXPECTED_BASELINE, RUN_ID, BUCKET, PROOF };
