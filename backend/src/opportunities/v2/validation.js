'use strict';
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const schema = require('./opportunity-v2.schema.json');
const { cloneData, deepFreeze, jsonbBytes, MAX_SNAPSHOT_BYTES } = require('./data');
const { fail } = require('./errors');
const { text, compareDecimal, civilDate, instant, conceptKey, safeUrl } = require('./normalization');

// S0 expresses refinements in allOf/then; their types are defined in the parent.
// Disable only that strict schema-lint warning, never input validation/coercion.
const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv, { mode: 'full', formats: ['date', 'date-time', 'uri'] });
const matchesSchema = ajv.compile(schema);
const values = fact => fact.state === 'PRESENT' ? fact.value : [];
const error = (code, path) => fail('OPPORTUNITY_V2_' + code, path);

function uniqueMap(items, key, path) {
  const map = new Map();
  for (const item of items) {
    const id = key(item);
    if (map.has(id)) error('DUPLICATE_KEY', path);
    map.set(id, item);
  }
  return map;
}

function resolvePointer(object, pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/') || /~(?![01])/.test(pointer)) return false;
  let current = object;
  for (const part of pointer.slice(1).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) return false;
    current = current[key];
  }
  return true;
}

function validateReferences(snapshot) {
  const sources = uniqueMap(snapshot.sourceRecords, record => record.key, '/sourceRecords');
  uniqueMap(snapshot.sourceRecords, record => record.namespace + '\0' + record.externalId, '/sourceRecords');
  const observations = uniqueMap(snapshot.provenance.observations, item => item.id, '/provenance/observations');
  const evidence = uniqueMap(snapshot.provenance.evidence, item => item.id, '/provenance/evidence');
  for (const observation of observations.values()) {
    if (!sources.has(observation.sourceRecordKey)) error('REFERENCE_INVALID', '/provenance/observations');
    if (instant(observation.observedAt) !== observation.observedAt || observation.sourceModifiedAt !== null && instant(observation.sourceModifiedAt) !== observation.sourceModifiedAt) error('TEMPORAL_INVALID', '/provenance/observations');
    if (observation.coverage === 'SOURCE_FILE' && observation.document && observation.document.sha256 !== observation.artifactSha256) error('REFERENCE_INVALID', '/provenance/observations');
  }
  for (const item of evidence.values()) {
    if (!observations.has(item.observationId)) error('REFERENCE_INVALID', '/provenance/evidence');
    if (item.locatorType === 'JSON_POINTER' && (!item.locator.startsWith('/') || /~(?![01])/.test(item.locator))) error('REFERENCE_INVALID', '/provenance/evidence');
  }
  function walk(value, path) {
    if (!value || typeof value !== 'object') return;
    if (Object.hasOwn(value, 'evidenceRefs') && value.evidenceRefs.some(ref => !evidence.has(ref))) error('REFERENCE_INVALID', path);
    for (const [key, child] of Object.entries(value)) walk(child, path + '/' + key);
  }
  walk(snapshot, '');
  for (const issue of snapshot.quality.issues) if (!resolvePointer(snapshot, issue.field)) error('REFERENCE_INVALID', '/quality/issues');
  return { sources, observations, evidence };
}

function validateConcepts(snapshot) {
  const groups = [values(snapshot.programmes), values(snapshot.funds), values(snapshot.classification.instruments),
    values(snapshot.classification.specificObjectives), values(snapshot.classification.themes),
    values(snapshot.eligibility.beneficiaryTypes), values(snapshot.applicationModes),
    values(snapshot.eligibility.territories).map(item => item.concept),
    snapshot.classification.callNature.state === 'PRESENT' ? [snapshot.classification.callNature.value] : []];
  const concepts = new Map(), codes = new Map();
  for (const group of groups) {
    uniqueMap(group, concept => concept.key, '/concepts');
    for (const concept of group) {
      const previous = concepts.get(concept.key);
      if (previous && ['sourceId', 'code', 'label', 'scheme', 'schemeVersion', 'mapping'].some(key => previous[key] !== concept[key])) error('DUPLICATE_KEY', '/concepts');
      concepts.set(concept.key, concept);
      if (text(concept.label, { maxLength: 300 }) !== concept.label) error('INVALID_INPUT', '/concepts');
      if (concept.mapping === 'VERIFIED' && concept.schemeVersion === null) error('REFERENCE_INVALID', '/concepts');
      if (concept.sourceId === null && concept.code === null && concept.key !== conceptKey(concept.scheme, concept.label)) error('REFERENCE_INVALID', '/concepts');
      if (concept.code !== null) {
        const code = concept.scheme + '\0' + concept.code, existing = codes.get(code);
        if (existing && existing.key !== concept.key) error('DUPLICATE_KEY', '/concepts');
        codes.set(code, concept);
      }
    }
  }
}

