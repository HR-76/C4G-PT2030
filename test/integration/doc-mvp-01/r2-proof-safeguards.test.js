'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProofSafeguards, reconstructProofJournal } = require('./r2-proof-safeguards');
const realS3 = require('../../../backend/node_modules/@aws-sdk/client-s3');
const { providerClient } = require('./group-c-r2');
const minimalProof = require('./r2-write-cleanup-proof');

class BaseCommand { constructor(input) { this.input = input; } }
class PutObjectCommand extends BaseCommand {}
class CreateMultipartUploadCommand extends BaseCommand {}
class UploadPartCommand extends BaseCommand {}
class CompleteMultipartUploadCommand extends BaseCommand {}
class AbortMultipartUploadCommand extends BaseCommand {}
class DeleteObjectCommand extends BaseCommand {}
class HeadObjectCommand extends BaseCommand {}
class ListMultipartUploadsCommand extends BaseCommand {}
class ListObjectsV2Command extends BaseCommand {}
class GetObjectCommand extends BaseCommand {}
const sdk = { PutObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand, DeleteObjectCommand, HeadObjectCommand, ListMultipartUploadsCommand, ListObjectsV2Command, GetObjectCommand };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const limits = Object.freeze({ functionalRequests: 4, cleanupRequests: 8, applicationBytes: 16,
  objectIntentions: 2, completedObjects: 1, multipartIntentions: 2, unresolvedMultipart: 1 });

function notFound() { return Object.assign(new Error('not found'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }); }
function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-r2-safeguards-'));
  const journalPath = path.join(root, 'journal.jsonl');
  const proofTag = crypto.randomUUID();
  const safeguards = createProofSafeguards({ journalPath, proofTag, limits: { ...limits, ...(overrides.limits || {}) },
    allowedBuckets: ['bucket'], prefix: 'run/', allowedFetchOrigin: 'https://example.invalid' });
  const calls = [], objects = new Map(), uploads = new Map();
  const client = { async send(command) {
    const name = command.constructor.name, input = command.input; calls.push({ name, input: { ...input } });
    if (overrides.handler) return overrides.handler({ name, input, calls, objects, uploads, proofTag });
    const key = `${input.Bucket}/${input.Key}`;
    if (name === 'PutObjectCommand') { objects.set(key, { Metadata: input.Metadata, ContentLength: input.ContentLength }); return { ETag: 'etag' }; }
    if (name === 'CreateMultipartUploadCommand') { const UploadId = crypto.randomUUID(); uploads.set(UploadId, { ...input, UploadId }); return { UploadId }; }
    if (name === 'CompleteMultipartUploadCommand') { const upload = uploads.get(input.UploadId); objects.set(key, { Metadata: upload.Metadata, ContentLength: 8 }); uploads.delete(input.UploadId); return { ETag: 'etag' }; }
    if (name === 'AbortMultipartUploadCommand') { uploads.delete(input.UploadId); return {}; }
    if (name === 'HeadObjectCommand') { if (!objects.has(key)) throw notFound(); return objects.get(key); }
    if (name === 'DeleteObjectCommand') { objects.delete(key); return {}; }
    if (name === 'ListMultipartUploadsCommand') return { Uploads: [...uploads.values()] };
    return {};
  }, destroy() {} };
  safeguards.instrumentClient(client);
  return { root, journalPath, proofTag, safeguards, client, calls, objects, uploads, close() {
    safeguards.close(); fs.rmSync(root, { recursive: true, force: true });
  } };
}
function intent(value, key = 'run/object') { return { Bucket: 'bucket', Key: key, sha256: sha(value), size: value.length }; }
async function withFixture(callback, options) { const value = fixture(options); try { await callback(value); } finally { value.close(); } }

const tests = [];
function test(name, callback) { tests.push({ name, callback }); }

