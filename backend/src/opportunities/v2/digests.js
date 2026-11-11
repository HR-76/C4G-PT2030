'use strict';

const { createHash } = require('node:crypto');
const { validateSnapshotV2 } = require('./validation');
const { deepFreeze } = require('./data');

const DOMAIN = 'C4G:OPPORTUNITY:CONTENT:v2\0';
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const isFact = value => value && typeof value === 'object' && !Array.isArray(value)
  && Object.hasOwn(value, 'state') && Object.hasOwn(value, 'value') && Object.hasOwn(value, 'evidenceRefs');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(compareText).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sortedSet(values) {
  return [...new Map(values.map(value => [canonical(value), value])).entries()]
    .sort(([left], [right]) => compareText(left, right)).map(([, value]) => value);
}

function sourceMeaning(source) {
  return { namespace: source.namespace, externalId: source.externalId, role: source.role, url: source.url };
}

function semanticProjection(snapshot) {
  const sources = new Map(snapshot.sourceRecords.map(source => [source.key, sourceMeaning(source)]));
  const observations = new Map(snapshot.provenance.observations.map(observation => [observation.id, observation]));
  const evidence = new Map(snapshot.provenance.evidence.map(item => [item.id, item]));
  const concepts = new Map();
  function collectConcepts(value) {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && Object.hasOwn(value, 'scheme') && Object.hasOwn(value, 'key')) concepts.set(value.key, value);
    for (const item of Object.values(value)) collectConcepts(item);
  }
  collectConcepts(snapshot);

  function evidenceMeaning(id, opaque) {
    const item = evidence.get(id), observation = observations.get(item.observationId);
    const result = { source: sources.get(observation.sourceRecordKey), transform: item.transform };
    if (opaque) {
      // A null CONFLICT/UNSUPPORTED value cannot describe its candidates. Keep the
      // exact referenced evidence identity: a changed raw candidate must be reviewed,
      // even if its new bytes only turn out to contain an irrelevant source change.
      result.locatorType = item.locatorType;
      result.locator = item.locator;
      result.excerpt = item.excerpt;
      result.artifactSha256 = observation.artifactSha256;
      if (observation.document) result.document = observation.document;
    }
    return result;
  }

  function project(value, path = '') {
    if (Array.isArray(value)) {
      const projected = value.map(item => project(item, path));
      // Phase order can encode a published sequence. Unphased cutoffs are a set.
      if (path === '/schedule/deadlines/value' && value.some(item => item.phase !== null)) return projected;
      // Allocation keys are local identifiers, but separate financial rows are a
      // multiset: equal amounts and qualifiers never authorize collapsing rows.
      if (path === '/financing/allocations/value') return projected.sort((a, b) => compareText(canonical(a), canonical(b)));
      return sortedSet(projected);
    }
    if (!value || typeof value !== 'object') return value;
    if (isFact(value)) {
      return {
        state: value.state,
        value: project(value.value, `${path}/value`),
        reason: value.reason,
        evidence: sortedSet(value.evidenceRefs.map(id => evidenceMeaning(id, value.state === 'CONFLICT' || value.state === 'UNSUPPORTED'))),
      };
    }
    const result = {};
    for (const key of Object.keys(value)) {
      if (key === 'key' || key === 'originalTimezone') continue;
      if (key === 'programmeRefs' || key === 'fundRefs') result[key] = sortedSet(value[key].map(id => project(concepts.get(id))));
      else result[key] = project(value[key], `${path}/${key}`);
    }
    return result;
  }

  const result = {};
  for (const key of Object.keys(snapshot)) {
    if (key === 'provenance') result.provenance = { mappingVersion: snapshot.provenance.mappingVersion };
    else if (key === 'sourceRecords') result.sourceRecords = sortedSet([...sources.values()]);
    // Issues are diagnostics derived from the same facts, not independent facts.
    else if (key === 'quality') result.quality = { ruleVersion: snapshot.quality.ruleVersion };
    else result[key] = project(snapshot[key], `/${key}`);
  }
  return result;
}

function semanticSnapshotV2(input) { return deepFreeze(semanticProjection(validateSnapshotV2(input))); }
function hashProjection(projection) { return createHash('sha256').update(DOMAIN).update(canonical(projection)).digest('hex'); }
function contentDigestV2(input) { return hashProjection(semanticProjection(validateSnapshotV2(input))); }

function functionalIdentities(snapshot) {
  return snapshot.sourceRecords.filter(source => source.role !== 'PROGRAMME_METADATA')
    .map(source => `${source.namespace}\u0000${source.externalId}`).sort(compareText);
}

