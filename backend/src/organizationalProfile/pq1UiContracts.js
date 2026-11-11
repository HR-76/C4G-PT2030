'use strict';
const authoring = require('./authoringContracts');
const competencies = require('./competencyContracts');
const { canonicalClone } = require('./canonicalization');
const { COVERAGE } = require('./pq1Material');
const { exact, UUID, fail } = require('./editorialUiContracts');
const OPS = Object.freeze({ create: 'CREATE_DRAFT', edit: 'EDIT_ITEMS', competencies: 'SET_COMPETENCIES',
  experiences: 'SET_EXPERIENCES', attach: 'ATTACH_EVIDENCE', verify: 'VERIFY', revoke: 'REVOKE_VERIFICATION',
  submit: 'SUBMIT', approve: 'APPROVE', publish: 'PUBLISH' });
const domain = { competencies: 'setCompetencies', experiences: 'setExperiences', attach: 'attachEvidence', verify: 'verifyCompetency' };
function validate(method, raw, id) {
  let v; try { v = canonicalClone(raw); } catch { fail('INVALID_INPUT'); }
  if (['create','edit'].includes(method)) {
    exact(v, method === 'create' ? ['draftId','items','idempotencyKey'] : ['expectedRevision','items','idempotencyKey']);
    if (method === 'create') authoring.validateCreate({ ...v, scopeId: null });
    else { if (!UUID.test(id)) fail('INVALID_INPUT'); authoring.validateEdit({ ...v, draftId: id }); }
  } else if (domain[method]) {
    if (!UUID.test(id)) fail('INVALID_INPUT');
    const command = { ...v, draftId: id };
    if (method === 'experiences') {
      if (!Array.isArray(v.experiences)) fail('INVALID_INPUT');
      command.experiences = v.experiences.map(e => {
        exact(e, ['experienceId','versionId','typeId','observedFrom','observedUntil']);
        return { ...e, provenanceRef: '01800000-0000-4000-8000-000000000099' };
      });
    }
    competencies[domain[method]](command);
  } else if (method === 'submit') {
    require('./editorialContracts').submit({ ...v, draftId: id });
  } else if (['approve','publish','revoke'].includes(method)) {
    exact(v, ['concurrencyToken','idempotencyKey', ...(method === 'revoke' ? ['reasonCode'] : [])]);
    if (!UUID.test(id) || !UUID.test(v.idempotencyKey) || typeof v.concurrencyToken !== 'string' || v.concurrencyToken.length > 256) fail('INVALID_INPUT');
    if (method === 'revoke' && !require('./pq1Release').definition.reasons.includes(v.reasonCode)) fail('INVALID_INPUT');
  } else if (method === 'lookup') {
    exact(v, ['operation','resourceId','idempotencyKey'], ['expectedRevision']);
    if (!Object.values(OPS).includes(v.operation) || !UUID.test(v.resourceId) || !UUID.test(v.idempotencyKey)) fail('INVALID_INPUT');
    if (v.expectedRevision !== undefined && (!Number.isSafeInteger(v.expectedRevision) || v.expectedRevision < 1)) fail('INVALID_INPUT');
  } else if (['drafts','candidates','versions','catalog','documents'].includes(method)) {
    exact(v, method === 'catalog' ? ['kind'] : [], ['limit','cursor', ...(method === 'catalog' ? ['releaseId'] : [])]);
    const limit = v.limit === undefined ? 20 : Number(v.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (v.cursor !== undefined && (typeof v.cursor !== 'string' || v.cursor.length > 4096))) fail('INVALID_INPUT');
    if (method === 'catalog' && (!['THEMATIC_AREA','STRATEGIC_PRIORITY','COMPETENCY_CONCEPT','FRAMEWORK_LEVEL','EXPERIENCE_TYPE','VERIFICATION_METHOD'].includes(v.kind)
      || (v.releaseId !== undefined && !UUID.test(v.releaseId)))) fail('INVALID_INPUT');
    return { ...v, limit };
  } else {
    exact(v, []);
    if (method !== 'context' && !UUID.test(id)) fail('INVALID_INPUT');
  }
  return v;
}
function completion(value) {
  if (!['COMPLETE','INCOMPLETE'].includes(value?.result) || !Array.isArray(value.findings)) fail('SERVICE_UNAVAILABLE');
  return { result: value.result, findings: value.findings.map(f => ({ slot: f.slot, code: f.code, itemId: f.itemId, severity: f.severity })) };
}
function receipt(method, value) {
  if (['create','edit', ...Object.keys(domain)].includes(method)) return { draftId: value.draftId, revision: value.revision, lifecycle: value.lifecycle };
  if (method === 'submit') return { candidateId: value.candidateId, sourceRevision: value.sourceRevision, coverage: COVERAGE, completion: completion(value.completion) };
  if (method === 'approve') return { versionId: value.versionId, state: 'APPROVED' };
  if (method === 'publish') return { versionId: value.versionId, state: 'PUBLISHED', active: false, effectiveSnapshot: false, f14Consumable: false };
  if (method === 'revoke') return { verificationId: value.verificationId, status: 'REVOKED' };
  fail('SERVICE_UNAVAILABLE');
}
module.exports = { validate, receipt, completion, OPS, domain, coverage: COVERAGE, fail };
