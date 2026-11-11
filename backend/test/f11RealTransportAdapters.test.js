'use strict';
const {waitForSignal,bounded,deferCleanup,trackServer,listening}=require('./support/networkWait');
const test = require('./support/networkWait').test;
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const net = require('node:net');
const { createR2AdapterBoundary } = require('../src/documents/r2Adapter');
const { createClamavScanner } = require('../src/documents/clamavScanner');
const { validateProductionDocumentsBootstrap } = require('../src/documents/productionDocuments');
const { inspectDocumentInfrastructure } = require('../src/documents/infrastructureStatus');
const { LIMITS } = require('../src/documents/constants');
const ORG = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222', OBJECT = '33333333-3333-4333-8333-333333333333';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const config = { enabled: true, jurisdiction: 'eu', endpoint: 'https://fixture.eu.r2.cloudflarestorage.com', documentsBucket: 'fixture-docs',
  quarantineBucket: 'fixture-quarantine', bucketAccess: 'PRIVATE', capabilities: { layerCValidated: true, multipartConditionalValidated: true } };
const credentials = { accessKeyId: 'test-only-key', secretAccessKey: 'test-only-secret' };
const bytes = Buffer.from('%PDF-1.7\ntransport fixture');
const input = data => ({ objectId: OBJECT, storageClass: 'QUARANTINE', conditionalCreate: true,
  expectedSize: data.length, expectedSha256: hash(data), declaredMime: 'application/pdf' });
const metadata = data => ({ size: data.length, sha256: hash(data), mime: 'application/pdf' });
// SDK command fixture: proves orchestration only, never R2 compatibility.
function fixture() {
  const calls = [], objects = new Map(), uploads = new Map(); let serial = 0;
  return { calls, objects, async send(command, options) {
    const name = command.constructor.name, p = command.input; calls.push({ name, input: p, hasAbortSignal: Boolean(options?.abortSignal) });
    const key = `${p.Bucket}/${p.Key}`;
    if (name === 'HeadBucketCommand') return {};
    if (name === 'PutObjectCommand') {
      if (objects.has(key) && p.IfNoneMatch === '*') throw { $metadata: { httpStatusCode: 412 } };
      objects.set(key, { data: Buffer.from(p.Body), meta: p.Metadata, mime: p.ContentType }); return {};
    }
    if (name === 'CreateMultipartUploadCommand') { const id = String(++serial); uploads.set(id, { parts: [], meta: p.Metadata, mime: p.ContentType }); return { UploadId: id }; }
    if (name === 'UploadPartCommand') { uploads.get(p.UploadId).parts.push(Buffer.from(p.Body)); return { ETag: `part-${p.PartNumber}` }; }
    if (name === 'CompleteMultipartUploadCommand') {
      if (objects.has(key) && p.IfNoneMatch === '*') throw { $metadata: { httpStatusCode: 412 } };
      const upload = uploads.get(p.UploadId); objects.set(key, { data: Buffer.concat(upload.parts), meta: upload.meta, mime: upload.mime }); uploads.delete(p.UploadId); return {};
    }
    if (name === 'AbortMultipartUploadCommand') { uploads.delete(p.UploadId); return {}; }
    const object = objects.get(key); if (!object) throw { $metadata: { httpStatusCode: 404 } };
    if (name === 'HeadObjectCommand') return { ContentLength: object.data.length, Metadata: object.meta, ContentType: object.mime, ETag: 'fixed-etag' };
    if (name === 'GetObjectCommand') { const [start, end] = p.Range.slice(6).split('-').map(Number); const data = object.data.subarray(start, end + 1);
      return { ContentLength: data.length, ETag: 'fixed-etag', Body: Readable.from([data]) }; }
    throw Error('UNEXPECTED_COMMAND');
  }, destroy() {} };
}
const storage = (client, organizationId = ORG, extra = {}) => createR2AdapterBoundary(config, { organizationId, credentials, client, ...extra });