function changedFactPaths(previous, incoming, path = '', output = []) {
  const semanticFact = value => value && typeof value === 'object' && Object.hasOwn(value, 'state')
    && Object.hasOwn(value, 'value') && Object.hasOwn(value, 'evidence');
  if (semanticFact(previous) || semanticFact(incoming)) {
    if (canonical(previous) !== canonical(incoming)) output.push(path);
    return output;
  }
  if (canonical(previous) === canonical(incoming)) return output;
  if (!previous || !incoming || typeof previous !== 'object' || typeof incoming !== 'object'
    || Array.isArray(previous) || Array.isArray(incoming)) {
    output.push(path);
    return output;
  }
  for (const key of new Set([...Object.keys(previous), ...Object.keys(incoming)])) {
    changedFactPaths(previous[key], incoming[key], `${path}/${key}`, output);
  }
  return output;
}

function classifyUnsafeFacts(previous, incoming, path, retained, conflicts, reasons) {
  if (isFact(incoming) && incoming.state === 'CONFLICT') conflicts.add(path);
  if (isFact(previous) && previous.state === 'PRESENT' && isFact(incoming) && incoming.state !== 'PRESENT') {
    retained.add(path);
    reasons.add('ACCEPTED_FACT_WOULD_BE_LOST');
    return;
  }
  if (isFact(previous) && isFact(incoming)) {
    classifyUnsafeFacts(previous.value, incoming.value, `${path}/value`, retained, conflicts, reasons);
    return;
  }
  if (!previous || !incoming || typeof previous !== 'object' || typeof incoming !== 'object') return;
  if (Array.isArray(previous) && Array.isArray(incoming)) {
    if (incoming.length < previous.length) reasons.add('COLLECTION_ITEMS_REMOVED');
    previous.forEach((item, index) => {
      const keyed = item && typeof item === 'object' && item.key;
      const match = keyed
        ? incoming.find(candidate => candidate && candidate.key === item.key) : incoming[index];
      if (match) classifyUnsafeFacts(item, match, `${path}/${index}`, retained, conflicts, reasons);
      else if (keyed) reasons.add('COLLECTION_IDENTITY_UNCERTAIN');
    });
    return;
  }
  for (const key of Object.keys(previous)) {
    if (!path && ['provenance', 'quality', 'sourceRecords'].includes(key)) continue;
    classifyUnsafeFacts(previous[key], incoming[key], `${path}/${key}`, retained, conflicts, reasons);
  }
}

function collectConflicts(value, path, output) {
  if (!value || typeof value !== 'object') return;
  if (isFact(value) && value.state === 'CONFLICT') output.add(path);
  for (const [key, item] of Object.entries(value)) collectConflicts(item, `${path}/${key}`, output);
}

// This is a proposal, not a write or a merge. Source-version precedence and editorial
// resolution belong to the ingestion/revision workflow; a newer fetch is not authority.
function compareSnapshotsV2(previousInput, incomingInput) {
  const previous = validateSnapshotV2(previousInput), incoming = validateSnapshotV2(incomingInput);
  const previousSemantic = semanticProjection(previous), incomingSemantic = semanticProjection(incoming);
  const previousDigest = hashProjection(previousSemantic), incomingDigest = hashProjection(incomingSemantic);
  const sameIdentity = canonical(functionalIdentities(previous)) === canonical(functionalIdentities(incoming));
  const changed = previousDigest !== incomingDigest;
  const reasons = new Set(), retained = new Set(), conflicts = new Set();
  if (!sameIdentity) reasons.add('SOURCE_IDENTITY_CHANGED');
  if (changed) {
    classifyUnsafeFacts(previous, incoming, '', retained, conflicts, reasons);
    collectConflicts(incoming, '', conflicts);
  }
  if (conflicts.size) reasons.add('UNRESOLVED_CONFLICT');
  const reviewRequired = reasons.size > 0;
  return deepFreeze({
    sameIdentity,
    changed,
    action: !changed && sameIdentity ? 'UNCHANGED' : reviewRequired ? 'REVIEW_REQUIRED' : 'CANDIDATE_REVISION',
    canReplaceAccepted: false,
    previousDigest,
    incomingDigest,
    changedFields: changed ? changedFactPaths(previousSemantic, incomingSemantic).sort(compareText) : [],
    retainedFields: [...retained].sort(compareText),
    conflictFields: [...conflicts].sort(compareText),
    reasonCodes: [...reasons].sort(compareText),
    acceptedSnapshot: previous,
    candidateSnapshot: incoming,
  });
}

module.exports = { semanticSnapshotV2, contentDigestV2, compareSnapshotsV2 };
