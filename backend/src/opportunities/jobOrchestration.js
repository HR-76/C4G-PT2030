'use strict';

const crypto = require('node:crypto');
const { classifyDuplicate } = require('./deduplication');
const { OpportunityError } = require('./errors');
const { cloneFreeze } = require('./immutability');
const { canonicalize } = require('./canonicalization');
const { result } = require('../async/jobResult');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RULE = 'opportunity-deduplication-v1';
const REASONS = Object.freeze(['QUALITY_PROJECTION_DRIFT', 'DUPLICATE_CANDIDATE_RESCAN_REQUIRED']);
const CURSOR = /^f12ds1\.([1-8])\.([0-9a-f-]{36})\.([a-f0-9]{64})$/;
const DOMAIN = 'C4G:OPPORTUNITY:DUPLICATE_SCAN_CURSOR:v1\0';

function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function cursorMaterial(scope, payload, priority, targetId) {
  return canonicalize({ organizationId: scope, sourceOpportunityId: payload.opportunityId,
    sourceRevisionId: payload.revisionId, ruleVersion: payload.ruleVersion, lastBlockPriority: priority,
    lastTargetId: targetId });
}
function createCursor(scope, payload, priority, targetId) {
  return `f12ds1.${priority}.${targetId}.${sha(DOMAIN + cursorMaterial(scope, payload, priority, targetId))}`;
}
function parseCursor(value, scope, payload) {
  if (value === null) return null;
  const match = CURSOR.exec(value || '');
  if (!match || !UUID.test(match[2])) throw new OpportunityError('OPPORTUNITY_CURSOR_INVALID');
  const expected = sha(DOMAIN + cursorMaterial(scope, payload, Number(match[1]), match[2]));
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(match[3]))) {
    throw new OpportunityError('OPPORTUNITY_CURSOR_INVALID');
  }
  return Object.freeze({ priority: Number(match[1]), targetId: match[2] });
}
function validatePayload(type, payload) {
  if (!payload || Object.getPrototypeOf(payload) !== Object.prototype) throw new OpportunityError('OPPORTUNITY_INVALID_INPUT');
  const keys = type === 'scan' ? ['opportunityId', 'revisionId', 'ruleVersion'] : ['opportunityId', 'revisionId', 'reasonCode'];
  if (Reflect.ownKeys(payload).length !== keys.length || keys.some(key => !Object.hasOwn(payload, key))
      || !UUID.test(payload.opportunityId) || !UUID.test(payload.revisionId)
      || keys.slice(2).some(key => typeof payload[key] !== 'string')) throw new OpportunityError('OPPORTUNITY_INVALID_INPUT');
  if (type === 'scan' && payload.ruleVersion !== RULE) throw Object.assign(new Error('INCOMPATIBLE'), { code: 'INCOMPATIBLE' });
  if (type === 'reconcile' && !REASONS.includes(payload.reasonCode)) throw Object.assign(new Error('POISON_MESSAGE'), { code: 'POISON_MESSAGE' });
  return payload;
}
function ensureExecution(input, actorCode, now) {
  if (!input || input.actorCode !== actorCode || typeof input.idempotencyKey !== 'string'
      || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 128
      || !Number.isInteger(input.attempt) || input.attempt < 1 || !Number.isFinite(Date.parse(input.deadlineAt))) {
    throw new OpportunityError('OPPORTUNITY_INVALID_INPUT');
  }
  if (Date.parse(input.deadlineAt) <= now().getTime()) throw Object.assign(new Error('EXPIRED'), { code: 'EXPIRED' });
}
function createDuplicateScanOrchestration({ repository, continuationPort = null, clock = () => new Date() }) {
  if (!repository || typeof repository.scanDuplicateBatch !== 'function' || typeof repository.recordCandidate !== 'function') throw new TypeError('Duplicate scan repository is invalid.');
  return Object.freeze({ async execute(input, context, transactionClient = null) {
    ensureExecution(input, 'F12_DUPLICATE_SCANNER', clock); const payload = validatePayload('scan', input.payload);
    const cursor = input.root === true ? null : parseCursor(input.idempotencyKey, repository.scope, payload);
    const batch = await repository.scanDuplicateBatch({ ...payload, cursor });
    const recorded = [];
    for (const target of batch.targets) {
      const decision = classifyDuplicate(batch.source, target);
      const stored = await repository.recordCandidate({ requestId: `scan:${sha(`${payload.revisionId}:${target.revisionId}:${payload.ruleVersion}`)}`,
        left: batch.source, right: target, ...decision }, context);
      if (stored.persisted !== false) recorded.push(stored);
    }
    let continuation = null;
    if (batch.moreCandidates) {
      const last = batch.targets.at(-1);
      continuation = createCursor(repository.scope, payload, last.blockPriority, last.opportunityId);
      if (!continuationPort || typeof continuationPort.enqueue !== 'function') throw new OpportunityError('OPPORTUNITY_DATABASE_UNAVAILABLE');
      await continuationPort.enqueue({ payload, idempotencyKey: continuation, correlationId: input.correlationId,
        causationId: input.executionId, deadlineAt: input.deadlineAt }, transactionClient);
    }
    return cloneFreeze({ jobResult: result('SUCCESS'), processed: batch.targets.length,
      persisted: recorded.length, moreCandidates: batch.moreCandidates, continuation });
  }});
}
function createCatalogReconcileOrchestration({ repository, scanIntentPort, clock = () => new Date() }) {
  if (!repository || typeof repository.recomputeCurrentQuality !== 'function' || !scanIntentPort || typeof scanIntentPort.enqueue !== 'function') throw new TypeError('Catalog reconcile dependencies are invalid.');
  return Object.freeze({ async execute(input, context, transactionClient = null) {
    ensureExecution(input, 'F12_CATALOG_RECONCILER', clock); const payload = validatePayload('reconcile', input.payload);
    if (payload.reasonCode === 'QUALITY_PROJECTION_DRIFT') {
      const outcome = await repository.recomputeCurrentQuality({ ...payload, requestId: input.idempotencyKey }, context);
      return cloneFreeze({ jobResult: result('SUCCESS'), effect: outcome.changed ? 'QUALITY_REPAIRED' : 'NO_CHANGE' });
    }
    const needed = await repository.requiresDuplicateRescan(payload);
    if (!needed) return cloneFreeze({ jobResult: result('SUCCESS'), effect: 'NO_CHANGE' });
    const created = await scanIntentPort.enqueue({ payload: { opportunityId: payload.opportunityId,
      revisionId: payload.revisionId, ruleVersion: RULE }, idempotencyKey: `scan:${payload.revisionId}:${RULE}`,
      correlationId: input.correlationId, causationId: input.executionId, deadlineAt: input.deadlineAt }, transactionClient);
    return cloneFreeze({ jobResult: result('SUCCESS'), effect: created ? 'SCAN_ENQUEUED' : 'NO_CHANGE' });
  }});
}

module.exports = { REASONS, createCatalogReconcileOrchestration, createCursor,
  createDuplicateScanOrchestration, parseCursor };