test('R2 requires explicit tenant and credentials; no ambient AWS credentials fallback', () => {
  assert.throws(() => createR2AdapterBoundary(config), /ORGANIZATION_REQUIRED/);
  assert.throws(() => createR2AdapterBoundary(config, { organizationId: ORG }), /CREDENTIALS_REQUIRED/);
  assert.throws(() => createR2AdapterBoundary({ ...config, endpoint: 'https://foreign.invalid' }, { organizationId: ORG, credentials }), /EU_JURISDICTION/);
});
test('R2 SDK commands preserve bytes/hash and bind every key to the organization', async () => {
  const client = fixture(), a = storage(client), b = storage(client, OTHER);
  try {
    const handle = await a.beginWrite(input(bytes)); await a.write(handle, Readable.from([bytes])); await a.commit(handle, metadata(bytes));
    const head = await a.head({ objectId: OBJECT }); assert.equal(head.sha256, hash(bytes));
    const result = []; for await (const chunk of await a.readRange({ objectId: OBJECT, start: 0, end: bytes.length - 1, etag: head.etag })) result.push(chunk);
    assert.deepEqual(Buffer.concat(result), bytes); assert.equal(await b.head({ objectId: OBJECT }), null);
    const put = client.calls.find(call => call.name === 'PutObjectCommand').input;
    assert.equal(put.Key, `${ORG}/${OBJECT}`); assert.equal(put.IfNoneMatch, '*'); assert.equal(put.CacheControl, 'no-store');
    assert.equal(client.calls.find(call => call.name === 'GetObjectCommand').input.IfMatch, head.etag);
    assert.equal(client.calls.find(call => call.name === 'GetObjectCommand').hasAbortSignal, true);
    await a.abort(handle); assert.equal(client.calls.some(call => /Delete/.test(call.name)), false);
  } finally { await a.shutdown(); await b.shutdown(); }
});
test('R2 conditional conflict cannot overwrite existing bytes, even across adapter instances', async () => {
  const client = fixture(), a = storage(client), b = storage(client);
  try {
    const ah = await a.beginWrite(input(bytes)), bh = await b.beginWrite(input(bytes));
    await Promise.all([a.write(ah, Readable.from([bytes])), b.write(bh, Readable.from([bytes]))]);
    const result = await Promise.allSettled([a.commit(ah, metadata(bytes)), b.commit(bh, metadata(bytes))]);
    assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
    assert.match(result.find(r => r.status === 'rejected').reason.message, /CONDITIONAL_CREATE_FAILED/);
  } finally { await a.shutdown(); await b.shutdown(); }
});
test('R2 bad digest, oversize, forged handle, unsafe identity and range are rejected', async () => {
  const client = fixture(), a = storage(client);
  try {
    await assert.rejects(a.beginWrite({ ...input(bytes), objectId: '../../secret' }), /IDENTITY_INVALID/);
    const handle = await a.beginWrite(input(bytes));
    await assert.rejects(a.write({ ...handle }, Readable.from([bytes])), /WRITE_NOT_FOUND/);
    await a.write(handle, Readable.from([bytes]));
    await assert.rejects(a.commit(handle, { ...metadata(bytes), sha256: '0'.repeat(64) }), /COMMIT_MISMATCH/);
    await assert.rejects(a.readRange({ objectId: OBJECT, start: 0, end: LIMITS.maxRangeBytes, etag: 'x' }), /RANGE_INVALID/);
    await a.abort(handle);
    const second = await a.beginWrite(input(bytes)); await assert.rejects(a.write(second, Readable.from([Buffer.alloc(bytes.length + 1)])), /SIZE_LIMIT/);
    await a.abort(second); assert.equal(client.calls.some(call => call.name === 'PutObjectCommand'), false);
  } finally { await a.shutdown(); }
});
test('R2 multipart requires real conditional evidence; verified path sends bounded sequential parts', async () => {
  const client = fixture(), a = storage(client), unverified = createR2AdapterBoundary({ ...config, capabilities: { layerCValidated: true } }, { organizationId: ORG, credentials, client });
  const data = Buffer.alloc(LIMITS.multipartThreshold + 1, 23);
  try {
    await assert.rejects(unverified.beginMultipart(input(data)), /MULTIPART_CONDITIONAL_NOT_VALIDATED/);
    await assert.rejects(a.beginWrite(input(data)), /MULTIPART_REQUIRED/);
    const handle = await a.beginMultipart(input(data));
    await assert.rejects(a.writePart(handle, 2, Readable.from([data.subarray(0, LIMITS.partBytes)])), /PART_INVALID/);
    for (let start = 0, part = 1; start < data.length; start += LIMITS.partBytes, part++) await a.writePart(handle, part, Readable.from([data.subarray(start, start + LIMITS.partBytes)]));
    await a.commit(handle, metadata(data)); assert.equal((await a.head({ objectId: OBJECT })).sha256, hash(data));
    const complete = client.calls.find(call => call.name === 'CompleteMultipartUploadCommand').input;
    assert.equal(complete.IfNoneMatch, '*'); assert.equal(complete.MultipartUpload.Parts.length, 3);
  } finally { await a.shutdown(); await unverified.shutdown(); }
});
test('R2 provider errors are sanitized, health does not disclose infrastructure or credentials', async () => {
  const client = { send: async () => { throw Error('test-only-secret endpoint body filename'); }, destroy() {} }, a = storage(client);
  await assert.rejects(a.head({ objectId: OBJECT }), error => error.message === 'STORAGE_UNAVAILABLE' && !error.cause);
  assert.deepEqual(await a.health(), { ready: false, adapter: 'r2-s3-v1' }); await a.shutdown();
});
test('R2 concurrency is global and per organization across multiple adapter instances; abort releases slots', async () => {
  const client = fixture(), ports = [storage(client), storage(client), storage(client), storage(client, OTHER), storage(client, OTHER),
    storage(client, '44444444-4444-4444-8444-444444444444')];
  try {
    const first = await ports[0].beginWrite(input(bytes)); await ports[1].beginWrite(input(bytes));
    await assert.rejects(ports[2].beginWrite(input(bytes)), /CONCURRENCY_LIMIT/);
    await ports[3].beginWrite(input(bytes)); await ports[4].beginWrite(input(bytes));
    await assert.rejects(ports[5].beginWrite(input(bytes)), /CONCURRENCY_LIMIT/);
    await ports[0].abort(first); const last = await ports[5].beginWrite(input(bytes)); await ports[5].abort(last);
  } finally { await Promise.all(ports.map(port => port.shutdown())); }
});
test('R2 truncated provider streams cannot be accepted as a complete range', async () => {
  const client = fixture(); client.send = async () => ({ ContentLength: bytes.length, ETag: 'fixed', Body: Readable.from([bytes.subarray(1)]) });
  const a = storage(client);
  try { const source = await a.readRange({ objectId: OBJECT, start: 0, end: bytes.length - 1, etag: 'fixed' });
    await assert.rejects(async () => { for await (const _chunk of source) {} }, /STORAGE_READ_FAILED/);
  } finally { await a.shutdown(); }
});
test('R2 download lifetime is bounded and immutable object precondition is signed', async () => {
  const client = fixture(); let signed;
  const now = new Date('2026-10-17T12:00:00Z');
  const a = storage(client, ORG, { clock: () => now, sign: async (_client, command, options) => { signed = { input: command.input, options }; return 'https://fixture.invalid/private'; } });
  try {
    const handle = await a.beginWrite(input(bytes)); await a.write(handle, Readable.from([bytes])); await a.commit(handle, metadata(bytes));
    await assert.rejects(a.createDownloadCapability({ objectId: OBJECT, expiresAt: new Date(now.getTime() + 301000).toISOString() }), /EXPIRY_INVALID/);
    const result = await a.createDownloadCapability({ objectId: OBJECT, expiresAt: new Date(now.getTime() + 60000).toISOString() });
    assert.equal(result.kind, 'R2_SIGNED_DOWNLOAD'); assert.equal(signed.options.expiresIn, 60); assert.equal(signed.input.IfMatch, 'fixed-etag');
  } finally { await a.shutdown(); }
});
test('Bootstrap never reports ready with null adapters and empty handlers, even if every old flag passes', () => {
  const result = validateProductionDocumentsBootstrap({ r2: config, migrationReady: true, scannerReady: true, reconciliationLagSeconds: 0 });
  assert.equal(result.ready, false); assert.ok(result.reasons.includes('DOCUMENT_RUNTIME_NOT_COMPOSED')); assert.equal(result.handlers.length, 0);
});
test('Infrastructure diagnostics expose only presence; supplied credentials cannot open the gate', () => {
  const result = inspectDocumentInfrastructure({ C4G_R2_ACCESS_KEY_ID: 'sensitive-one', C4G_R2_SECRET_ACCESS_KEY: 'sensitive-two',
    C4G_CLAMAV_HOST: 'public.invalid', C4G_CLAMAV_PORT: '3310' });
  assert.equal(result.ready, false); assert.equal(result.configured.C4G_R2_ACCESS_KEY_ID, true);
  assert.equal(JSON.stringify(result).includes('sensitive'), false); assert.equal(JSON.stringify(result).includes('public.invalid'), false);
  assert.ok(result.blockers.includes('SCANNER_CONFIGURATION_INVALID')); assert.equal(result.networkProbed, false);
});

