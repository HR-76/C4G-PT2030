'use strict';
const { canonicalClone } = require('./canonicalization');
const authoring = require('./authoringContracts');
const editorial = require('./editorialContracts');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const methods = Object.freeze({ create: ['draftId', 'items', 'idempotencyKey'], edit: ['expectedRevision', 'items', 'idempotencyKey'],
  submit: ['expectedRevision', 'idempotencyKey'], approve: ['concurrencyToken', 'idempotencyKey'], publish: ['concurrencyToken', 'idempotencyKey'] });
function fail(code = 'INVALID_INPUT') { throw Object.assign(new Error(code), { code }); }
function exact(value, required, optional = []) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || required.some(k => !Object.hasOwn(value, k))
    || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) fail();
}
function validate(method, input, id) {
  let value;
  try { value = canonicalClone(input); } catch { fail(); }
  if (methods[method]) {
    exact(value, methods[method]);
    if (method !== 'create' && !UUID.test(id)) fail();
    if (method === 'create') authoring.validateCreate({ ...value, scopeId: null });
    else if (method === 'edit') authoring.validateEdit({ ...value, draftId: id });
    else if (method === 'submit') editorial.submit({ ...value, draftId: id });
    else if (!UUID.test(value.idempotencyKey) || typeof value.concurrencyToken !== 'string' || value.concurrencyToken.length > 256) fail();
    return value;
  }
  if (method === 'lookup') {
    exact(value, ['operation', 'resourceId', 'idempotencyKey'], ['expectedRevision']);
    if (!['CREATE_DRAFT', 'EDIT_DRAFT', 'SUBMIT', 'APPROVE', 'PUBLISH'].includes(value.operation)
      || !UUID.test(value.resourceId) || !UUID.test(value.idempotencyKey)) fail();
    const revision = ['EDIT_DRAFT', 'SUBMIT'].includes(value.operation);
    if (revision ? !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1 || value.expectedRevision >= Number.MAX_SAFE_INTEGER
      : Object.hasOwn(value, 'expectedRevision')) fail();
    return value;
  }
  if (['drafts', 'candidates', 'versions', 'catalog'].includes(method)) {
    exact(value, method === 'catalog' ? ['domain'] : [], method === 'catalog' ? ['releaseId', 'locale', 'limit', 'cursor'] : ['limit', 'cursor']);
    const limit = value.limit === undefined ? 20 : Number(value.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (value.cursor !== undefined && (typeof value.cursor !== 'string' || value.cursor.length > 4096))) fail();
    if (method === 'catalog' && (!['THEMATIC_AREA', 'STRATEGIC_PRIORITY'].includes(value.domain)
      || (value.releaseId !== undefined && !UUID.test(value.releaseId)) || (value.locale !== undefined && !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(value.locale)))) fail();
    return { ...value, limit, ...(method === 'catalog' ? { locale: value.locale || 'pt-PT' } : {}) };
  }
  exact(value, []);
  if (method !== 'context' && !UUID.test(id)) fail();
  return value;
}
const coverage = Object.freeze({ includedDomains: ['THEMATIC_AREA', 'STRATEGIC_PRIORITY'], scopeType: 'ORGANIZATION',
  constraintsAssessed: false, effectiveSnapshot: false, f14Consumable: false });
function completion(value) {
  if (!['COMPLETE', 'INCOMPLETE'].includes(value?.result) || !Array.isArray(value.findings)) fail('SERVICE_UNAVAILABLE');
  const codes = ['REQUIRED_SLOT_MISSING', 'KNOWN_REQUIRED', 'INVALID_CARDINALITY', 'DUPLICATE_CONCEPT', 'UNKNOWN_EXPLICIT', 'STATE_NOT_ALLOWED', 'REFERENCE_INCOMPATIBLE', 'NON_CURRENT_MATERIAL'];
  return { result: value.result, findings: value.findings.map(f => {
    if (!codes.includes(f.code) || !['ERROR', 'INFO'].includes(f.severity)) fail('SERVICE_UNAVAILABLE');
    return { code: f.code, domain: { thematicAreas: 'THEMATIC_AREA', strategicPriorities: 'STRATEGIC_PRIORITY' }[f.slot] || null,
      itemId: f.itemId || null, severity: f.severity };
  }) };
}
function receipt(method, value) {
  if (['create', 'edit', 'CREATE_DRAFT', 'EDIT_DRAFT'].includes(method)) return { draftId: value.draftId, revision: value.revision, lifecycle: value.lifecycle };
  if (['submit', 'SUBMIT'].includes(method)) return { candidateId: value.candidateId, sourceRevision: value.sourceRevision, coverage, completion: completion(value.completion) };
  if (['approve', 'APPROVE'].includes(method)) return { versionId: value.versionId, state: 'APPROVED' };
  if (['publish', 'PUBLISH'].includes(method)) return { versionId: value.versionId, state: 'PUBLISHED', active: false };
  fail('SERVICE_UNAVAILABLE');
}
module.exports = { validate, exact, fail, UUID, coverage, completion, receipt };
