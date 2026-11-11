'use strict';
const { types: { isProxy } } = require('node:util');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STABLE_CODE = /^[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)*$/;
const CLOSED_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const TYPES = new Set(['UNIT', 'TEAM']);

function exact(value, keys) {
  return Boolean(value) && typeof value === 'object' && !isProxy(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function uuid(value) { return typeof value === 'string' && UUID.test(value); }
function stableCode(value) {
  return value === null || (typeof value === 'string' && value.length >= 1 && value.length <= 64
    && Buffer.byteLength(value, 'ascii') === value.length && STABLE_CODE.test(value));
}
function label(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 256
    && value === value.trim() && value.normalize('NFC') === value && !/[\u0000-\u001f\u007f]/.test(value);
}
function key(value) { return typeof value === 'string' && value.length >= 8 && value.length <= 128 && !/\s/.test(value); }
function actor(value) {
  if (!value || value.type !== 'HUMAN' || !uuid(value.id)
      || !Number.isSafeInteger(value.membershipVersion) || value.membershipVersion < 1
      || !Number.isSafeInteger(value.authorizationVersion) || value.authorizationVersion < 1) return false;
  return exact(value, ['type', 'id', 'membershipId', 'membershipVersion', 'authorizationVersion'])
    && uuid(value.membershipId);
}
function assurance(value) {
  return value === null || (exact(value, ['authTime', 'acr', 'amr', 'policyVersion'])
    && Number.isSafeInteger(value.authTime) && typeof value.acr === 'string'
    && Array.isArray(value.amr) && value.amr.every(item => typeof item === 'string')
    && typeof value.policyVersion === 'string');
}
function provenance(value) {
  return exact(value, ['sourceType', 'sourceReference', 'observedAt'])
    && CLOSED_CODE.test(value.sourceType) && typeof value.sourceReference === 'string'
    && value.sourceReference.length >= 1 && value.sourceReference.length <= 128
    && typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt));
}
function common(value, operationKeys) {
  return exact(value, operationKeys) && key(value.idempotencyKey) && uuid(value.correlationId)
    && actor(value.actor) && assurance(value.assuranceEvidence) && provenance(value.provenance);
}
function create(value) {
  const keys = ['idempotencyKey', 'correlationId', 'scopeType', 'label', 'stableCode', 'parentScopeId', 'actor', 'assuranceEvidence', 'provenance'];
  if (!common(value, keys) || !TYPES.has(value.scopeType) || !label(value.label) || !stableCode(value.stableCode)
      || (value.parentScopeId !== null && !uuid(value.parentScopeId))) throw new TypeError('Organizational scope create command is invalid.');
  return Object.freeze({ ...value, actor: Object.freeze({ ...value.actor }), provenance: Object.freeze({ ...value.provenance }) });
}
function mutation(value, keys, extra) {
  if (!common(value, keys) || !uuid(value.scopeId) || !Number.isSafeInteger(value.expectedRevision)
      || value.expectedRevision < 1 || !extra(value)) throw new TypeError('Organizational scope mutation command is invalid.');
  return Object.freeze({ ...value, actor: Object.freeze({ ...value.actor }), provenance: Object.freeze({ ...value.provenance }) });
}
function rename(value) { return mutation(value, ['idempotencyKey','correlationId','scopeId','expectedRevision','label','actor','assuranceEvidence','provenance'], input => label(input.label)); }
function reparent(value) { return mutation(value, ['idempotencyKey','correlationId','scopeId','expectedRevision','parentScopeId','actor','assuranceEvidence','provenance'], input => input.parentScopeId === null || uuid(input.parentScopeId)); }
function archive(value) { return mutation(value, ['idempotencyKey','correlationId','scopeId','expectedRevision','reasonCode','actor','assuranceEvidence','provenance'], input => input.actor.type === 'HUMAN' && CLOSED_CODE.test(input.reasonCode)); }
function read(value) {
  if (!exact(value, ['correlationId','scopeId','actor','assuranceEvidence']) || !uuid(value.correlationId) || !uuid(value.scopeId)
      || !actor(value.actor) || !assurance(value.assuranceEvidence)) {
    throw new TypeError('Organizational scope read command is invalid.');
  }
  return Object.freeze({ ...value, actor: Object.freeze({ ...value.actor }) });
}

module.exports = { CLOSED_CODE, STABLE_CODE, TYPES, archive, assurance, create, exact, label, read, rename, reparent, stableCode, uuid };
