'use strict';

const fs = require('node:fs');
const path = require('node:path');

const failure = code => Object.assign(new Error(code), { code });
const MUTATIONS = new Set(['PutObjectCommand', 'CreateMultipartUploadCommand', 'CompleteMultipartUploadCommand',
  'AbortMultipartUploadCommand', 'DeleteObjectCommand']);
const JOURNAL_INTERPRETER_VERSION = 'r2-proof-journal-v2';

function commandName(command) { return command?.constructor?.name || command?.name || 'UnknownCommand'; }
function keyOf(input) { return `${input.Bucket}\u0000${input.Key}`; }
function safeError(error) { return error?.code || error?.name || 'PROVIDER_ERROR'; }
function missing(error) { return error?.$metadata?.httpStatusCode === 404 || ['NoSuchKey', 'NoSuchUpload', 'NotFound'].includes(error?.name); }
function rangeBytes(range) {
  const matched = /^bytes=(\d+)-(\d+)$/.exec(range || '');
  if (!matched) return 0;
  const start = Number(matched[1]), end = Number(matched[2]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start ? end - start + 1 : 0;
}
function payloadBytes(name, input) {
  if (name === 'PutObjectCommand' || name === 'UploadPartCommand') return Number(input.ContentLength || 0);
  if (name === 'GetObjectCommand') return rangeBytes(input.Range);
  return 0;
}
function validateLimits(limits) {
  const keys = ['functionalRequests', 'cleanupRequests', 'applicationBytes', 'objectIntentions', 'completedObjects',
    'multipartIntentions', 'unresolvedMultipart'];
  if (!limits || keys.some(key => !Number.isSafeInteger(limits[key]) || limits[key] < 0)) throw failure('R2_PROOF_LIMITS_INVALID');
  return Object.freeze({ ...limits });
}

function reconstructProofJournal(records) {
  if (!Array.isArray(records) || !records.length) throw failure('R2_PROOF_JOURNAL_EMPTY');
  const budget = { functionalRequests: 0, cleanupRequests: 0, applicationBytes: 0,
    objectIntentions: 0, completedObjects: 0, multipartIntentions: 0, unresolvedMultipart: 0 };
  const proofTag = records[0].proofTag;
  if (!/^[0-9a-f-]{36}$/i.test(proofTag || '')) throw failure('R2_PROOF_JOURNAL_IDENTITY_MISMATCH');
  const objectSlots = new Set(), intents = new Map(), pendingCreates = new Map(), sessions = new Map();
  let expectedSequence = 1;
  const assertIdentity = record => {
    if (record.proofTag !== undefined && record.proofTag !== proofTag) throw failure('R2_PROOF_JOURNAL_IDENTITY_MISMATCH');
  };
  const terminalSession = (record, objectKey, terminalStatus) => {
    const session = sessions.get(record.uploadId);
    if (!session || session.objectKey !== objectKey) throw failure('R2_PROOF_JOURNAL_MULTIPART_LINK_INVALID');
    if (session.terminal) {
      if (session.terminal !== terminalStatus) throw failure('R2_PROOF_JOURNAL_MULTIPART_TERMINAL_CONFLICT');
      return;
    }
    session.terminal = terminalStatus; budget.unresolvedMultipart -= 1;
  };
  for (const record of records) {
    if (record.sequence !== expectedSequence++) throw failure('R2_PROOF_JOURNAL_SEQUENCE_INVALID');
    assertIdentity(record);
    const objectKey = record.bucket && record.key ? keyOf({ Bucket: record.bucket, Key: record.key }) : null;
    if (record.event === 'BUDGET_RESERVED') {
      const counter = record.phase === 'cleanup' ? 'cleanupRequests' : 'functionalRequests'; budget[counter] += 1;
      if (record.phase !== 'cleanup') budget.applicationBytes += Number(record.size || 0);
    } else if (record.event === 'OBJECT_INTENT_RECORDED') {
      if (!objectKey || record.proofTag !== proofTag || intents.has(objectKey)) throw failure('R2_PROOF_JOURNAL_OBJECT_INTENT_INVALID');
      intents.set(objectKey, Object.freeze({ sha256: record.sha256, size: record.size })); budget.objectIntentions += 1;
    }
    else if (record.event === 'PROVIDER_ATTEMPT' && ['PutObjectCommand', 'CompleteMultipartUploadCommand'].includes(record.operation)
      && objectKey && !objectSlots.has(objectKey)) { objectSlots.add(objectKey); budget.completedObjects += 1; }
    if (record.event === 'PROVIDER_ATTEMPT' && record.operation === 'CreateMultipartUploadCommand') {
      if (!objectKey || record.proofTag !== proofTag || !intents.has(objectKey)) throw failure('R2_PROOF_JOURNAL_MULTIPART_INTENT_INVALID');
      budget.multipartIntentions += 1; budget.unresolvedMultipart += 1;
      pendingCreates.set(objectKey, (pendingCreates.get(objectKey) || 0) + 1);
    }
    if (record.event === 'MULTIPART_RESULT' && record.status === 'KNOWN' && record.uploadId && objectKey) {
      const known = sessions.get(record.uploadId);
      if (known) {
        if (known.objectKey !== objectKey) throw failure('R2_PROOF_JOURNAL_MULTIPART_LINK_INVALID');
      } else {
        const pending = pendingCreates.get(objectKey) || 0;
        if (!pending) throw failure('R2_PROOF_JOURNAL_MULTIPART_LINK_INVALID');
        if (pending === 1) pendingCreates.delete(objectKey); else pendingCreates.set(objectKey, pending - 1);
        sessions.set(record.uploadId, { objectKey, terminal: null });
      }
    }
    if (record.event === 'MULTIPART_RESULT' && ['ABORTED', 'COMPLETED', 'ABSENT'].includes(record.status) && record.uploadId) {
      terminalSession(record, objectKey, record.status);
    }
    if (record.event === 'OBJECT_RESULT' && record.operation === 'CompleteMultipartUploadCommand'
      && record.status === 'CONFIRMED' && record.uploadId) terminalSession(record, objectKey, 'COMPLETED');
    if (record.event === 'CLEANUP_RESOURCE' && record.status === 'ABSENT' && record.uploadId) terminalSession(record, objectKey, 'ABSENT');
    const observed = record.budget || {};
    for (const name of Object.keys(budget)) if (Number(observed[name]) !== budget[name]) throw failure('R2_PROOF_JOURNAL_BUDGET_INCONSISTENT');
  }
  return Object.freeze({ sequence: records.at(-1).sequence, budget: Object.freeze({ ...budget }),
    interpreterVersion: JOURNAL_INTERPRETER_VERSION });
}

function createProofSafeguards({ journalPath, proofTag, limits, allowedBuckets, prefix, allowedFetchOrigin, clock = () => new Date(), resume = false }) {
  if (!path.isAbsolute(journalPath || '') || !/^[0-9a-f-]{36}$/i.test(proofTag || '')) throw failure('R2_PROOF_JOURNAL_CONFIGURATION_INVALID');
  if (!Array.isArray(allowedBuckets) || allowedBuckets.length < 1 || allowedBuckets.some(value => typeof value !== 'string' || !value)
    || typeof prefix !== 'string' || !prefix) throw failure('R2_PROOF_SCOPE_INVALID');
  if (typeof allowedFetchOrigin !== 'string' || new URL(allowedFetchOrigin).origin !== allowedFetchOrigin) throw failure('R2_PROOF_FETCH_SCOPE_INVALID');
  const bucketScope = new Set(allowedBuckets);
  const approved = validateLimits(limits);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  const priorRecords = resume ? fs.readFileSync(journalPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  if (resume && (!priorRecords.length || priorRecords[0].proofTag !== proofTag)) throw failure('R2_PROOF_JOURNAL_IDENTITY_MISMATCH');
  const descriptor = fs.openSync(journalPath, resume ? 'a' : 'wx', 0o600);
  let sequence = 0;
  const budget = { functionalRequests: 0, cleanupRequests: 0, applicationBytes: 0,
    objectIntentions: 0, completedObjects: 0, multipartIntentions: 0, unresolvedMultipart: 0 };
  const objects = new Map(), sessions = new Map();
  let closed = false;

  function snapshot() { return Object.freeze({ ...budget }); }
  function append(event, fields = {}) {
    if (closed) throw failure('R2_PROOF_JOURNAL_CLOSED');
    const allowed = ['phase', 'operation', 'bucket', 'key', 'uploadId', 'proofTag', 'sha256', 'size', 'status', 'errorCode',
      'cleanupStatus', 'attempt', 'note', 'httpStatusCode', 'requestId', 'extendedRequestId', 'cfId',
      'previousLimits', 'approvedLimits', 'authorization', 'interpreterVersion', 'sourceSequence', 'sourceSha256'];
    const record = { sequence: ++sequence, at: clock().toISOString(), event };
    for (const key of allowed) if (fields[key] !== undefined && fields[key] !== null) record[key] = fields[key];
    record.budget = { ...budget };
    fs.writeSync(descriptor, `${JSON.stringify(record)}\n`, null, 'utf8');
    fs.fsyncSync(descriptor);
    return record;
  }
  if (resume) {
    const reconstructed = reconstructProofJournal(priorRecords);
    sequence = reconstructed.sequence; Object.assign(budget, reconstructed.budget);
    for (const record of priorRecords) {
      const id = record.bucket && record.key ? keyOf({ Bucket: record.bucket, Key: record.key }) : null;
      if (record.event === 'OBJECT_INTENT_RECORDED') objects.set(id, { Bucket: record.bucket, Key: record.key,
        sha256: record.sha256, size: record.size, proofTag, state: record.status, objectSlotReserved: false });
      const object = id ? objects.get(id) : null;
      if (object && ['OBJECT_RESULT', 'MUTATION_RESULT_UNCERTAIN', 'CLEANUP_RESOURCE'].includes(record.event)) {
        if (['PutObjectCommand', 'CompleteMultipartUploadCommand'].includes(record.operation) || ['CONFIRMED', 'UNCERTAIN', 'REMOVED', 'ABSENT'].includes(record.status)) object.objectSlotReserved = true;
        object.state = record.status;
      }
      if (record.event === 'MULTIPART_RESULT' && record.uploadId) {
        const session = sessions.get(record.uploadId) || { Bucket: record.bucket, Key: record.key, UploadId: record.uploadId, proofTag, countedUnresolved: true };
        session.state = record.status; if (['ABORTED', 'COMPLETED', 'ABSENT'].includes(record.status)) session.countedUnresolved = false;
        sessions.set(record.uploadId, session);
      }
      if (record.event === 'OBJECT_RESULT' && record.operation === 'CompleteMultipartUploadCommand' && record.uploadId) {
        const session = sessions.get(record.uploadId);
        if (session) { session.state = 'COMPLETED'; session.countedUnresolved = false; }
      }
      if (record.event === 'MULTIPART_RESULT' && !record.uploadId && record.status === 'UNCERTAIN') sessions.set(`unknown:${record.sequence}:${id}`,
        { Bucket: record.bucket, Key: record.key, proofTag, state: 'UNCERTAIN', countedUnresolved: true });
      if (record.event === 'MUTATION_RESULT_UNCERTAIN' && record.operation === 'CreateMultipartUploadCommand' && !record.uploadId) sessions.set(`unknown:${record.sequence}:${id}`,
        { Bucket: record.bucket, Key: record.key, proofTag, state: 'UNCERTAIN', countedUnresolved: true });
      if (record.uploadId && ['MUTATION_RESULT_UNCERTAIN', 'CLEANUP_RESOURCE'].includes(record.event)) {
        const session = sessions.get(record.uploadId);
        if (session) { session.state = record.status; if (record.status === 'ABSENT') session.countedUnresolved = false; }
      }
    }
    append('JOURNAL_RESUMED', { proofTag, status: 'RESUMED' });
  } else append('JOURNAL_OPENED', { proofTag });

  function recordBudgetAuthorization(previousLimits, authorization) {
    const previous = validateLimits(previousLimits);
    if (!/^[A-Z0-9_-]{3,64}$/.test(authorization || '')) throw failure('R2_PROOF_BUDGET_AUTHORIZATION_INVALID');
    const sameApproved = record => record.event === 'BUDGET_AUTHORIZATION_UPDATED'
      && JSON.stringify(record.approvedLimits) === JSON.stringify(approved);
    const existing = priorRecords.find(sameApproved); if (existing) return Object.freeze({ ...existing });
    return Object.freeze(append('BUDGET_AUTHORIZATION_UPDATED', { previousLimits: previous,
      approvedLimits: approved, authorization, status: 'AUTHORIZED' }));
  }

  function recordJournalInterpretation({ sourceSequence, sourceSha256 }) {
    if (!Number.isSafeInteger(sourceSequence) || sourceSequence < 1 || !/^[A-F0-9]{64}$/.test(sourceSha256 || '')) {
      throw failure('R2_PROOF_JOURNAL_INTERPRETATION_INVALID');
    }
    return Object.freeze(append('JOURNAL_INTERPRETER_SELECTED', { interpreterVersion: JOURNAL_INTERPRETER_VERSION,
      sourceSequence, sourceSha256, status: 'SELECTED' }));
  }

  function reserve({ phase = 'functional', bytes = 0, operation }) {
    const counter = phase === 'cleanup' ? 'cleanupRequests' : 'functionalRequests';
    const requestLimit = phase === 'cleanup' ? approved.cleanupRequests : approved.functionalRequests;
    if (budget[counter] + 1 > requestLimit) throw failure(phase === 'cleanup' ? 'R2_PROOF_CLEANUP_REQUEST_BUDGET_EXHAUSTED' : 'R2_PROOF_FUNCTIONAL_REQUEST_BUDGET_EXHAUSTED');
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw failure('R2_PROOF_BYTE_RESERVATION_INVALID');
    if (phase !== 'cleanup' && budget.applicationBytes + bytes > approved.applicationBytes) throw failure('R2_PROOF_APPLICATION_BYTE_BUDGET_EXHAUSTED');
    budget[counter] += 1;
    if (phase !== 'cleanup') budget.applicationBytes += bytes;
    append('BUDGET_RESERVED', { phase, operation, size: bytes, status: 'RESERVED' });
  }

  function recordTransport(event, fields = {}) {
    if (!['TRANSPORT_STARTED', 'TRANSPORT_RESPONSE_RECEIVED', 'TRANSPORT_FAILED'].includes(event)) throw failure('R2_PROOF_TRANSPORT_EVENT_INVALID');
    const identifier = value => typeof value === 'string' && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;
    const httpStatusCode = Number.isInteger(fields.httpStatusCode) && fields.httpStatusCode >= 100 && fields.httpStatusCode <= 599
      ? fields.httpStatusCode : undefined;
    append(event, { phase: fields.phase === 'cleanup' ? 'cleanup' : 'functional', operation: identifier(fields.operation) || 'HTTP',
      status: event === 'TRANSPORT_STARTED' ? 'STARTED' : event === 'TRANSPORT_RESPONSE_RECEIVED' ? 'RECEIVED' : 'FAILED',
      errorCode: identifier(fields.errorCode), httpStatusCode, requestId: identifier(fields.requestId),
      extendedRequestId: identifier(fields.extendedRequestId), cfId: identifier(fields.cfId) });
  }

  function registerObjectIntent({ Bucket, Key, sha256, size }) {
    if (!Bucket || !Key || !/^[a-f0-9]{64}$/.test(sha256 || '') || !Number.isSafeInteger(size) || size < 1) throw failure('R2_PROOF_OBJECT_INTENT_INVALID');
    if (!bucketScope.has(Bucket) || !Key.startsWith(prefix)) throw failure('R2_PROOF_OBJECT_OUTSIDE_APPROVED_SCOPE');
    const id = keyOf({ Bucket, Key });
    const existing = objects.get(id);
    if (existing) {
      if (existing.sha256 !== sha256 || existing.size !== size) throw failure('R2_PROOF_OBJECT_INTENT_CONFLICT');
      return existing;
    }
    if (budget.objectIntentions + 1 > approved.objectIntentions) throw failure('R2_PROOF_OBJECT_INTENTION_LIMIT');
    budget.objectIntentions += 1;
    const record = { Bucket, Key, sha256, size, proofTag, state: 'INTENDED', objectSlotReserved: false };
    objects.set(id, record);
    append('OBJECT_INTENT_RECORDED', { bucket: Bucket, key: Key, sha256, size, proofTag, status: record.state });
    return record;
  }

  function objectFor(input) {
    const record = objects.get(keyOf(input));
    if (!record) throw failure('R2_PROOF_OBJECT_PROVENANCE_REQUIRED');
    return record;
  }
  function reserveObjectSlot(record) {
    if (record.objectSlotReserved || record.state === 'CONFIRMED') return;
    if (budget.completedObjects + 1 > approved.completedObjects) throw failure('R2_PROOF_COMPLETED_OBJECT_LIMIT');
    budget.completedObjects += 1;
    record.objectSlotReserved = true;
  }
  function assertObjectSlotAvailable(record) {
    if (!record.objectSlotReserved && record.state !== 'CONFIRMED' && budget.completedObjects + 1 > approved.completedObjects) throw failure('R2_PROOF_COMPLETED_OBJECT_LIMIT');
  }
  function assertMultipartAvailable() {
    if (budget.multipartIntentions + 1 > approved.multipartIntentions) throw failure('R2_PROOF_MULTIPART_INTENTION_LIMIT');
    if (budget.unresolvedMultipart + 1 > approved.unresolvedMultipart) throw failure('R2_PROOF_UNRESOLVED_MULTIPART_LIMIT');
  }
  function reserveMultipart(input) {
    if (budget.multipartIntentions + 1 > approved.multipartIntentions) throw failure('R2_PROOF_MULTIPART_INTENTION_LIMIT');
    if (budget.unresolvedMultipart + 1 > approved.unresolvedMultipart) throw failure('R2_PROOF_UNRESOLVED_MULTIPART_LIMIT');
    budget.multipartIntentions += 1; budget.unresolvedMultipart += 1;
    return { Bucket: input.Bucket, Key: input.Key, proofTag, state: 'CREATING', countedUnresolved: true };
  }
  function resolveSession(session) {
    if (session?.countedUnresolved) { budget.unresolvedMultipart -= 1; session.countedUnresolved = false; }
  }
  function commandFields(name, input) { return { operation: name, bucket: input.Bucket, key: input.Key, uploadId: input.UploadId }; }

  function instrumentClient(client, { transportContext } = {}) {
    if (!client || typeof client.send !== 'function') throw failure('R2_PROOF_CLIENT_INVALID');
    if (client.__c4gProofSafeguards === api) return client;
    const rawSend = client.send.bind(client);
    Object.defineProperty(client, '__c4gProofSafeguards', { value: api });
    client.send = async (command, options = {}) => {
      const name = commandName(command), input = command.input || {};
      const phase = options.proofPhase === 'cleanup' ? 'cleanup' : 'functional';
      if (input.Bucket && !bucketScope.has(input.Bucket)) throw failure('R2_PROOF_OPERATION_OUTSIDE_APPROVED_BUCKET');
      if (input.Key && !input.Key.startsWith(prefix)) throw failure('R2_PROOF_OPERATION_OUTSIDE_APPROVED_PREFIX');
      if (input.Prefix && !input.Prefix.startsWith(prefix)) throw failure('R2_PROOF_OPERATION_OUTSIDE_APPROVED_PREFIX');
      if (name === 'DeleteObjectCommand' && phase !== 'cleanup') throw failure('R2_PROOF_DELETE_REQUIRES_CLEANUP_PHASE');
      if (['UploadPartCommand', 'CompleteMultipartUploadCommand', 'AbortMultipartUploadCommand'].includes(name)) {
        const known = sessions.get(input.UploadId);
        if (!known || known.Bucket !== input.Bucket || known.Key !== input.Key) throw failure('R2_PROOF_MULTIPART_PROVENANCE_REQUIRED');
      }
      let object = null, pendingSession = null, objectCompletion = false;
      if (name === 'PutObjectCommand') {
        object = objectFor(input); assertObjectSlotAvailable(object); objectCompletion = true;
        input.Metadata = { ...(input.Metadata || {}), c4gproof: proofTag };
        if (input.IfNoneMatch !== '*') throw failure('R2_PROOF_CONDITIONAL_CREATE_REQUIRED');
      } else if (name === 'CreateMultipartUploadCommand') {
        object = objectFor(input); assertMultipartAvailable();
        input.Metadata = { ...(input.Metadata || {}), c4gproof: proofTag };
      } else if (name === 'CompleteMultipartUploadCommand') {
        object = objectFor(input); assertObjectSlotAvailable(object); objectCompletion = true;
        if (input.IfNoneMatch !== '*') throw failure('R2_PROOF_CONDITIONAL_CREATE_REQUIRED');
      }
      const bytes = payloadBytes(name, input);
      reserve({ phase, bytes, operation: name });
      if (name === 'PutObjectCommand' || name === 'CompleteMultipartUploadCommand') reserveObjectSlot(object);
      if (name === 'CreateMultipartUploadCommand') pendingSession = reserveMultipart(input);
      append('PROVIDER_ATTEMPT', { phase, ...commandFields(name, input), proofTag: MUTATIONS.has(name) ? proofTag : undefined,
        sha256: object?.sha256, size: bytes, status: 'ATTEMPTED' });
      try {
        const invoke = () => rawSend(command, { ...options, proofPhase: undefined });
        const result = await (transportContext ? transportContext.run({ phase, operation: name }, invoke) : invoke());
        if (name === 'CreateMultipartUploadCommand') {
          if (!result?.UploadId) { pendingSession.state = 'UNCERTAIN'; sessions.set(`unknown:${budget.multipartIntentions}:${keyOf(input)}`, pendingSession);
            append('MULTIPART_RESULT', { ...commandFields(name, input), proofTag, status: 'UNCERTAIN', note: 'UPLOAD_ID_NOT_RECEIVED' }); return result; }
          pendingSession.UploadId = result.UploadId; pendingSession.state = 'KNOWN'; sessions.set(result.UploadId, pendingSession);
          append('MULTIPART_RESULT', { ...commandFields(name, { ...input, UploadId: result.UploadId }), proofTag, status: 'KNOWN' });
        } else if (name === 'CompleteMultipartUploadCommand') {
          const session = sessions.get(input.UploadId); resolveSession(session); if (session) session.state = 'COMPLETED';
          object.state = 'CONFIRMED'; append('OBJECT_RESULT', { ...commandFields(name, input), proofTag, sha256: object.sha256, size: object.size, status: 'CONFIRMED' });
        } else if (name === 'PutObjectCommand') {
          object.state = 'CONFIRMED'; append('OBJECT_RESULT', { ...commandFields(name, input), proofTag, sha256: object.sha256, size: object.size, status: 'CONFIRMED' });
        } else if (name === 'AbortMultipartUploadCommand') {
          const session = sessions.get(input.UploadId); resolveSession(session); if (session) session.state = 'ABORTED';
          append('MULTIPART_RESULT', { ...commandFields(name, input), proofTag, status: 'ABORTED' });
        } else if (name === 'DeleteObjectCommand') {
          const record = objects.get(keyOf(input)); if (record) record.state = 'DELETED';
          append('OBJECT_RESULT', { ...commandFields(name, input), proofTag, status: 'DELETED' });
        } else append('PROVIDER_RESULT', { phase, ...commandFields(name, input), status: 'SUCCEEDED' });
        return result;
      } catch (error) {
        if (pendingSession) { pendingSession.state = 'UNCERTAIN'; sessions.set(`unknown:${budget.multipartIntentions}:${keyOf(input)}`, pendingSession); }
        if (objectCompletion) object.state = 'UNCERTAIN';
        const session = input.UploadId ? sessions.get(input.UploadId) : null;
        if (session && ['CompleteMultipartUploadCommand', 'AbortMultipartUploadCommand'].includes(name)) session.state = 'UNCERTAIN';
        append(MUTATIONS.has(name) ? 'MUTATION_RESULT_UNCERTAIN' : 'PROVIDER_RESULT', { phase, ...commandFields(name, input),
          proofTag: MUTATIONS.has(name) ? proofTag : undefined, sha256: object?.sha256, size: bytes, status: 'UNCERTAIN', errorCode: safeError(error) });
        throw error;
      }
    };
    return client;
  }

  async function controlledFetch(fetchFunction, url, init, { expectedBytes = 0 } = {}) {
    if (typeof fetchFunction !== 'function' || !(url instanceof URL || typeof url === 'string')) throw failure('R2_PROOF_FETCH_INVALID');
    if (new URL(url).origin !== allowedFetchOrigin) throw failure('R2_PROOF_FETCH_OUTSIDE_APPROVED_ORIGIN');
    reserve({ phase: 'functional', bytes: expectedBytes, operation: 'presigned GET' });
    append('PROVIDER_ATTEMPT', { phase: 'functional', operation: 'presigned GET', size: expectedBytes, status: 'ATTEMPTED' });
    recordTransport('TRANSPORT_STARTED', { phase: 'functional', operation: 'presigned GET' });
    try {
      const result = await fetchFunction(url, init);
      const headers = result?.headers;
      recordTransport('TRANSPORT_RESPONSE_RECEIVED', { phase: 'functional', operation: 'presigned GET', httpStatusCode: result?.status,
        requestId: headers?.get?.('x-amz-request-id'), extendedRequestId: headers?.get?.('x-amz-id-2'), cfId: headers?.get?.('cf-ray') });
      append('PROVIDER_RESULT', { phase: 'functional', operation: 'presigned GET', status: 'SUCCEEDED' });
      return result;
    } catch (error) {
      recordTransport('TRANSPORT_FAILED', { phase: 'functional', operation: 'presigned GET', errorCode: safeError(error),
        httpStatusCode: error?.$metadata?.httpStatusCode, requestId: error?.$metadata?.requestId,
        extendedRequestId: error?.$metadata?.extendedRequestId, cfId: error?.$metadata?.cfId });
      append('PROVIDER_RESULT', { phase: 'functional', operation: 'presigned GET', status: 'FAILED', errorCode: safeError(error) });
      throw error;
    }
  }

  async function cleanupKnownResources(client, sdk) {
    let partial = false, uncertain = false;
    for (const session of sessions.values()) {
      if (['ABORTED', 'COMPLETED'].includes(session.state)) continue;
      if (!session.UploadId) { partial = true; uncertain = true; append('CLEANUP_RESOURCE', { bucket: session.Bucket, key: session.Key,
        proofTag, status: 'PRESERVED_UNPROVEN', note: 'UPLOAD_ID_NOT_RECEIVED' }); continue; }
      try {
        await client.send(new sdk.AbortMultipartUploadCommand({ Bucket: session.Bucket, Key: session.Key, UploadId: session.UploadId }), { proofPhase: 'cleanup' });
        const listed = await client.send(new sdk.ListMultipartUploadsCommand({ Bucket: session.Bucket, Prefix: session.Key, MaxUploads: 100 }), { proofPhase: 'cleanup' });
        if ((listed.Uploads || []).some(value => value.Key === session.Key && value.UploadId === session.UploadId)) throw failure('R2_PROOF_MULTIPART_STILL_PRESENT');
      } catch (error) {
        if (missing(error)) { resolveSession(session); session.state = 'ABSENT'; append('CLEANUP_RESOURCE', { bucket: session.Bucket,
          key: session.Key, uploadId: session.UploadId, proofTag, status: 'ABSENT' }); continue; }
        partial = true; uncertain = true; append('CLEANUP_RESOURCE', { bucket: session.Bucket, key: session.Key, uploadId: session.UploadId,
          proofTag, status: 'UNCERTAIN', errorCode: safeError(error) }); }
    }
    for (const object of objects.values()) {
      if (!object.objectSlotReserved || ['DELETED', 'ABSENT', 'REMOVED'].includes(object.state)) continue;
      let head;
      try { head = await client.send(new sdk.HeadObjectCommand({ Bucket: object.Bucket, Key: object.Key }), { proofPhase: 'cleanup' }); }
      catch (error) { if (missing(error)) { object.state = 'ABSENT'; append('CLEANUP_RESOURCE', { bucket: object.Bucket, key: object.Key, proofTag, status: 'ABSENT' }); continue; }
        partial = true; uncertain = true; append('CLEANUP_RESOURCE', { bucket: object.Bucket, key: object.Key, proofTag, status: 'UNCERTAIN', errorCode: safeError(error) }); continue; }
      const owned = head?.Metadata?.c4gproof === proofTag && head?.Metadata?.sha256 === object.sha256 && Number(head?.ContentLength) === object.size;
      if (!owned) { partial = true; append('CLEANUP_RESOURCE', { bucket: object.Bucket, key: object.Key, proofTag, status: 'PRESERVED_UNPROVEN' }); continue; }
      try {
        await client.send(new sdk.DeleteObjectCommand({ Bucket: object.Bucket, Key: object.Key }), { proofPhase: 'cleanup' });
        try { await client.send(new sdk.HeadObjectCommand({ Bucket: object.Bucket, Key: object.Key }), { proofPhase: 'cleanup' });
          partial = true; uncertain = true; append('CLEANUP_RESOURCE', { bucket: object.Bucket, key: object.Key, proofTag, status: 'STILL_PRESENT' }); }
        catch (error) { if (!missing(error)) throw error; object.state = 'DELETED'; append('CLEANUP_RESOURCE', { bucket: object.Bucket, key: object.Key, proofTag, status: 'REMOVED' }); }
      } catch (error) { partial = true; uncertain = true; append('CLEANUP_RESOURCE', { bucket: object.Bucket, key: object.Key, proofTag, status: 'UNCERTAIN', errorCode: safeError(error) }); }
    }
    const cleanupStatus = uncertain ? 'UNCERTAIN' : partial ? 'PARTIAL' : 'COMPLETE';
    append('CLEANUP_FINISHED', { cleanupStatus, status: cleanupStatus });
    return Object.freeze({ status: cleanupStatus, budget: snapshot() });
  }

  function writeRecoveryInstructions(filePath) {
    if (!path.isAbsolute(filePath || '')) throw failure('R2_PROOF_RECOVERY_PATH_INVALID');
    const value = { journal: journalPath, rule: 'Remove only exact resources whose journal provenance and provider metadata agree.',
      uncertainResultsRequireReconciliation: true, cleanupIsBestEffort: true };
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  }
  function close() { if (!closed) { append('JOURNAL_CLOSED', { status: 'CLOSED' }); closed = true; fs.closeSync(descriptor); } }
  const api = { limits: approved, proofTag, registerObjectIntent, instrumentClient, recordTransport, recordBudgetAuthorization,
    recordJournalInterpretation,
    controlledFetch, cleanupKnownResources,
    writeRecoveryInstructions, snapshot, close, objects, sessions };
  return api;
}

module.exports = { createProofSafeguards, reconstructProofJournal, payloadBytes, JOURNAL_INTERPRETER_VERSION };