function validateMoney(snapshot) {
  const programmes = new Set(values(snapshot.programmes).map(item => item.key));
  const funds = new Set(values(snapshot.funds).map(item => item.key));
  const allocations = values(snapshot.financing.allocations);
  uniqueMap(allocations, item => item.key, '/financing/allocations');
  for (const item of allocations) {
    if (item.programmeRefs.some(ref => !programmes.has(ref)) || item.fundRefs.some(ref => !funds.has(ref))) error('REFERENCE_INVALID', '/financing/allocations');
    if ((item.money.amount === '0') !== ['ZERO_UNEXPLAINED', 'EXPLICIT_ZERO'].includes(item.money.interpretation)) error('MONEY_INVALID', '/financing/allocations');
  }
  function bounds(minimum, maximum, path, rate = false) {
    if (minimum === null && maximum === null || minimum !== null && maximum !== null && compareDecimal(minimum, maximum) > 0) error('MONEY_INVALID', path);
    if (rate && [minimum, maximum].some(value => value !== null && compareDecimal(value, '100') > 0)) error('MONEY_INVALID', path);
  }
  for (const item of values(snapshot.financing.support)) bounds(item.minimum, item.maximum, '/financing/support');
  for (const item of values(snapshot.financing.eligibleCosts)) bounds(item.minimum, item.maximum, '/financing/eligibleCosts');
  for (const item of values(snapshot.financing.rates)) bounds(item.minimumPercent, item.maximumPercent, '/financing/rates', true);
}

// Bounds are comparison aids only: no fabricated time is persisted for DATE.
function temporalBounds(value) {
  if (value.precision === 'INSTANT') {
    if (instant(value.value) !== value.value) error('TEMPORAL_INVALID', '/schedule');
    return [value.value, value.value];
  }
  const start = value.precision === 'DATE' ? value.value : value.start;
  const end = value.precision === 'DATE' ? value.value : value.end;
  civilDate(start); civilDate(end);
  if (start > end) error('TEMPORAL_INVALID', '/schedule');
  return [start + 'T00:00:00.000Z', end + 'T23:59:59.999Z'];
}

function validateSchedule(snapshot, provenance) {
  const schedule = snapshot.schedule;
  for (const key of ['plannedOpening', 'plannedClosing', 'opening']) if (schedule[key].state === 'PRESENT') temporalBounds(schedule[key].value);
  if (schedule.planningPeriod.state === 'PRESENT') {
    const { start, end } = schedule.planningPeriod.value;
    if (start !== null) civilDate(start);
    if (end !== null) civilDate(end);
    if (start !== null && end !== null && start > end) error('TEMPORAL_INVALID', '/schedule/planningPeriod');
  }
  if (schedule.plannedOpening.state === 'PRESENT' && schedule.plannedClosing.state === 'PRESENT' && temporalBounds(schedule.plannedOpening.value)[0] > temporalBounds(schedule.plannedClosing.value)[1]) error('TEMPORAL_INVALID', '/schedule');
  const deadlines = values(schedule.deadlines);
  uniqueMap(deadlines, item => JSON.stringify([item.at.precision, item.at.value || item.at.start, item.at.end || null, item.phase]), '/schedule/deadlines');
  for (const deadline of deadlines) {
    const bounds = temporalBounds(deadline.at);
    if (schedule.opening.state === 'PRESENT' && temporalBounds(schedule.opening.value)[0] > bounds[1]) error('TEMPORAL_INVALID', '/schedule');
  }
  if (schedule.deadlineModel.value === 'SINGLE' && deadlines.length > 1) error('TEMPORAL_INVALID', '/schedule/deadlineModel');
  if (snapshot.publication.value === 'PLANNED') {
    for (const key of ['opening', 'deadlines', 'deadlineModel']) {
      const fact = schedule[key];
      if (fact.state !== 'PRESENT') continue;
      const hasAdditionalEvidence = fact.evidenceRefs.some(ref => {
        const observation = provenance.observations.get(provenance.evidence.get(ref).observationId);
        return ['CALL', 'EDITORIAL'].includes(provenance.sources.get(observation.sourceRecordKey).role);
      });
      if (!hasAdditionalEvidence) error('TEMPORAL_INVALID', '/schedule/' + key);
    }
  }
}

