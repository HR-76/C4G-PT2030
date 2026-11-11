'use strict';
const { canonicalClone, canonicalize } = require('../organizationalProfile/canonicalization');
const { digest } = require('../organizationalProfile/pq1Material');
const criteriaContract = require('../opportunityCriteria/contracts');
const { assertSnapshot, instant } = require('./materializer');
const { assertObservation } = require('./admissibility');
const { tuple, bounded, fail } = require('./release');
function sameConcept(a, b) { return a && b && ['conceptId', 'schemeId', 'releaseId'].every(k => a[k] === b[k]); }
// Inputs are trusted repository records, not HTTP payloads. The composition
// must authorize all sources and validate live catalog/F11 references first.
function evaluate({ organizationId, snapshot, snapshotDigest, criteria, observation, identity }) {
  assertSnapshot(snapshot, snapshotDigest, organizationId);
  const evaluatedAt = observation.observedAt; instant(evaluatedAt);
  assertObservation(snapshot.material, observation, organizationId, evaluatedAt);
  criteriaContract.validate('save', { requestId: identity.criteriaRevisionId, expectedHeadRevision: 1,
    opportunityRevisionId: identity.opportunityRevisionId, ...criteria }, identity.opportunityId);
  if (criteriaContract.findings(criteria).length) fail('CRITERIA_INCOMPLETE');
  if (!Number.isSafeInteger(identity.generation) || identity.generation < 1) fail();
  for (const key of ['opportunityId', 'opportunityRevisionId', 'criteriaRevisionId', 'snapshotId', 'activationId']) criteriaContract.uuid(identity[key]);
  const m = snapshot.material;
  const lines = [...criteria.criteria].sort((a, b) => a.criterionId.localeCompare(b.criterionId)).map(c => {
    const source=criteria.sources.find(s=>s.sourceId===c.evidence.sourceId);
    const line = { criterionId: c.criterionId, kind: c.kind, conceptRef: c.conceptRef, interpretationText:c.interpretationText,
      source:{sourceId:source.sourceId,label:source.label,sourceKind:source.sourceKind,reference:source.reference,versionLabel:source.versionLabel},
      criteriaEvidence: c.evidence, result: 'UNKNOWN', reason: null, assertionVersionIds: [], verificationIds: [], itemVersionIds: [] };
    if (c.kind === 'COMPETENCY_REQUIREMENT') {
      const assertions = m.assertions.filter(a => sameConcept(a.conceptRef, c.conceptRef));
      line.assertionVersionIds = assertions.map(a => a.versionId).sort();
      if (!assertions.length) line.reason = m.assertions.some(a => a.knowledgeStatus === 'UNKNOWN') ? 'COMPETENCY_KNOWLEDGE_UNKNOWN' : 'COMPETENCY_NOT_DECLARED';
      else {
        const support = observation.verifications.filter(v => line.assertionVersionIds.includes(v.assertionVersionId));
        const valid = support.filter(v => v.status === 'VERIFIED').sort((a, b) => a.verificationId.localeCompare(b.verificationId));
        if (valid.length) {
          line.result = 'SATISFIED'; line.reason = 'VERIFIED_AT_EVALUATION';
          line.verificationIds = [valid[0].verificationId];
        } else {
          line.verificationIds = support.map(v => v.verificationId).sort();
          line.reason = !support.length ? 'NO_VERIFICATION' : support.some(v => v.status === 'REVOKED') ? 'VERIFICATION_REVOKED' : 'VERIFICATION_EXPIRED';
        }
      }
    } else {
      const domain = criteriaContract.kinds[c.kind], items = m.items.filter(i => i.domain === domain);
      const matches = items.filter(i => sameConcept(i.conceptRef, c.conceptRef));
      line.itemVersionIds = matches.map(i => i.itemVersionId).sort();
      line.result = matches.length ? 'AFFINITY_OBSERVED' : items.some(i => i.knowledgeStatus === 'UNKNOWN') ? 'UNKNOWN' : 'AFFINITY_NOT_OBSERVED';
      line.reason = line.result === 'UNKNOWN' ? 'KNOWLEDGE_UNKNOWN' : line.result === 'AFFINITY_OBSERVED' ? 'EXACT_CONCEPT_MATCH' : 'NO_EXACT_CONCEPT_MATCH';
    }
    return line;
  });
  const positive = new Set(lines.filter(l => l.result === 'SATISFIED').flatMap(l => l.verificationIds));
  const deadlines = observation.verifications.filter(v => positive.has(v.verificationId) && v.validUntil !== null).map(v => instant(v.validUntil));
  const result = canonicalClone({ schema: tuple.result, rules: tuple.rules, organizationId, identity,
    evaluatedAt, globalResult: 'INDETERMINATE', coverage: { ...snapshot.coverage, evaluatedCriterionIds: lines.map(l => l.criterionId) },
    lines, observation, positiveVerificationIds: [...positive].sort() });
  bounded(result);
  return { result, resultDigest: digest(result), evidenceDeadline: deadlines.length ? Math.min(...deadlines) : null };
}
// Call only after read authorization; denial must never become UNKNOWN or leak
// a historical result through a freshness response.
function freshness({ result, currentIdentity, observation, referencesAvailable }) {
  if (!referencesAvailable) return 'UNAVAILABLE';
  for (const id of result.positiveVerificationIds) {
    if (observation.verifications.find(v => v.verificationId === id)?.status !== 'VERIFIED') return 'UNAVAILABLE';
  }
  if (canonicalize(result.identity) !== canonicalize(currentIdentity) || result.rules !== tuple.rules) return 'REVIEW_REQUIRED';
  const statuses = rows => rows.map(v => ({ verificationId: v.verificationId, status: v.status, revocation: v.revocation })).sort((a, b) => a.verificationId.localeCompare(b.verificationId));
  return canonicalize(statuses(result.observation.verifications)) === canonicalize(statuses(observation.verifications)) ? 'CURRENT' : 'REVIEW_REQUIRED';
}
module.exports = { evaluate, freshness, sameConcept };
