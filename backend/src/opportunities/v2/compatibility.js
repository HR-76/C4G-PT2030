'use strict';

const { validateSnapshot: validateSnapshotV1 } = require('../contracts');
const { cloneData, deepFreeze } = require('./data');
const { OpportunityV2Error } = require('./errors');
const { validateSnapshotV2 } = require('./validation');

// This is a read model, not an upcast or a persistence command. A representation
// tag keeps legacy compound values distinguishable where conversion would lose
// information (for example, a textual rate or an unstructured budget period).
const LEGACY_FIELDS = Object.freeze([
  'funderName', 'openingDate', 'closingDate', 'fundingRange', 'enrichment',
  'sourceResolution', 'programmeName', 'callReference', 'thematicCodes',
  'territoryCodes', 'beneficiaryTypeCodes', 'eligibilitySummary',
]);

function absent(reason = 'NO_LEGACY_OBSERVATION') {
  return {
    state: 'NOT_COLLECTED', value: null, candidates: [], complete: false,
    representation: null, sourcePaths: [], reason,
  };
}

function present(value, sourcePaths, representation = 'v1-core') {
  return { state: 'PRESENT', value, candidates: [], complete: true, representation, sourcePaths, reason: null };
}

function v2Fact(field, path) {
  return {
    state: field.state, value: field.value, candidates: [],
    complete: ['PRESENT', 'NOT_FOUND', 'NOT_APPLICABLE'].includes(field.state),
    representation: 'v2', sourcePaths: [path], reason: field.reason,
  };
}

function emptyProjection() {
  return {
    description: { title: absent(), summary: absent(), language: absent() },
    programmes: absent(), funds: absent(), parties: absent(),
    classification: { callNature: absent(), instruments: absent(), specificObjectives: absent(), themes: absent() },
    publication: absent(),
    schedule: {
      plannedOpening: absent(), plannedClosing: absent(), planningPeriod: absent(),
      opening: absent(), deadlines: absent(), deadlineModel: absent(),
    },
    status: { published: absent(), publishedCode: absent() },
    financing: { allocations: absent(), support: absent(), rates: absent(), eligibleCosts: absent() },
    eligibility: { beneficiaryTypes: absent(), territories: absent(), conditions: absent() },
    applicationModes: absent(),
    relatedProject: { acronym: absent(), name: absent(), grantAgreementNumber: absent(), url: absent() },
    links: { official: absent(), submission: absent(), documents: absent() },
    legacy: Object.fromEntries(LEGACY_FIELDS.map(key => [key, absent()])),
  };
}

function projectV2(snapshot) {
  const projection = emptyProjection();
  for (const key of Object.keys(projection)) {
    if (key === 'legacy') continue;
    const block = snapshot[key];
    if (Object.hasOwn(block, 'state')) projection[key] = v2Fact(block, `/${key}`);
    else {
      for (const name of Object.keys(projection[key])) {
        projection[key][name] = v2Fact(block[name], `/${key}/${name}`);
      }
    }
  }
  return projection;
}

function enrichmentFact(enrichment, name, warnings) {
  if (!enrichment) return absent();
  const field = enrichment.fields[name];
  const path = `/sourceEnrichment/fields/${name}`;
  const state = field.status === 'PUBLISHED' ? 'PRESENT' : field.status;
  if (field.truncated) warnings.push({ code: 'LEGACY_TRUNCATED', path });
  if (state === 'CONFLICT' || state === 'UNSUPPORTED') warnings.push({ code: `LEGACY_${state}`, path });
  return {
    state,
    value: state === 'PRESENT' ? field.items.map(item => item.value) : null,
    candidates: ['CONFLICT', 'UNSUPPORTED'].includes(state) ? field.items : [],
    complete: !field.truncated && ['PRESENT', 'NOT_FOUND'].includes(state),
    representation: `v1-enrichment:${name}`,
    sourcePaths: [path],
    reason: field.truncated ? 'LEGACY_TRUNCATED' : state === 'PRESENT' ? null : `LEGACY_${state}`,
  };
}