function validateIdentityAndUrls(snapshot) {
  const references = values(snapshot.identity.references);
  uniqueMap(references, item => item.kind + '\0' + item.value, '/identity/references');
  for (const source of snapshot.sourceRecords) {
    if (text(source.externalId, { maxLength: 256 }) !== source.externalId) error('IDENTITY_INVALID', '/sourceRecords');
    if (source.url !== null) safeUrl(source.url);
    if (source.namespace === 'EU_FUNDING_TENDERS' && source.role === 'CALL') {
      const cascade = /^CASCADE:([0-9]+)$/.exec(source.externalId);
      if ((snapshot.identity.kind === 'CASCADE_CALL') !== Boolean(cascade)) error('IDENTITY_INVALID', '/sourceRecords');
      if (cascade) {
        const url = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/competitive-calls-cs/' + cascade[1];
        if (!references.some(item => item.kind === 'SOURCE_CALL_ID' && item.value === cascade[1]) || source.url !== url || snapshot.links.official.state === 'PRESENT' && snapshot.links.official.value !== url) error('IDENTITY_INVALID', '/sourceRecords');
      }
    }
    if (source.namespace === 'PORTUGAL2030_PLAN' && (snapshot.identity.kind !== 'CALL' || source.role !== 'PLAN' || !references.some(item => item.kind === 'PLAN_ID' && item.value === source.externalId))) error('IDENTITY_INVALID', '/sourceRecords');
  }
  for (const fact of [snapshot.links.official, snapshot.relatedProject.url]) if (fact.state === 'PRESENT') safeUrl(fact.value);
  for (const fact of [snapshot.links.submission, snapshot.links.documents]) for (const item of values(fact)) safeUrl(item.url);
}

function validateNormalizedText(snapshot) {
  function visit(value, path) {
    if (typeof value === 'string') {
      if (value !== value.normalize('NFC').trim()) error('INVALID_INPUT', path);
      return;
    }
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) visit(child, path + '/' + key);
  }
  // Locators/excerpts/document names are original evidence, not normalized facts.
  for (const [key, value] of Object.entries(snapshot)) if (key !== 'provenance') visit(value, '/' + key);
}

function validateSnapshotV2(input) {
  const snapshot = cloneData(input);
  if (jsonbBytes(snapshot) > MAX_SNAPSHOT_BYTES) error('LIMIT_EXCEEDED');
  if (!matchesSchema(snapshot)) error('SCHEMA_INVALID', matchesSchema.errors[0].instancePath);
  if (text(snapshot.description.title.value, { maxLength: 300 }) !== snapshot.description.title.value) error('INVALID_INPUT', '/description/title');
  validateNormalizedText(snapshot);
  const provenance = validateReferences(snapshot);
  validateConcepts(snapshot);
  validateMoney(snapshot);
  validateSchedule(snapshot, provenance);
  validateIdentityAndUrls(snapshot);
  return deepFreeze(snapshot);
}

module.exports = { validateSnapshotV2 };
