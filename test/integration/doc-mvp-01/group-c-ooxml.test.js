'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { Readable } = require('node:stream');
const sdk = require('../../../backend/node_modules/@aws-sdk/client-s3');
const { createOoxmlStructuralInspector } = require('../../../backend/src/documents/ooxmlStructuralInspector');
const { createScanService } = require('../../../backend/src/documents/scanService');
const { createR2Storage } = require('../../../backend/src/documents/r2Storage');
const { BASELINE, LIMITS, PLAN, PROOF, SCENARIOS, approvedTarget, assertPlanFits } = require('./group-c-ooxml');
const { FIXTURE_IDS, fixture } = require('./ooxml-proof-fixtures');

const ORGANIZATION = '11111111-1111-4111-8111-111111111111';
const VERSION = '22222222-2222-4222-8222-222222222222';
const OBJECT = '33333333-3333-4333-8333-333333333333';

function storageFor(value, { stall = false } = {}) {
  const state = { ranges: 0, closed: 0 };
  return Object.freeze({
    state,
    async head() { return { size: value.size, sha256: value.sha256, etag: 'fixture-etag' }; },
    async readRange({ start, end, signal }) {
      state.ranges += 1;
      if (stall) {
        const source = new Readable({ read() {} });
        source.once('close', () => { state.closed += 1; });
        signal?.addEventListener('abort', () => source.destroy(), { once: true });
        return source;
      }
      const source = Readable.from([value.bytes.subarray(start, end + 1)]);
      source.once('close', () => { state.closed += 1; }); return source;
    }
  });
}

function recordFor(value, lockVersion = 0) {
  return Object.freeze({ organizationId: ORGANIZATION, versionId: VERSION, objectId: OBJECT, lockVersion,
    observedSize: value.size, expectedSize: value.size, sha256: value.sha256, expectedSha256: value.sha256,
    expectedFileClass: 'OOXML', declaredMime: value.mime, displayFilename: value.filename,
    state: 'SCANNING', scanState: 'PENDING' });
}

async function collect(source) {
  const chunks = []; for await (const raw of source) chunks.push(Buffer.from(raw)); return Buffer.concat(chunks);
}