test('reserves request and payload budgets before an operation', async () => withFixture(async ({ safeguards, client, calls }) => {
  const value = Buffer.alloc(9); safeguards.registerObjectIntent(intent(value));
  await assert.rejects(() => client.send(new PutObjectCommand({ Bucket: 'bucket', Key: 'run/object', Body: value,
    ContentLength: value.length, IfNoneMatch: '*', Metadata: { sha256: sha(value) } })), error => error.code === 'R2_PROOF_APPLICATION_BYTE_BUDGET_EXHAUSTED');
  assert.equal(calls.length, 0);
}, { limits: { applicationBytes: 8 } }));

test('counts a failed physical attempt and does not retry it', async () => withFixture(async ({ safeguards, client, calls }) => {
  const value = Buffer.alloc(4); safeguards.registerObjectIntent(intent(value));
  await assert.rejects(() => client.send(new PutObjectCommand({ Bucket: 'bucket', Key: 'run/object', Body: value,
    ContentLength: value.length, IfNoneMatch: '*', Metadata: { sha256: sha(value) } })), /lost/);
  assert.equal(calls.length, 1); assert.equal(safeguards.snapshot().functionalRequests, 1); assert.equal(safeguards.snapshot().applicationBytes, 4);
}, { handler() { throw new Error('response lost'); } }));

test('protects the cleanup reserve after the functional request budget is exhausted', async () => withFixture(async ({ safeguards, client, calls }) => {
  await client.send(new HeadObjectCommand({ Bucket: 'bucket', Key: 'run/one' })).catch(() => {});
  await assert.rejects(() => client.send(new HeadObjectCommand({ Bucket: 'bucket', Key: 'run/two' })), error => error.code === 'R2_PROOF_FUNCTIONAL_REQUEST_BUDGET_EXHAUSTED');
  await client.send(new HeadObjectCommand({ Bucket: 'bucket', Key: 'run/cleanup' }), { proofPhase: 'cleanup' }).catch(() => {});
  assert.equal(calls.length, 2); assert.deepEqual(safeguards.snapshot(), { functionalRequests: 1, cleanupRequests: 1,
    applicationBytes: 0, objectIntentions: 0, completedObjects: 0, multipartIntentions: 0, unresolvedMultipart: 0 });
}, { limits: { functionalRequests: 1 } }));

test('enforces cumulative object and multipart limits before provider operations', async () => withFixture(async ({ safeguards, client, calls }) => {
  const one = Buffer.from('one'), two = Buffer.from('two');
  safeguards.registerObjectIntent(intent(one, 'run/one'));
  assert.throws(() => safeguards.registerObjectIntent(intent(two, 'run/two')), error => error.code === 'R2_PROOF_OBJECT_INTENTION_LIMIT');
  const created = await client.send(new CreateMultipartUploadCommand({ Bucket: 'bucket', Key: 'run/one', Metadata: { sha256: sha(one) } }));
  await assert.rejects(() => client.send(new CreateMultipartUploadCommand({ Bucket: 'bucket', Key: 'run/one', Metadata: { sha256: sha(one) } })),
    error => error.code === 'R2_PROOF_UNRESOLVED_MULTIPART_LIMIT');
  assert(created.UploadId); assert.equal(calls.filter(call => call.name === 'CreateMultipartUploadCommand').length, 1);
}, { limits: { objectIntentions: 1, multipartIntentions: 2, unresolvedMultipart: 1 } }));

test('enforces the maximum completed-object reservations before provider operations', async () => withFixture(async ({ safeguards, client, calls }) => {
  const one = Buffer.from('one'), two = Buffer.from('two');
  safeguards.registerObjectIntent(intent(one, 'run/one')); safeguards.registerObjectIntent(intent(two, 'run/two'));
  await client.send(new PutObjectCommand({ Bucket: 'bucket', Key: 'run/one', Body: one, ContentLength: one.length,
    IfNoneMatch: '*', Metadata: { sha256: sha(one) } }));
  await assert.rejects(() => client.send(new PutObjectCommand({ Bucket: 'bucket', Key: 'run/two', Body: two, ContentLength: two.length,
    IfNoneMatch: '*', Metadata: { sha256: sha(two) } })), error => error.code === 'R2_PROOF_COMPLETED_OBJECT_LIMIT');
  assert.equal(calls.filter(call => call.name === 'PutObjectCommand').length, 1);
}));

