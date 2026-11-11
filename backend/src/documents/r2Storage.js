'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const sdk = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { UUID } = require('./objectIdentity');
const { LIMITS, FILE_CLASSES } = require('./constants');
const { assertObjectStoragePort } = require('./objectStoragePort');
const MAX_SIZE = Math.max(...Object.values(FILE_CLASSES).map(value => value.maxBytes));
let reservedBytes = 0;
let activeWrites = 0;
const organizationWrites = new Map();
const failure = code => Object.assign(new Error(code), { code });

// One instance belongs to one server-resolved organization. Never accept this
// binding, provider configuration or credentials from an HTTP request body.
function createR2Storage(configuration, options = {}) {
  require('./r2Adapter').validateR2Configuration(configuration);
  const { credentials, clock = () => new Date() } = options;
  const central = options.authority === 'CENTRAL';
  if (central && options.organizationId != null) throw failure('R2_ORGANIZATION_REQUIRED');
  const organizationId = central ? 'central/portugal2030' : options.organizationId;
  if (!central && !UUID.test(organizationId || '')) throw failure('R2_ORGANIZATION_REQUIRED');
  if (!credentials || !['accessKeyId', 'secretAccessKey'].every(key => typeof credentials[key] === 'string' && credentials[key].trim())) {
    throw failure('R2_CREDENTIALS_REQUIRED');
  }
  const client = options.client || new sdk.S3Client({
    endpoint: configuration.endpoint, region: 'auto', forcePathStyle: true,
    credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 2
  });
  const sign = options.sign || getSignedUrl;
  const writes = new Map();
  let closed = false;
  const open = () => { if (closed) throw failure('STORAGE_CLOSED'); };
  function target(objectId, storageClass = 'QUARANTINE') {
    if (!UUID.test(objectId || '') || !['QUARANTINE', 'DOCUMENTS'].includes(storageClass)) throw failure('STORAGE_IDENTITY_INVALID');
    return { Bucket: storageClass === 'DOCUMENTS' ? configuration.documentsBucket : configuration.quarantineBucket,
      Key: `${organizationId.toLowerCase()}/${objectId.toLowerCase()}` };
  }
  async function send(Command, input, signal) {
    open();
    try {
      const deadline = AbortSignal.timeout(30000);
      const abortSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      return await client.send(new Command(input), { abortSignal });
    }
    catch (error) {
      const status = error?.$metadata?.httpStatusCode;
      if (status === 404) throw failure('STORAGE_OBJECT_NOT_FOUND');
      if (status === 412 || status === 409) throw failure('STORAGE_CONDITIONAL_CREATE_FAILED');
      throw failure(signal?.aborted ? 'STORAGE_ABORTED' : 'STORAGE_UNAVAILABLE');
    }
  }
  function pending(handle) {
    open(); const item = writes.get(handle);
    if (!item || item.busy) throw failure('STORAGE_WRITE_NOT_FOUND');
    return item;
  }
  function release(handle) {
    const item = writes.get(handle);
    if (item) {
      reservedBytes -= item.reservation; activeWrites--;
      const count = organizationWrites.get(organizationId) - 1;
      if (count) organizationWrites.set(organizationId, count); else organizationWrites.delete(organizationId);
      item.chunks = []; writes.delete(handle);
    }
  }
  async function collect(source, maximum, signal) {
    const chunks = []; let size = 0;
    for await (const raw of source) {
      if (signal?.aborted) throw failure('STORAGE_ABORTED');
      const chunk = Buffer.from(raw); size += chunk.length;
      if (size > maximum) throw failure('STORAGE_SIZE_LIMIT');
      chunks.push(chunk);
    }
    if (!size) throw failure('STORAGE_SIZE_LIMIT');
    return Buffer.concat(chunks, size);
  }
  async function begin(input, multipart) {
    open();
    const { objectId, storageClass, expectedSize, expectedSha256, declaredMime, conditionalCreate } = input;
    const location = target(objectId, storageClass);
    if (conditionalCreate !== true || !Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_SIZE
      || !/^[a-f0-9]{64}$/.test(expectedSha256 || '') || !Object.values(FILE_CLASSES).some(p => p.mime.includes(declaredMime))) throw failure('STORAGE_WRITE_INVALID');
    if (!multipart && expectedSize >= LIMITS.multipartThreshold) throw failure('STORAGE_MULTIPART_REQUIRED');
    // This condition needs an actual R2 concurrency probe; a HEAD before a write is insufficient.
    if (multipart && configuration.capabilities.multipartConditionalValidated !== true) throw failure('R2_MULTIPART_CONDITIONAL_NOT_VALIDATED');
    if (activeWrites >= LIMITS.globalConcurrency || (organizationWrites.get(organizationId) || 0) >= LIMITS.organizationConcurrency
      || [...writes.keys()].some(h => h.objectId === objectId)) throw failure('STORAGE_CONCURRENCY_LIMIT');
    const reservation = multipart ? LIMITS.partBytes * 2 : expectedSize * 2;
    if (reservedBytes + reservation > LIMITS.maxMemoryBytes) throw failure('STORAGE_MEMORY_LIMIT');
    const handle = { objectId, storageClass, id: randomUUID() };
    const item = { ...location, reservation, expectedSize, expectedSha256, declaredMime,
      multipart, chunks: [], size: 0, parts: [], hash: createHash('sha256'), busy: true };
    writes.set(handle, item); reservedBytes += reservation; activeWrites++;
    organizationWrites.set(organizationId, (organizationWrites.get(organizationId) || 0) + 1);
    try {
      if (multipart) {
        const response = await send(sdk.CreateMultipartUploadCommand, { ...location, ContentType: declaredMime,
          CacheControl: 'no-store', Metadata: { sha256: expectedSha256 } });
        if (!response.UploadId) throw failure('STORAGE_PROVIDER_RESPONSE_INVALID');
        item.uploadId = response.UploadId; handle.multipartSessionId = response.UploadId;
      }
      item.busy = false; return Object.freeze(handle);
    } catch (error) { release(handle); throw error; }
  }
  const port = {
    beginWrite: input => begin(input, false),
    async write(handle, source, { signal } = {}) {
      const item = pending(handle);
      if (item.multipart || item.size) throw failure('STORAGE_WRITE_INVALID');
      item.busy = true;
      try { const data = await collect(source, item.expectedSize, signal); item.chunks = [data]; item.size = data.length; item.hash.update(data); }
      catch (error) { item.failed = true; throw error; }
      finally { item.busy = false; }
    },
    beginMultipart: input => begin(input, true),
    async writePart(handle, partNumber, source, { signal } = {}) {
      const item = pending(handle);
      if (!item.multipart || item.failed || partNumber !== item.parts.length + 1 || partNumber > LIMITS.maxParts) throw failure('STORAGE_PART_INVALID');
      item.busy = true;
      try {
        const remaining = item.expectedSize - item.size;
        const data = await collect(source, Math.min(remaining, LIMITS.partBytes), signal);
        if (data.length !== Math.min(remaining, LIMITS.partBytes)) throw failure('STORAGE_PART_INVALID');
        const result = await send(sdk.UploadPartCommand, { Bucket: item.Bucket, Key: item.Key,
          UploadId: item.uploadId, PartNumber: partNumber, Body: data, ContentLength: data.length,
          ContentMD5: createHash('md5').update(data).digest('base64') }, signal);
        if (!result.ETag) throw failure('STORAGE_PROVIDER_RESPONSE_INVALID');
        item.parts.push({ PartNumber: partNumber, ETag: result.ETag }); item.size += data.length; item.hash.update(data);
        return Object.freeze({ partNumber, size: data.length, sha256: createHash('sha256').update(data).digest('hex') });
      } catch (error) { item.failed = true; throw error; }
      finally { item.busy = false; }
    },
    async commit(handle, metadata) {
      const item = pending(handle);
      if (item.failed || item.size !== item.expectedSize || metadata.size !== item.size || metadata.sha256 !== item.expectedSha256
        || metadata.mime !== item.declaredMime || item.hash.copy().digest('hex') !== item.expectedSha256) throw failure('STORAGE_COMMIT_MISMATCH');
      item.busy = true;
      try {
        if (item.multipart) await send(sdk.CompleteMultipartUploadCommand, { Bucket: item.Bucket, Key: item.Key,
          UploadId: item.uploadId, IfNoneMatch: '*', MultipartUpload: { Parts: item.parts } });
        else {
          const data = item.chunks[0];
          await send(sdk.PutObjectCommand, { Bucket: item.Bucket, Key: item.Key, Body: data, ContentLength: item.size,
            IfNoneMatch: '*', ContentType: item.declaredMime, CacheControl: 'no-store',
            ContentMD5: createHash('md5').update(data).digest('base64'), Metadata: { sha256: item.expectedSha256 } });
        }
        release(handle); return Object.freeze({ objectId: handle.objectId, size: item.size, sha256: item.expectedSha256 });
      } finally { item.busy = false; }
    },
    async abort(handle, {signal = null} = {}) {
      const item = writes.get(handle);
      if (!item) return Object.freeze({ aborted: false });
      if (item.busy) throw failure('STORAGE_WRITE_BUSY');
      item.busy = true;
      try { if (item.uploadId) await send(sdk.AbortMultipartUploadCommand, { Bucket: item.Bucket, Key: item.Key, UploadId: item.uploadId },signal); }
      finally { release(handle); }
      return Object.freeze({ aborted: true });
    },
    async abortMultipartSession({ objectId, storageClass = 'QUARANTINE', providerUploadId, signal = null }) {
      if (typeof providerUploadId !== 'string' || providerUploadId.length < 1 || providerUploadId.length > 1024 || /[\u0000-\u001f\u007f]/.test(providerUploadId)) throw failure('STORAGE_MULTIPART_SESSION_INVALID');
      try { await send(sdk.AbortMultipartUploadCommand, { ...target(objectId, storageClass), UploadId: providerUploadId },signal); }
      catch(error){if(error.code!=='STORAGE_OBJECT_NOT_FOUND')throw error;}
      return Object.freeze({ aborted: true });
    },
    // Physical removal; an already-absent object counts as removed so retries stay idempotent.
    async deleteObject({ objectId, storageClass = 'QUARANTINE', signal = null }) {
      try { await send(sdk.DeleteObjectCommand, target(objectId, storageClass), signal); }
      catch (error) { if (error.code !== 'STORAGE_OBJECT_NOT_FOUND') throw error; }
      return Object.freeze({ deleted: true });
    },
    async head({ objectId, storageClass = 'QUARANTINE', signal = null }) {
      let result;
      try { result = await send(sdk.HeadObjectCommand, target(objectId, storageClass),signal); }
      catch (error) { if (error.code === 'STORAGE_OBJECT_NOT_FOUND') return null; throw error; }
      if (!Number.isSafeInteger(result.ContentLength) || result.ContentLength < 1 || result.ContentLength > MAX_SIZE
        || !/^[a-f0-9]{64}$/.test(result.Metadata?.sha256 || '') || !result.ETag) throw failure('STORAGE_PROVIDER_RESPONSE_INVALID');
      return Object.freeze({ objectId, size: result.ContentLength, sha256: result.Metadata.sha256,
        mime: result.ContentType, storageClass, etag: result.ETag });
    },
    async readRange({ objectId, storageClass = 'QUARANTINE', start = 0, end, etag, signal = null }) {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end - start + 1 > LIMITS.maxRangeBytes
        || typeof etag !== 'string' || !etag) throw failure('STORAGE_RANGE_INVALID');
      const result = await send(sdk.GetObjectCommand, { ...target(objectId, storageClass), Range: `bytes=${start}-${end}`, IfMatch: etag }, signal);
      if (result.ContentLength !== end - start + 1 || result.ETag !== etag || !result.Body?.[Symbol.asyncIterator]) {
        result.Body?.destroy?.(); throw failure('STORAGE_PROVIDER_RESPONSE_INVALID');
      }
      async function* bounded() {
        let size = 0;
        try { for await (const raw of result.Body) { if(signal?.aborted)throw failure('STORAGE_ABORTED');const chunk = Buffer.from(raw); size += chunk.length;
          if (size > end - start + 1) throw failure('STORAGE_PROVIDER_RESPONSE_INVALID'); yield chunk; }
          if (size !== end - start + 1) throw failure('STORAGE_PROVIDER_RESPONSE_INVALID');
        } catch { throw failure('STORAGE_READ_FAILED'); }
        finally { result.Body.destroy?.(); }
      }
      return Readable.from(bounded());
    },
    async createDownloadCapability({ objectId, storageClass = 'QUARANTINE', expiresAt, range }) {
      open(); const seconds = Math.floor((Date.parse(expiresAt) - clock().getTime()) / 1000);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > LIMITS.downloadCapabilityMs / 1000) throw failure('STORAGE_EXPIRY_INVALID');
      const record = await port.head({ objectId, storageClass }); if (!record) throw failure('STORAGE_OBJECT_NOT_FOUND');
      if (range && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start
        || range.end >= record.size || range.end - range.start + 1 > LIMITS.maxRangeBytes)) throw failure('STORAGE_RANGE_INVALID');
      try { return Object.freeze({ kind: 'R2_SIGNED_DOWNLOAD', expiresAt,
        headers: Object.freeze({ 'If-Match': record.etag, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }), url: await sign(client,
        new sdk.GetObjectCommand({ ...target(objectId, storageClass), IfMatch: record.etag,
          ResponseContentDisposition: 'attachment', ResponseCacheControl: 'no-store',
          ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }), { expiresIn: seconds }) }); }
      catch { throw failure('STORAGE_UNAVAILABLE'); }
    },
    async health() {
      if (closed) return Object.freeze({ ready: false, adapter: 'r2-s3-v1' });
      try { await Promise.all([configuration.documentsBucket, configuration.quarantineBucket].map(Bucket => send(sdk.HeadBucketCommand, { Bucket })));
        return Object.freeze({ ready: true, adapter: 'r2-s3-v1' }); }
      catch { return Object.freeze({ ready: false, adapter: 'r2-s3-v1' }); }
    },
    async shutdown() {
      if (closed) return;
      if ([...writes.values()].some(item => item.busy)) throw failure('STORAGE_WRITE_BUSY');
      try { await Promise.all([...writes.keys()].map(handle => port.abort(handle))); }
      finally { closed = true; client.destroy?.(); }
    }
  };
  return Object.freeze(assertObjectStoragePort(port));
}
module.exports = { createR2Storage };