// TCP protocol fixture, NOT a malware engine. Live clean/infected/definitions
// checks against the configured scanner remain an explicit activation gate.
async function daemon(reply, work) {
  let received = Buffer.alloc(0), body = Buffer.alloc(0), command = null;
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    socket.on('data', chunk => {
      received = Buffer.concat([received, chunk]);
      if (!command) { const end = received.indexOf(0); if (end < 0) return;
        command = received.subarray(0, end).toString(); received = received.subarray(end + 1);
        if (command === 'zPING') { socket.write('PONG\0'); return; } }
      while (received.length >= 4) { const length = received.readUInt32BE(0); if (received.length < length + 4) return;
        if (length === 0) { if (reply !== null) socket.write(reply); return; }
        body = Buffer.concat([body, received.subarray(4, length + 4)]); received = received.subarray(length + 4); }
    });
  });
  trackServer(server);server.listen(0,'127.0.0.1');await listening(server);
  try { await work(server.address().port, () => body); }
  finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
}
const scanStorage = (data = bytes, checksum = hash(data)) => ({
  head: async () => ({ size: data.length, sha256: checksum, etag: 'immutable' }),
  readRange: async () => Readable.from([data])
});
test('ClamAV protocol streams exact bytes and only a complete OK result is CLEAN', async () => {
  await daemon('stream: OK\0', async (port, body) => {
    const scanner = createClamavScanner({ organizationId: ORG, storage: scanStorage(), port });
    assert.deepEqual(await scanner.scan({ objectId: OBJECT, organizationId: ORG, expectedSize: bytes.length, expectedSha256: hash(bytes) }), { status: 'CLEAN' }); assert.deepEqual(body(), bytes);
    assert.deepEqual(await scanner.scan({ objectId: OBJECT, organizationId: OTHER }), { status: 'ERROR' });
  });
});
test('ClamAV protocol infection, daemon error, malformed reply and timeout stay closed', async () => {
  for (const [reply, status] of [['stream: Fixture-Signature FOUND\0', 'INFECTED'], ['stream: limit exceeded ERROR\0', 'ERROR'], ['OK\0', 'ERROR'], [null, 'ERROR']]) {
    await daemon(reply, async port => {
      const scanner = createClamavScanner({ organizationId: ORG, storage: scanStorage(), port, timeoutMs: 150 });
      assert.deepEqual(await scanner.scan({ objectId: OBJECT, organizationId: ORG, expectedSize: bytes.length, expectedSha256: hash(bytes) }), { status });
    });
  }
});
test('ClamAV checksum mismatch cannot become CLEAN and plaintext remote hosts are refused', async () => {
  assert.throws(() => createClamavScanner({ organizationId: ORG, storage: scanStorage(), host: 'remote.invalid' }), /CONFIGURATION_INVALID/);
  await daemon('stream: OK\0', async port => {
    const scanner = createClamavScanner({ organizationId: ORG, storage: scanStorage(bytes, '0'.repeat(64)), port });
    assert.deepEqual(await scanner.scan({ objectId: OBJECT, organizationId: ORG, expectedSize: bytes.length, expectedSha256: hash(bytes) }), { status: 'ERROR' });
  });
});
test('ClamAV health uses PING without exposing file data', async () => {
  await daemon(null, async port => { const scanner = createClamavScanner({ organizationId: ORG, storage: scanStorage(), port });
    assert.deepEqual(await scanner.health(), { ready: true, adapter: 'clamav-instream-v1' }); });
});
test('ClamAV hashes the streamed body as well as checking trusted metadata', async () => {
  await daemon('stream: OK\0', async port => {
    const bad = scanStorage(); bad.readRange = async () => Readable.from([Buffer.alloc(bytes.length)]);
    const scanner = createClamavScanner({ organizationId: ORG, storage: bad, port });
    assert.deepEqual(await scanner.scan({ objectId: OBJECT, organizationId: ORG, expectedSize: bytes.length, expectedSha256: hash(bytes) }), { status: 'ERROR' });
  });
});
test('ClamAV lifecycle cancellation closes the active storage stream and socket', async () => {
  await daemon(null, async port => {
    const data=Buffer.alloc(512*1024,0x41);let closed=false,started;
    const active=new Promise(resolve=>{started=resolve});
    const storage={head:async()=>({size:data.length,sha256:hash(data),etag:'immutable'}),async readRange(){return Readable.from((async function*(){try{started();for(let offset=0;offset<data.length;offset+=16384){await new Promise(resolve=>setTimeout(resolve,2));yield data.subarray(offset,offset+16384);}}finally{closed=true;}})());}};
    const scanner=createClamavScanner({organizationId:ORG,storage,port,timeoutMs:2000}),controller=new AbortController();
    const scanning=scanner.scan({objectId:OBJECT,organizationId:ORG,expectedSize:data.length,expectedSha256:hash(data),signal:controller.signal});
    deferCleanup(()=>controller.abort());
    await waitForSignal(active,scanning,'scanner stream entry');controller.abort();
    await assert.rejects(scanning,error=>error.code==='WORKER_DRAINING');
    assert.equal(closed,true);
  });
});
test('F11 scan forwards the confirmed size/hash and quarantines rejected OOXML inspection', async () => {
  const { createScanService } = require('../src/documents/scanService'); let scanInput;
  const service = createScanService({ scanner: { health: async () => ({ ready: true }), scan: async input => { scanInput = input; return { status: 'CLEAN' }; } },
    repository: { transition: async change => change }, audit: { emit: async () => {} },
    structuralInspector: { inspect: async () => ({ status: 'REJECTED', code: 'OOXML_INSPECTION_REQUIRED' }) } });
  const result = await service.scan({ record: { objectId: OBJECT, organizationId: ORG, versionId: OBJECT, lockVersion: 3,
    observedSize: bytes.length, sha256: hash(bytes), expectedFileClass: 'OOXML' }, actor: { type: 'SERVICE' }, fencingToken: 'fixture-fence' });
  assert.equal(scanInput.expectedSize, bytes.length); assert.equal(scanInput.expectedSha256, hash(bytes)); assert.equal(result.toState, 'QUARANTINED');
});