test('preserves unknown concurrent resources during cleanup', async () => withFixture(async ({ safeguards, client, objects, calls, proofTag }) => {
  const known = Buffer.from('known'); safeguards.registerObjectIntent(intent(known, 'run/known'));
  await client.send(new PutObjectCommand({ Bucket: 'bucket', Key: 'run/known', Body: known, ContentLength: known.length,
    IfNoneMatch: '*', Metadata: { sha256: sha(known) } }));
  objects.set('bucket/run/concurrent', { Metadata: { c4gproof: 'another-run', sha256: sha(Buffer.from('other')) }, ContentLength: 5 });
  const result = await safeguards.cleanupKnownResources(client, sdk); assert.equal(result.status, 'COMPLETE');
  assert(objects.has('bucket/run/concurrent')); assert(!objects.has('bucket/run/known'));
  assert.equal(calls.some(call => call.name === 'DeleteObjectCommand' && call.input.Key === 'run/concurrent'), false);
  assert.equal(proofTag.length, 36);
}));

test('reconciles response-lost object creation only when provider metadata proves ownership', async () => {
  let lose = true;
  await withFixture(async ({ safeguards, client, objects, proofTag }) => {
    const value = Buffer.from('owned'); safeguards.registerObjectIntent(intent(value));
    await assert.rejects(() => client.send(new PutObjectCommand({ Bucket: 'bucket', Key: 'run/object', Body: value,
      ContentLength: value.length, IfNoneMatch: '*', Metadata: { sha256: sha(value) } })), /lost/);
    assert.equal(objects.get('bucket/run/object').Metadata.c4gproof, proofTag);
    const result = await safeguards.cleanupKnownResources(client, sdk); assert.equal(result.status, 'COMPLETE'); assert(!objects.has('bucket/run/object'));
  }, { handler({ name, input, objects }) {
    const key = `${input.Bucket}/${input.Key}`;
    if (name === 'PutObjectCommand') { objects.set(key, { Metadata: input.Metadata, ContentLength: input.ContentLength }); if (lose) { lose = false; throw new Error('response lost'); } }
    if (name === 'HeadObjectCommand') { if (!objects.has(key)) throw notFound(); return objects.get(key); }
    if (name === 'DeleteObjectCommand') { objects.delete(key); return {}; }
    return {};
  } });
});