test('future remote target is closed over destination, scanner endpoint and cumulative budgets', () => {
  const endpoint = 'https://synthetic.eu.r2.cloudflarestorage.com';
  const values = {
    DOC_MVP01_R2_RUN_ID: 'df1f6c0b-c107-4509-af52-73b4eefb244b', DOC_MVP01_R2_OOXML_PROOF: PROOF,
    DOC_MVP01_R2_ADMIN_URL: 'postgresql://synthetic@127.0.0.1:55431/postgres', DOC_MVP01_R2_EVIDENCE: 'C:\\synthetic-evidence',
    DOC_MVP01_CLAMAV_CONTAINER: 'c4g-doc-mvp01-clamav-20261024', C4G_CLAMAV_HOST: '127.0.0.1', C4G_CLAMAV_PORT: '53310',
    C4G_R2_ENDPOINT: endpoint, C4G_R2_DOCUMENTS_BUCKET: 'synthetic-documents',
    C4G_R2_QUARANTINE_BUCKET: 'synthetic-quarantine', C4G_R2_ACCESS_KEY_ID: 'fixture', C4G_R2_SECRET_ACCESS_KEY: 'fixture',
    DOC_MVP01_R2_APPROVED_ENDPOINT_SHA256: createHash('sha256').update(endpoint).digest('hex'),
    DOC_MVP01_R2_APPROVED_DOCUMENTS_BUCKET: 'synthetic-documents',
    DOC_MVP01_R2_APPROVED_QUARANTINE_BUCKET: 'synthetic-quarantine',
    DOC_MVP01_R2_APPROVED_PREFIX: 'df1f6c0b-c107-4509-af52-73b4eefb244b/',
    DOC_MVP01_R2_OOXML_APPROVED_FUNCTIONAL_REQUESTS: '377', DOC_MVP01_R2_OOXML_APPROVED_CLEANUP_REQUESTS: '63',
    DOC_MVP01_R2_OOXML_APPROVED_TOTAL_REQUESTS: '440', DOC_MVP01_R2_OOXML_APPROVED_APPLICATION_BYTES: '67108864',
    DOC_MVP01_R2_OOXML_APPROVED_OBJECT_INTENTIONS: '20', DOC_MVP01_R2_OOXML_APPROVED_COMPLETED_OBJECTS: '19',
    DOC_MVP01_R2_OOXML_APPROVED_MULTIPART_INTENTIONS: '3', DOC_MVP01_R2_OOXML_APPROVED_UNRESOLVED_MULTIPART: '2'
  };
  const previous = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  try {
    Object.assign(process.env, values); const target = approvedTarget();
    assert.equal(target.endpointHash, values.DOC_MVP01_R2_APPROVED_ENDPOINT_SHA256);
    assert.equal(target.documentsBucket, 'synthetic-documents'); assert.equal(target.quarantineBucket, 'synthetic-quarantine');
    process.env.C4G_CLAMAV_PORT = '53311'; assert.throws(approvedTarget, /R2_OOXML_CLAMAV_ENDPOINT_INVALID/);
  } finally {
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test('fixture matrix uses three distinct OPC families and complementary adverse cases', async () => {
  assert.deepEqual(FIXTURE_IDS, SCENARIOS.map(value => value.id));
  const inspector = createOoxmlStructuralInspector();
  const observed = [];
  for (const id of FIXTURE_IDS) {
    const value = fixture(id), result = await inspector.inspect({ record: recordFor(value), storage: storageFor(value) });
    assert.equal(result.status, value.expectedStatus, id); assert.equal(result.code, value.expectedCode, id);
    assert.match(value.purpose, /\.$/); assert.equal(result.contentSha256 || value.sha256, value.sha256);
    observed.push({ id, extension: value.extension, entries: value.entries, size: value.size });
  }
  assert.deepEqual(observed.slice(0, 3).map(value => value.extension), ['docx', 'xlsx', 'pptx']);
  assert(observed[0].entries >= 5); assert(observed[1].entries >= 6); assert(observed[2].entries >= 11);
});

test('controlled end-to-end scan matrix requires CLEAN plus structural approval for AVAILABLE', async () => {
  for (const scenario of SCENARIOS.filter(value => !value.cancelBeforeWorker)) {
    const value = fixture(scenario.id), transitions = [], audits = [], storage = storageFor(value);
    const service = createScanService({
      scanner: { async health() { return { ready: true }; }, async scan(input) {
        assert.equal(input.expectedSize, value.size); assert.equal(input.expectedSha256, value.sha256); return { status: 'CLEAN' };
      } }, storage,
      repository: { async transition(input) { transitions.push(input); return { ...input, state: input.toState }; } },
      audit: { async emit(code, input) { audits.push({ code, input }); } }
    });
    const result = await service.scan({ record: recordFor(value), actor: { type: 'SERVICE' }, fencingToken: 'local-fence' });
    assert.equal(result.state, scenario.outcome); assert.equal(transitions.length, 1); assert.equal(audits.length, 1);
    assert.equal(audits[0].input.detailCode, value.expectedCode);
    assert.equal(audits[0].input.versionId, VERSION);
  }
});

test('cancellation closes the active range, performs no transition, and a fresh retry succeeds', async () => {
  const value = fixture('cancel-docx'), stalled = storageFor(value, { stall: true }), transitions = [];
  const service = createScanService({ scanner: { async health() { return { ready: true }; }, async scan() { return { status: 'CLEAN' }; } },
    storage: stalled, repository: { async transition(input) { transitions.push(input); return input; } }, audit: { async emit() {} },
    structuralInspector: createOoxmlStructuralInspector({ limits: { maxProcessingMs: 10 } }) });
  await assert.rejects(service.scan({ record: recordFor(value), actor: { type: 'SERVICE' }, fencingToken: 'cancel-fence' }),
    error => error?.code === 'OOXML_INSPECTION_TIMEOUT');
  assert.equal(transitions.length, 0); assert(stalled.state.ranges > 0); assert(stalled.state.closed > 0);
  const retryStorage = storageFor(value), retryTransitions = [];
  const retry = createScanService({ scanner: { async health() { return { ready: true }; }, async scan() { return { status: 'CLEAN' }; } },
    storage: retryStorage, repository: { async transition(input) { retryTransitions.push(input); return { ...input, state: input.toState }; } },
    audit: { async emit() {} } });
  assert.equal((await retry.scan({ record: recordFor(value), actor: { type: 'SERVICE' }, fencingToken: 'retry-fence' })).state, 'AVAILABLE');
  assert.equal(retryTransitions.length, 1);
});

test('current R2 storage completes bounded reads and cancels an active provider body', async () => {
  const value = fixture('valid-docx'); let cancelBody = false, closed = 0;
  const client = Object.freeze({
    async send(command, options = {}) {
      if (command instanceof sdk.HeadObjectCommand) return { ContentLength: value.size, Metadata: { sha256: value.sha256 },
        ContentType: value.mime, ETag: 'fixture-etag' };
      if (command instanceof sdk.GetObjectCommand) {
        const matched = /^bytes=(\d+)-(\d+)$/.exec(command.input.Range), start = Number(matched[1]), end = Number(matched[2]);
        if (!cancelBody) return { ContentLength: end - start + 1, ETag: 'fixture-etag',
          Body: Readable.from([value.bytes.subarray(start, end + 1)]) };
        const body = new Readable({ read() {} }); body.once('close', () => { closed += 1; });
        options.abortSignal?.addEventListener('abort', () => body.destroy(new Error('synthetic abort')), { once: true });
        return { ContentLength: end - start + 1, ETag: 'fixture-etag', Body: body };
      }
      throw new Error('Unexpected local transport operation.');
    }, destroy() {}
  });
  const storage = createR2Storage({ enabled: true, jurisdiction: 'eu', endpoint: 'https://synthetic.eu.r2.cloudflarestorage.com',
    documentsBucket: 'synthetic-documents', quarantineBucket: 'synthetic-quarantine', bucketAccess: 'PRIVATE',
    capabilities: { layerCValidated: true, multipartConditionalValidated: true } },
  { organizationId: ORGANIZATION, credentials: { accessKeyId: 'fixture', secretAccessKey: 'fixture' }, client });
  const full = await storage.readRange({ objectId: OBJECT, start: 0, end: value.size - 1, etag: 'fixture-etag' });
  assert.deepEqual(await collect(full), value.bytes);
  cancelBody = true; const controller = new AbortController();
  const pending = storage.readRange({ objectId: OBJECT, start: 0, end: value.size - 1,
    etag: 'fixture-etag', signal: controller.signal }).then(collect);
  setImmediate(() => controller.abort());
  await assert.rejects(pending, error => error?.code === 'STORAGE_READ_FAILED');
  assert.equal(closed, 1); await storage.shutdown();
});

test('journal continuation plan is cumulative, closed and does not use multipart', () => {
  const projected = assertPlanFits();
  assert.deepEqual(projected, { functionalRequests: 377, cleanupRequests: 55, applicationBytes: 60433429,
    objectIntentions: 20, completedObjects: 19, multipartIntentions: 3, unresolvedMultipart: 0 });
  assert.equal(LIMITS.functionalRequests + LIMITS.cleanupRequests, 440);
  assert.equal(PLAN.multipartIntentions, 0); assert.equal(PLAN.unresolvedMultipart, 0);
  assert.equal(BASELINE.sequence, 693);
});

test('local infrastructure and scanner readiness precede the first remote inventory', () => {
  const source = fs.readFileSync(require.resolve('./group-c-ooxml'), 'utf8');
  const infrastructure = source.indexOf("phase = 'LOCAL_INFRASTRUCTURE'; tenant");
  const scanner = source.indexOf("phase = 'LOCAL_SCANNER_READINESS'; await");
  const inventory = source.indexOf("phase = 'INITIAL_INVENTORY'; await");
  const storage = source.indexOf("phase = 'STORAGE_READINESS'; assert");
  assert(infrastructure >= 0 && scanner > infrastructure && inventory > scanner && storage > inventory);
});

test('remote request and byte plan is derived from the exact generated postimages', async () => {
  let functionalRequests = 10; // two HeadBucket calls and two four-call prefix inventories
  let applicationBytes = 0;
  for (const scenario of SCENARIOS) {
    const value = fixture(scenario.id), trace = { ranges: 0, bytes: 0 };
    const storage = Object.freeze({
      async head() { return { size: value.size, sha256: value.sha256, etag: 'budget-etag' }; },
      async readRange({ start, end }) {
        trace.ranges += 1; trace.bytes += end - start + 1;
        return Readable.from([value.bytes.subarray(start, end + 1)]);
      }
    });
    await createOoxmlStructuralInspector().inspect({ record: recordFor(value), storage });
    functionalRequests += 2; // PutObject and provider-confirmation HeadObject.
    functionalRequests += 2; // ClamAV HeadObject plus its single bounded GetObject.
    functionalRequests += 1 + trace.ranges; // Structural HeadObject plus exact ZIP ranges.
    applicationBytes += value.size * 2 + trace.bytes; // PutObject plus ClamAV read plus structural ranges.
    if (scenario.download) { functionalRequests += 2; applicationBytes += value.size; }
    if (scenario.cancelBeforeWorker) { functionalRequests += 2; applicationBytes += 22; }
  }
  assert.equal(functionalRequests, PLAN.functionalRequests);
  assert.equal(applicationBytes, PLAN.applicationBytes);
  assert.equal(SCENARIOS.length * 3, PLAN.cleanupRequests);
});