function projectV1(snapshot, warnings) {
  const projection = emptyProjection();
  const fields = snapshot.sourceEnrichment;
  if(snapshot.opportunityType)projection.classification.callNature=present({label:snapshot.opportunityType},['/opportunityType'],'editorial');
  projection.description.title = present(snapshot.title, ['/title']);
  if (Object.hasOwn(snapshot, 'summary')) projection.description.summary = present(snapshot.summary, ['/summary']);
  if (Object.hasOwn(snapshot, 'officialUrl')) projection.links.official = present(snapshot.officialUrl, ['/officialUrl']);

  // Retain historical labels without asserting a party role or verified
  // programme taxonomy that the v1 core contract never expressed.
  for (const key of LEGACY_FIELDS) {
    if (!['enrichment', 'fundingRange'].includes(key) && Object.hasOwn(snapshot, key)) {
      projection.legacy[key] = present(snapshot[key], [`/${key}`]);
    }
  }
  warnings.push({ code: 'LEGACY_PARTY_ROLE_UNCLASSIFIED', path: '/funderName' });
  projection.parties = absent('LEGACY_PARTY_ROLE_UNCLASSIFIED');
  if (Object.hasOwn(snapshot, 'fundingAmountMin')) {
    projection.legacy.fundingRange = present({
      minimum: snapshot.fundingAmountMin, maximum: snapshot.fundingAmountMax, currency: snapshot.currencyCode,
    }, ['/fundingAmountMin', '/fundingAmountMax', '/currencyCode']);
    warnings.push({ code: 'LEGACY_FUNDING_SCOPE_UNCLASSIFIED', path: '/fundingAmountMin' });
  }

  projection.programmes = enrichmentFact(fields, 'programme', warnings);
  if (!fields && Object.hasOwn(snapshot, 'programmeName')) {
    projection.programmes = present([snapshot.programmeName], ['/programmeName']);
  }
  projection.financing.allocations = enrichmentFact(fields, 'budget', warnings);
  projection.financing.support = enrichmentFact(fields, 'support', warnings);
  projection.financing.rates = enrichmentFact(fields, 'rate', warnings);
  projection.classification.instruments = enrichmentFact(fields, 'instrument', warnings);
  projection.eligibility.beneficiaryTypes = enrichmentFact(fields, 'beneficiaries', warnings);
  projection.eligibility.territories = enrichmentFact(fields, 'territories', warnings);
  projection.eligibility.conditions = enrichmentFact(fields, 'conditions', warnings);
  projection.links.submission = enrichmentFact(fields, 'submission', warnings);
  projection.links.documents = enrichmentFact(fields, 'documents', warnings);
  if (fields) {
    projection.legacy.enrichment = present(fields, ['/sourceEnrichment'], 'v1-enrichment');
    projection.legacy.enrichment.complete = Object.values(fields.fields)
      .every(field => !field.truncated && ['PUBLISHED', 'NOT_FOUND'].includes(field.status));
    if (!projection.legacy.enrichment.complete) projection.legacy.enrichment.reason = 'LEGACY_ENRICHMENT_PARTIAL';
    // Consortium has no exact canonical application-mode equivalent. Its
    // original state, items and evidence remain in legacy.enrichment/snapshot.
    const consortium = fields.fields.consortium;
    if (consortium.truncated) warnings.push({ code: 'LEGACY_TRUNCATED', path: '/sourceEnrichment/fields/consortium' });
  }

  if (snapshot.sourceTemporal) {
    const temporal = snapshot.sourceTemporal;
    projection.status.published = present(temporal.status, ['/sourceTemporal/status'], 'v1-sourceTemporal');
    if (Object.hasOwn(temporal, 'statusCode')) {
      projection.status.publishedCode = present(temporal.statusCode, ['/sourceTemporal/statusCode'], 'v1-sourceTemporal');
    }
    if (temporal.openings.length) {
      // The v1 shape permits multiple openings. Keep them all, including their
      // original offsets/precision; never turn the first entry into a scalar.
      projection.schedule.opening = present(temporal.openings, ['/sourceTemporal/openings'], 'v1-sourceTemporal');
    }
    if (temporal.deadlines.length) {
      projection.schedule.deadlines = present(temporal.deadlines, ['/sourceTemporal/deadlines'], 'v1-sourceTemporal');
    }
  }
  // Old flat dates include imported forecasts. Their nature is unknown without
  // new source evidence, so neither confirmed nor planned fields are filled.
  for (const key of ['openingDate', 'closingDate']) {
    if (Object.hasOwn(snapshot, key)) warnings.push({ code: 'LEGACY_DATE_NATURE_UNCLASSIFIED', path: `/${key}` });
  }
  return projection;
}

function readOpportunitySnapshot(input) {
  // Inspect a safe plain-data clone before dispatch. The legacy validator calls
  // JSON.stringify and normalizers, which must never receive caller accessors.
  const snapshot = cloneData(input);
  if (!snapshot || Array.isArray(snapshot) || ![1, 2].includes(snapshot.schemaVersion)) {
    throw new OpportunityV2Error('OPPORTUNITY_VERSION_UNSUPPORTED', '/schemaVersion');
  }
  const warnings = [];
  if (snapshot.schemaVersion === 1) {
    // Validate without replacing the historical bytes/values with the existing
    // validator's normalized return value. Large v1 decimals remain strings.
    validateSnapshotV1(snapshot);
    return deepFreeze({ sourceVersion: 1, snapshot, projection: projectV1(snapshot, warnings), warnings });
  }
  validateSnapshotV2(snapshot);
  return deepFreeze({ sourceVersion: 2, snapshot, projection: projectV2(snapshot), warnings });
}

module.exports = { readOpportunitySnapshot };