test('does not abort a multipart session when its UploadId response was lost', async () => withFixture(async ({ safeguards, client, uploads, calls, journalPath }) => {
  const value = Buffer.from('multipart'); safeguards.registerObjectIntent(intent(value));
  await assert.rejects(() => client.send(new CreateMultipartUploadCommand({ Bucket: 'bucket', Key: 'run/object', Metadata: { sha256: sha(value) } })), /lost/);
  const result = await safeguards.cleanupKnownResources(client, sdk); assert.equal(result.status, 'UNCERTAIN');
  assert.equal(calls.some(call => call.name === 'AbortMultipartUploadCommand'), false); assert.equal(uploads.size, 1);
  safeguards.close();
  const records = fs.readFileSync(journalPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(reconstructProofJournal(records).budget.unresolvedMultipart, 1);
}, { handler({ name, input, uploads }) {
  if (name === 'CreateMultipartUploadCommand') { uploads.set('unknown-to-gate', { ...input, UploadId: 'unknown-to-gate' }); throw new Error('response lost'); }
  if (name === 'ListMultipartUploadsCommand') return { Uploads: [...uploads.values()] };
  return {};
} }));

test('records a known UploadId and aborts only that exact session', async () => withFixture(async ({ safeguards, client, uploads, calls }) => {
  const value = Buffer.from('multipart'); safeguards.registerObjectIntent(intent(value));
  const created = await client.send(new CreateMultipartUploadCommand({ Bucket: 'bucket', Key: 'run/object', Metadata: { sha256: sha(value) } }));
  uploads.set('foreign', { Bucket: 'bucket', Key: 'run/object', UploadId: 'foreign' });
  const result = await safeguards.cleanupKnownResources(client, sdk); assert.equal(result.status, 'COMPLETE');
  assert(uploads.has('foreign')); assert(!uploads.has(created.UploadId));
  assert.deepEqual(calls.filter(call => call.name === 'AbortMultipartUploadCommand').map(call => call.input.UploadId), [created.UploadId]);
}));

test('reconstructs a completed multipart session without treating it as unresolved on resume', async () => {
  const value = Buffer.alloc(8), state = fixture();
  try {
    state.safeguards.registerObjectIntent(intent(value));
    const created = await state.client.send(new CreateMultipartUploadCommand({ Bucket: 'bucket', Key: 'run/object', Metadata: { sha256: sha(value) } }));
    await state.client.send(new CompleteMultipartUploadCommand({ Bucket: 'bucket', Key: 'run/object', UploadId: created.UploadId,
      IfNoneMatch: '*', MultipartUpload: { Parts: [] } }));
    state.safeguards.close();
    const records = fs.readFileSync(state.journalPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(reconstructProofJournal(records).budget.unresolvedMultipart, 0);
    const resumed = createProofSafeguards({ journalPath: state.journalPath, proofTag: state.proofTag, limits,
      allowedBuckets: ['bucket'], prefix: 'run/', allowedFetchOrigin: 'https://example.invalid', resume: true });
    try {
      const resumedCalls = [], resumedClient = resumed.instrumentClient({ async send(command) {
        const name = command.constructor.name, input = command.input, key = `${input.Bucket}/${input.Key}`; resumedCalls.push(name);
        if (name === 'HeadObjectCommand') { if (!state.objects.has(key)) throw notFound(); return state.objects.get(key); }
        if (name === 'DeleteObjectCommand') { state.objects.delete(key); return {}; }
        if (name === 'ListMultipartUploadsCommand') return { Uploads: [] };
        throw new Error(`unexpected ${name}`);
      } });
      assert.equal((await resumed.cleanupKnownResources(resumedClient, sdk)).status, 'COMPLETE');
      assert.equal(resumedCalls.includes('AbortMultipartUploadCommand'), false);
    } finally { resumed.close(); }
  } finally { state.safeguards.close(); fs.rmSync(state.root, { recursive: true, force: true }); }
});

test('requires a completed multipart result to match the exact bucket, key, intent and UploadId', async () => {
  const value = Buffer.alloc(8), other = Buffer.alloc(8, 1), state = fixture({ limits: {
    functionalRequests: 8, objectIntentions: 2, completedObjects: 2, multipartIntentions: 2, unresolvedMultipart: 2 } });
  try {
    state.safeguards.registerObjectIntent(intent(value)); state.safeguards.registerObjectIntent(intent(other, 'run/other'));
    const created = await state.client.send(new CreateMultipartUploadCommand({ Bucket: 'bucket', Key: 'run/object', Metadata: { sha256: sha(value) } }));
    const different = await state.client.send(new CreateMultipartUploadCommand({ Bucket: 'bucket', Key: 'run/other', Metadata: { sha256: sha(other) } }));
    await state.client.send(new CompleteMultipartUploadCommand({ Bucket: 'bucket', Key: 'run/object', UploadId: created.UploadId,
      IfNoneMatch: '*', MultipartUpload: { Parts: [] } }));
    state.safeguards.close();
    const records = fs.readFileSync(state.journalPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const completed = records.find(record => record.event === 'OBJECT_RESULT' && record.operation === 'CompleteMultipartUploadCommand');
    completed.uploadId = different.UploadId;
    assert.throws(() => reconstructProofJournal(records), error => error.code === 'R2_PROOF_JOURNAL_MULTIPART_LINK_INVALID');
  } finally { state.safeguards.close(); fs.rmSync(state.root, { recursive: true, force: true }); }
});

test('accepts an exact duplicate multipart terminal event without closing another session twice', async () => {
  const value = Buffer.alloc(8), state = fixture();
  try {
    state.safeguards.registerObjectIntent(intent(value));
    const created = await state.client.send(new CreateMultipartUploadCommand({ Bucket: 'bucket', Key: 'run/object', Metadata: { sha256: sha(value) } }));
    await state.client.send(new CompleteMultipartUploadCommand({ Bucket: 'bucket', Key: 'run/object', UploadId: created.UploadId,
      IfNoneMatch: '*', MultipartUpload: { Parts: [] } }));
    state.safeguards.close();
    const records = fs.readFileSync(state.journalPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const index = records.findIndex(record => record.event === 'OBJECT_RESULT' && record.operation === 'CompleteMultipartUploadCommand');
    records.splice(index + 1, 0, { ...records[index] });
    for (let offset = index + 1; offset < records.length; offset += 1) records[offset].sequence = offset + 1;
    const reconstructed = reconstructProofJournal(records);
    assert.equal(reconstructed.budget.unresolvedMultipart, 0);
    assert.equal(reconstructed.interpreterVersion, 'r2-proof-journal-v2');
  } finally { state.safeguards.close(); fs.rmSync(state.root, { recursive: true, force: true }); }
});

test('rejects an invalid journal sequence before reconstructing any resume state', async () => {
  const state = fixture();
  try {
    state.safeguards.close();
    const records = fs.readFileSync(state.journalPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    records.at(-1).sequence += 1;
    assert.throws(() => reconstructProofJournal(records), error => error.code === 'R2_PROOF_JOURNAL_SEQUENCE_INVALID');
  } finally { state.safeguards.close(); fs.rmSync(state.root, { recursive: true, force: true }); }
});

test('reports partial cleanup and leaves durable evidence for recovery', async () => withFixture(async ({ safeguards, client, journalPath }) => {
  const value = Buffer.from('known'); safeguards.registerObjectIntent(intent(value));
  await client.send(new PutObjectCommand({ Bucket: 'bucket', Key: 'run/object', Body: value, ContentLength: value.length,
    IfNoneMatch: '*', Metadata: { sha256: sha(value) } }));
  const result = await safeguards.cleanupKnownResources(client, sdk); assert.equal(result.status, 'UNCERTAIN');
  const journal = fs.readFileSync(journalPath, 'utf8'); assert.match(journal, /CLEANUP_FINISHED/); assert.match(journal, /UNCERTAIN/);
}, { handler({ name, input, objects }) {
  const key = `${input.Bucket}/${input.Key}`;
  if (name === 'PutObjectCommand') { objects.set(key, { Metadata: input.Metadata, ContentLength: input.ContentLength }); return {}; }
  if (name === 'HeadObjectCommand') return objects.get(key);
  if (name === 'DeleteObjectCommand') throw new Error('cleanup outage');
  return {};
} }));

test('resumes cleanup from the durable journal after a process boundary', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-r2-resume-')), journalPath = path.join(root, 'journal.jsonl');
  const proofTag = crypto.randomUUID(), objects = new Map(), value = Buffer.from('durable'); let failDelete = true;
  const makeClient = safeguards => safeguards.instrumentClient({ async send(command) {
    const input = command.input, key = `${input.Bucket}/${input.Key}`, name = command.constructor.name;
    if (name === 'PutObjectCommand') { objects.set(key, { Metadata: input.Metadata, ContentLength: input.ContentLength }); return {}; }
    if (name === 'HeadObjectCommand') { if (!objects.has(key)) throw notFound(); return objects.get(key); }
    if (name === 'DeleteObjectCommand') { if (failDelete) throw new Error('temporary cleanup outage'); objects.delete(key); return {}; }
    return {};
  } });
  const configuration = { journalPath, proofTag, limits, allowedBuckets: ['bucket'], prefix: 'run/', allowedFetchOrigin: 'https://example.invalid' };
  const first = createProofSafeguards(configuration), firstClient = makeClient(first);
  try {
    first.registerObjectIntent(intent(value));
    await firstClient.send(new PutObjectCommand({ Bucket: 'bucket', Key: 'run/object', Body: value, ContentLength: value.length,
      IfNoneMatch: '*', Metadata: { sha256: sha(value) } }));
    assert.equal((await first.cleanupKnownResources(firstClient, sdk)).status, 'UNCERTAIN'); first.close(); failDelete = false;
    const resumed = createProofSafeguards({ ...configuration, resume: true }), resumedClient = makeClient(resumed);
    try { assert.equal((await resumed.cleanupKnownResources(resumedClient, sdk)).status, 'COMPLETE'); assert(!objects.has('bucket/run/object')); }
    finally { resumed.close(); }
    const journal = fs.readFileSync(journalPath, 'utf8'); assert.match(journal, /JOURNAL_RESUMED/); assert.match(journal, /REMOVED/);
  } finally { first.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('does not spend cleanup budget rechecking an object already proven absent', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-r2-absent-resume-')), journalPath = path.join(root, 'journal.jsonl');
  const proofTag = crypto.randomUUID(), value = Buffer.from('absent'); let calls = 0;
  const configuration = { journalPath, proofTag, limits, allowedBuckets: ['bucket'], prefix: 'run/', allowedFetchOrigin: 'https://example.invalid' };
  const first = createProofSafeguards(configuration), firstClient = first.instrumentClient({ async send(command) {
    calls += 1; if (command.constructor.name === 'PutObjectCommand') throw new Error('response lost'); throw notFound();
  } });
  try {
    first.registerObjectIntent(intent(value));
    await assert.rejects(() => firstClient.send(new PutObjectCommand({ Bucket: 'bucket', Key: 'run/object', Body: value,
      ContentLength: value.length, IfNoneMatch: '*', Metadata: { sha256: sha(value) } })), /response lost/);
    assert.equal((await first.cleanupKnownResources(firstClient, sdk)).status, 'COMPLETE'); first.close();
    const callsBeforeResume = calls, resumed = createProofSafeguards({ ...configuration, resume: true });
    try { assert.equal((await resumed.cleanupKnownResources(resumed.instrumentClient({ async send() { calls += 1; return {}; } }), sdk)).status, 'COMPLETE');
      assert.equal(calls, callsBeforeResume); }
    finally { resumed.close(); }
  } finally { first.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('reconstructs counters, records a larger authorized budget, and preserves removed objects', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-r2-budget-resume-')), journalPath = path.join(root, 'journal.jsonl');
  const proofTag = crypto.randomUUID(), value = Buffer.from('removed'), objects = new Map(); let calls = 0;
  const configuration = { journalPath, proofTag, limits, allowedBuckets: ['bucket'], prefix: 'run/', allowedFetchOrigin: 'https://example.invalid' };
  const first = createProofSafeguards(configuration), client = first.instrumentClient({ async send(command) {
    calls += 1; const name = command.constructor.name, input = command.input, key = `${input.Bucket}/${input.Key}`;
    if (name === 'PutObjectCommand') { objects.set(key, { Metadata: { c4gproof: proofTag, sha256: input.Metadata.sha256 }, ContentLength: input.ContentLength }); return {}; }
    if (name === 'HeadObjectCommand') { if (!objects.has(key)) throw notFound(); return objects.get(key); }
    if (name === 'DeleteObjectCommand') { objects.delete(key); return {}; }
    throw new Error(`unexpected ${name}`);
  } });
  try {
    first.registerObjectIntent(intent(value));
    await client.send(new PutObjectCommand({ Bucket: 'bucket', Key: 'run/object', Body: value, ContentLength: value.length,
      IfNoneMatch: '*', Metadata: { sha256: sha(value) } }));
    assert.equal((await first.cleanupKnownResources(client, sdk)).status, 'COMPLETE'); first.close();
    const beforeResumeCalls = calls, expanded = { ...limits, functionalRequests: 5, cleanupRequests: 9,
      objectIntentions: 3, completedObjects: 2 };
    const resumed = createProofSafeguards({ ...configuration, limits: expanded, resume: true });
    try {
      const authorization = resumed.recordBudgetAuthorization(limits, 'HUMAN_APPROVED_TEST');
      assert.equal(authorization.event, 'BUDGET_AUTHORIZATION_UPDATED');
      assert.deepEqual(authorization.previousLimits, limits); assert.deepEqual(authorization.approvedLimits, expanded);
      const interpretation = resumed.recordJournalInterpretation({ sourceSequence: 1, sourceSha256: 'A'.repeat(64) });
      assert.equal(interpretation.interpreterVersion, 'r2-proof-journal-v2'); assert.equal(interpretation.sourceSequence, 1);
      assert.equal((await resumed.cleanupKnownResources(resumed.instrumentClient({ async send() { calls += 1; return {}; } }), sdk)).status, 'COMPLETE');
      assert.equal(calls, beforeResumeCalls); resumed.close();
      const records = fs.readFileSync(journalPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.deepEqual(reconstructProofJournal(records).budget, resumed.snapshot());
      assert.equal(records.filter(record => record.event === 'BUDGET_AUTHORIZATION_UPDATED').length, 1);
    } finally { resumed.close(); }
  } finally { first.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('counts signed fetches without writing URLs, secrets, or document content to the journal', async () => withFixture(async ({ safeguards, journalPath }) => {
  const secret = 'SECRET-MUST-NOT-APPEAR', url = `https://example.invalid/private?token=${secret}`;
  const response = await safeguards.controlledFetch(async () => ({ ok: true }), url, { headers: { authorization: secret } }, { expectedBytes: 3 });
  assert.equal(response.ok, true); assert.equal(safeguards.snapshot().functionalRequests, 1); assert.equal(safeguards.snapshot().applicationBytes, 3);
  const journal = fs.readFileSync(journalPath, 'utf8'); assert(!journal.includes(secret)); assert(!journal.includes('example.invalid')); assert(!journal.includes('private'));
}));

test('copies frozen credentials before signing and records transport boundaries', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-r2-frozen-credentials-')), journalPath = path.join(root, 'journal.jsonl');
  const credentials = Object.freeze({ accessKeyId: 'SYNTHETIC_ACCESS_KEY', secretAccessKey: 'SYNTHETIC_SECRET_KEY' });
  const original = { ...credentials }; let reached = 0, signed = false;
  const safeguards = createProofSafeguards({ journalPath, proofTag: crypto.randomUUID(), limits,
    allowedBuckets: ['bucket'], prefix: 'run/', allowedFetchOrigin: 'https://example.invalid' });
  const requestHandler = { async handle(request) {
    reached += 1; signed = /^AWS4-HMAC-SHA256 /.test(request.headers?.authorization || '');
    throw Object.assign(new Error('LOCAL_TRANSPORT_REACHED'), { name: 'LocalTransportReached' });
  }, destroy() {} };
  const client = providerClient({ configuration: { endpoint: 'https://example.invalid' }, credentials }, safeguards, { requestHandler });
  try {
    await assert.rejects(() => client.send(new realS3.ListObjectsV2Command({ Bucket: 'bucket', Prefix: 'run/', MaxKeys: 1 })),
      error => error.name === 'LocalTransportReached');
    assert.equal(reached, 1); assert.equal(signed, true); assert.equal(Object.isFrozen(credentials), true);
    assert.deepEqual(credentials, original); assert.equal(Object.hasOwn(credentials, '$source'), false);
    safeguards.close();
    const records = fs.readFileSync(journalPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert(records.some(record => record.event === 'TRANSPORT_STARTED' && record.operation === 'ListObjectsV2Command'));
    assert(records.some(record => record.event === 'TRANSPORT_FAILED' && record.errorCode === 'LocalTransportReached'));
  } finally {
    client.destroy(); safeguards.close(); fs.rmSync(root, { recursive: true, force: true });
  }
});

test('minimal proof loads frozen synthetic configuration and reaches only its guarded transport', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-r2-minimal-configuration-')), journalPath = path.join(root, 'journal.jsonl');
  const endpoint = 'https://synthetic.eu.r2.cloudflarestorage.com/', credentials = Object.freeze({
    accessKeyId: 'SYNTHETIC_ACCESS_KEY', secretAccessKey: 'SYNTHETIC_SECRET_KEY' });
  const env = Object.freeze({ DOC_MVP01_R2_PROOF: minimalProof.PROOF, DOC_MVP01_R2_RUN_ID: minimalProof.RUN_ID,
    DOC_MVP01_R2_APPROVED_ENDPOINT_SHA256: sha(Buffer.from(endpoint)), DOC_MVP01_R2_APPROVED_BUCKET: minimalProof.BUCKET,
    DOC_MVP01_R2_EVIDENCE: root, C4G_R2_ENDPOINT: endpoint, C4G_R2_DOCUMENTS_BUCKET: 'synthetic-documents',
    C4G_R2_QUARANTINE_BUCKET: minimalProof.BUCKET, C4G_R2_ACCESS_KEY_ID: credentials.accessKeyId,
    C4G_R2_SECRET_ACCESS_KEY: credentials.secretAccessKey, C4G_CLAMAV_HOST: '127.0.0.1', C4G_CLAMAV_PORT: '53310' });
  const original = { ...env }, approved = minimalProof.target(env); let reached = 0, signed = false;
  const safeguards = createProofSafeguards({ journalPath, proofTag: minimalProof.RUN_ID, limits,
    allowedBuckets: [minimalProof.BUCKET], prefix: `${minimalProof.RUN_ID}/`, allowedFetchOrigin: new URL(endpoint).origin });
  const requestHandler = { async handle(request) { reached += 1; signed = /^AWS4-HMAC-SHA256 /.test(request.headers?.authorization || '');
    throw Object.assign(new Error('LOCAL_MINIMAL_TRANSPORT_REACHED'), { name: 'LocalMinimalTransportReached' }); }, destroy() {} };
  const client = providerClient(approved, safeguards, { requestHandler });
  try {
    assert.equal(await client.config.maxAttempts(), 1);
    await assert.rejects(() => client.send(new realS3.ListObjectsV2Command({ Bucket: minimalProof.BUCKET,
      Prefix: `${minimalProof.RUN_ID}/`, MaxKeys: 1 })), error => error.name === 'LocalMinimalTransportReached');
    await assert.rejects(() => client.send(new realS3.ListObjectsV2Command({ Bucket: 'synthetic-documents',
      Prefix: `${minimalProof.RUN_ID}/`, MaxKeys: 1 })), /R2_PROOF_OPERATION_OUTSIDE_APPROVED_BUCKET/);
    assert.equal(reached, 1); assert.equal(signed, true); assert.equal(Object.isFrozen(env), true); assert.deepEqual(env, original);
    assert.equal(Object.isFrozen(approved.credentials), true); assert.equal(Object.hasOwn(approved.credentials, '$source'), false);
  } finally { client.destroy(); safeguards.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

(async () => {
  let passed = 0;
  for (const item of tests) {
    try { await item.callback(); passed += 1; process.stdout.write(`ok ${passed} - ${item.name}\n`); }
    catch (error) { process.stderr.write(`not ok ${passed + 1} - ${item.name}\n${error.stack}\n`); process.exitCode = 1; return; }
  }
  process.stdout.write(`1..${tests.length}\n`);
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
