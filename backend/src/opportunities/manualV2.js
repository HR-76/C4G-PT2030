'use strict';
const { createHash } = require('node:crypto');
const { cloneData, deepFreeze, jsonbBytes } = require('./v2/data');
const { validateSnapshotV2, normalizers: n } = require('./v2');
const { canonical } = require('../async/envelope');

const MAPPING_VERSION = 'c4g-manual-editorial-v2.0';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATHS = Object.freeze([
  '/identity/references', '/description/title', '/description/summary', '/description/language', '/programmes', '/funds', '/parties',
  '/classification/callNature', '/classification/instruments', '/classification/specificObjectives', '/classification/themes', '/publication',
  '/schedule/plannedOpening', '/schedule/plannedClosing', '/schedule/planningPeriod', '/schedule/opening', '/schedule/deadlines', '/schedule/deadlineModel',
  '/status/published', '/status/publishedCode', '/financing/allocations', '/financing/support', '/financing/rates', '/financing/eligibleCosts',
  '/eligibility/beneficiaryTypes', '/eligibility/territories', '/eligibility/conditions', '/applicationModes',
  '/relatedProject/acronym', '/relatedProject/name', '/relatedProject/grantAgreementNumber', '/relatedProject/url',
  '/links/official', '/links/submission', '/links/documents'
]);
const DECIMALS = new Set(['amount', 'minimum', 'maximum', 'minimumPercent', 'maximumPercent']);
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
// Versioned semantic descriptor: no file/network IO belongs in the domain.
// Changing mapping or shared normalization semantics requires a version bump
// and the full contract gates; this is not a source-code integrity fingerprint.
const MAPPING_DESCRIPTOR = deepFreeze({
  mappingVersion: MAPPING_VERSION, contractVersion: 'opportunity-v2.0', normalizationVersion: 'opportunity-normalization-v2.0',
  qualityRuleVersion: 'opportunity-quality-v2.0', factPaths: PATHS, factStates: ['PRESENT', 'NOT_COLLECTED', 'NOT_APPLICABLE'],
  source: { namespace: 'C4G_MANUAL', transport: 'MANUAL', role: 'EDITORIAL', coverage: 'EDITORIAL' },
  rules: ['SERVER_EDITORIAL_ID_AND_CLOCK', 'CLOSED_FACT_PATHS', 'REQUIRED_PRESENT_TITLE', 'EDITORIAL_EVIDENCE_GENERATED',
    'NO_VERIFIED_CONCEPTS_OR_LINK_AVAILABILITY', 'MISSING_NOT_COLLECTED', 'NFC_TRIM_TEXT', 'EXACT_DECIMAL_DOT_STRINGS',
    'ISO_DATE_PRESERVED_INSTANT_UTC', 'CANONICAL_JSON_ARTIFACT_SHA256', 'UNVERIFIED_EDITORIAL_QUALITY']
});
const MAPPING_DIGEST = sha(canonical(MAPPING_DESCRIPTOR));
const escapePointer = key => key.replace(/~/g, '~0').replace(/\//g, '~1');
function fail(code = 'MANUAL_V2_INVALID_INPUT') { throw Object.assign(new TypeError(code), { code }); }
function exact(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }

function manualEditorialId(userId, requestId) {
  if (typeof userId !== 'string' || typeof requestId !== 'string' || !UUID.test(userId) || !UUID.test(requestId)) fail();
  return sha('C4G:MANUAL:EDITORIAL:v2\0' + userId.toLowerCase() + '\0' + requestId.toLowerCase());
}

// Input is an editorial declaration, never an already certified snapshot. Fact
// paths are closed and all evidence/provenance/quality comes from this adapter.
function adaptManualOpportunityV2(raw, context) {
  try {
    const input = cloneData(raw), options = cloneData(context, { maxBytes: 1024 });
    if (!exact(input, ['kind', 'fields']) || !['CALL', 'CASCADE_CALL'].includes(input.kind)
      || !input.fields || typeof input.fields !== 'object' || Array.isArray(input.fields)
      || Object.keys(input.fields).some(path => !PATHS.includes(path)) || !Object.hasOwn(input.fields, '/description/title')
      || !exact(options, ['editorialId', 'observedAt']) || !/^[a-f0-9]{64}$/.test(options.editorialId)
      || n.instant(options.observedAt) !== options.observedAt || jsonbBytes(input) > 262144) fail();
    const artifact = { mediaType: 'application/json', json: input, sha256: sha(canonical(input)) };
    const sourceKey = 'c4g-manual', observationId = 'manual-declaration', evidence = [];
    function evidenceAt(locator) {
      const id = 'manual-evidence-' + (evidence.length + 1);
      evidence.push({ id, observationId, locatorType: 'JSON_POINTER', locator, excerpt: null, transform: 'EDITORIAL_DECLARATION' });
      return id;
    }
    function value(item, locator, key = '') {
      if (DECIMALS.has(key) && item !== null) return n.decimal(item);
      if (typeof item === 'string') return item.normalize('NFC').trim();
      if (item === null || typeof item !== 'object') return item;
      if (Array.isArray(item)) return item.map((entry, index) => value(entry, locator + '/' + index));
      if (Object.hasOwn(item, 'state')) return fact(item, locator);
      if (Object.hasOwn(item, 'evidenceRefs') || Object.hasOwn(item, 'mapping') && item.mapping !== 'UNMAPPED'
        || Object.hasOwn(item, 'availability') && item.availability !== 'UNKNOWN') fail();
      const result = {};
      for (const [name, child] of Object.entries(item)) result[name] = value(child, locator + '/' + escapePointer(name), name);
      if (result.precision === 'INSTANT') result.value = n.instant(result.value);
      return result;
    }
    function fact(item, locator) {
      if (!exact(item, ['state', 'value', 'reason']) || !['PRESENT', 'NOT_COLLECTED', 'NOT_APPLICABLE'].includes(item.state)
        || item.state === 'PRESENT' && (item.value === null || item.reason !== null)
        || item.state !== 'PRESENT' && (item.value !== null || typeof item.reason !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(item.reason))) fail();
      const ref = evidenceAt(locator);
      return { state: item.state, value: value(item.value, locator + '/value'), evidenceRefs: [ref], reason: item.reason };
    }
    const snapshot = { schemaVersion: 2, contractVersion: 'opportunity-v2.0', identity: { kind: input.kind },
      sourceRecords: [{ key: sourceKey, namespace: 'C4G_MANUAL', externalId: 'EDITORIAL:' + options.editorialId, transport: 'MANUAL', role: 'EDITORIAL', url: null }] };
    for (const path of PATHS) {
      const parts = path.slice(1).split('/'); let owner = snapshot;
      for (const part of parts.slice(0, -1)) owner = owner[part] ||= {};
      owner[parts.at(-1)] = Object.hasOwn(input.fields, path) ? fact(input.fields[path], '/fields/' + escapePointer(path))
        : { state: 'NOT_COLLECTED', value: null, evidenceRefs: [], reason: 'MANUAL_NOT_PROVIDED' };
    }
    snapshot.quality = { ruleVersion: 'opportunity-quality-v2.0', issues: [{ code: 'MANUAL_EDITORIAL_UNVERIFIED', field: '/sourceRecords', evidenceRefs: [...snapshot.description.title.evidenceRefs] }] };
    snapshot.provenance = { mappingVersion: MAPPING_VERSION, observations: [{ id: observationId, sourceRecordKey: sourceKey,
      observedAt: options.observedAt, sourceModifiedAt: null, artifactSha256: artifact.sha256, document: null, coverage: 'EDITORIAL' }], evidence };
    return deepFreeze({ snapshot: validateSnapshotV2(snapshot), artifact });
  } catch { fail(); }
}

function createCentralManualAuthoringV2({ transactions, authority, archive, clock = () => new Date() } = {}) {
  for (const [port, method] of [[transactions, 'run'], [authority, 'assertAdministrator'], [archive, 'stage']]) {
    if (!port || typeof port[method] !== 'function') throw new TypeError('Manual v2 requires explicit central ports.');
  }
  if (typeof clock !== 'function') throw new TypeError('Manual v2 requires a clock.');
  return Object.freeze({ async create(raw) {
    let args;
    try {
      args = cloneData(raw);
      if (!exact(args, ['userId', 'input']) || typeof args.userId !== 'string' || !UUID.test(args.userId)
        || !exact(args.input, ['requestId', 'kind', 'fields']) || typeof args.input.requestId !== 'string' || !UUID.test(args.input.requestId)) fail();
      args.userId = args.userId.toLowerCase(); args.input.requestId = args.input.requestId.toLowerCase();
    } catch { fail(); }
    const { userId, input } = args, { requestId } = input;
    await transactions.run(client => authority.assertAdministrator(client, userId, { lock: false }));
    let observedAt;
    try { observedAt = Date.prototype.toISOString.call(clock()); } catch { fail('MANUAL_V2_CLOCK_INVALID'); }
    const editorialId = manualEditorialId(userId, requestId);
    const bundle = adaptManualOpportunityV2({ kind: input.kind, fields: input.fields }, { editorialId, observedAt });
    return transactions.run(async client => {
      await authority.assertAdministrator(client, userId, { lock: true });
      return deepFreeze(await archive.stage(client, { userId, requestId, editorialId, observedAt, ...bundle }));
    });
  } });
}

module.exports = { adaptManualOpportunityV2, createCentralManualAuthoringV2, manualEditorialId, MAPPING_VERSION, MAPPING_DIGEST, MAPPING_DESCRIPTOR, PATHS };
