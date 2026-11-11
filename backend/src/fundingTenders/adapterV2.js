'use strict';

const { createHash } = require('node:crypto');
const { verifyEvidence, sourceDeadlines, sourceOpenings } = require('./sourceEvidence');
const { CASCADE_BASE } = require('./identity');
const { programmeFor, VERSION: TAXONOMY_VERSION } = require('./programmeTaxonomy');
const { sourceDescription } = require('./sourceDescription');
const { cloneData } = require('../opportunities/v2/data');
const { validateSnapshotV2, contentDigestV2, normalizers: n } = require('../opportunities/v2');

const TOPIC_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';
const STATUS = Object.freeze({ '31094501': 'UPCOMING', '31094502': 'OPEN', '31094503': 'CLOSED', OPEN: 'OPEN', UPCOMING: 'UPCOMING', CLOSED: 'CLOSED', CANCELLED: 'CANCELLED' });
const sha = value => createHash('sha256').update(value).digest('hex');
const present = (value, evidenceRefs) => ({ state: 'PRESENT', value, evidenceRefs, reason: null });
const absent = (reason = 'NOT_REQUESTED_IN_MAPPING', evidenceRefs = [], state = 'NOT_COLLECTED') => ({ state, value: null, evidenceRefs, reason });
function invalid(code = 'SOURCE_V2_INVALID') { throw Object.assign(new Error('EU canonical source record is invalid.'), { code }); }
function values(metadata, key) {
  if (metadata[key] === undefined) return [];
  if (!Array.isArray(metadata[key]) || metadata[key].some(value => typeof value !== 'string')) invalid();
  return metadata[key];
}
function scalar(metadata, key, required = false) {
  const list = [...new Set(values(metadata, key))];
  if (list.length > 1) invalid('SOURCE_V2_CONFLICT');
  if (!list.length || !list[0].trim()) { if (required) invalid(); return null; }
  return list[0];
}
function plain(html) { return sourceDescription(html, html.length + 1) || ''; }
// The search index cuts long `content` values; a cut copy of the same call title
// is not a divergence. Short titles must still match exactly.
function sameTitle(left, right) {
  if (left === right) return true;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  return [...short].length >= 300 && long.startsWith(short);
}
function publishedCommissionUrl(value) {
  let parsed; try { parsed = new URL(value); } catch { invalid(); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.href !== value
    || !['ec.europa.eu', 'webgate.ec.europa.eu'].includes(parsed.hostname)) invalid();
  return value;
}
function directAwarders(narrative) {
  const names = [];
  // The parenthesised alias and following sentence stop form the delimiter.
  // A company suffix may contain dots; an arbitrary first dot never ends a name.
  // Clauses without this delimiter stay uncollected instead of guessing.
  for (const match of narrative.matchAll(/This call is launched solely by\s+([^()\n]{1,300}?)\s+\([^()\n]{1,128}\)\s*\.(?=\s|$)/gi)) {
    const name = n.text(match[1], { maxLength: 300 }), tokens = name.split(/\s+/), suffix = tokens.pop();
    if (/[.;:!?]/.test(tokens.join(' ')) || /[;:!?]/.test(suffix)) continue;
    if (suffix.includes('.') && !/^(?:(?:[a-z]\.){2,}|(?:Ltd|Inc|Corp|Co)\.)$/i.test(suffix)) continue;
    names.push(name);
  }
  return [...new Set(names)];
}
function temporal(raw) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { precision: 'DATE', value: n.civilDate(raw) };
  const suffix = /(Z|[+-]\d{2}:?\d{2})$/.exec(raw);
  if (!suffix) invalid();
  const offset = suffix[1] === 'Z' ? '+00:00' : suffix[1].includes(':') ? suffix[1] : suffix[1].slice(0, 3) + ':' + suffix[1].slice(3);
  return { precision: 'INSTANT', value: n.instant(raw), originalTimezone: offset };
}
function skeleton() {
  return {
    schemaVersion: 2, contractVersion: 'opportunity-v2.0', identity: { kind: 'CALL', references: absent() }, sourceRecords: [],
    description: { title: absent(), summary: absent(), language: absent() }, programmes: absent(), funds: absent(), parties: absent(),
    classification: { callNature: absent(), instruments: absent(), specificObjectives: absent(), themes: absent() }, publication: absent(),
    schedule: { plannedOpening: absent(), plannedClosing: absent(), planningPeriod: absent(), opening: absent(), deadlines: absent(), deadlineModel: absent() },
    status: { published: absent(), publishedCode: absent() }, financing: { allocations: absent(), support: absent(), rates: absent(), eligibleCosts: absent() },
    eligibility: { beneficiaryTypes: absent(), territories: absent(), conditions: absent() }, applicationModes: absent(),
    relatedProject: { acronym: absent(), name: absent(), grantAgreementNumber: absent(), url: absent() },
    links: { official: absent(), submission: absent(), documents: absent() },
    quality: { ruleVersion: 'opportunity-quality-v2.0', issues: [] }, provenance: { mappingVersion: '', observations: [], evidence: [] }
  };
}

// The response is archived as the exact evidence JSON. Locators below point into
// that artefact, not into a fabricated reconstruction of the portal response.
function mapVariant(evidence, index, observedAt, artifactSha256) {
  const raw = evidence.variants[index], m = raw.metadata;
  const type = scalar(m, 'type', true), topic = n.text(scalar(m, 'identifier', true), { maxLength: 128 });
  if (!['1', '2', '8'].includes(type)) invalid();
  const call = scalar(m, 'callccm2Id', type !== '2'), identifier = evidence.externalIdentifier;
  // External action calls (2) live outside the portal topic pages: keep the
  // published Commission link instead of fabricating a topic URL.
  const url = type === '8' ? CASCADE_BASE + call : type === '2' ? publishedCommissionUrl(scalar(m, 'url', true)) : TOPIC_BASE + encodeURIComponent(topic);
  const sourceKeyText = 'EU_FUNDING_TENDERS:' + identifier;
  // The schema's key alphabet excludes "/" (EuropeAid/... identifiers): hash those too.
  const sourceKey = sourceKeyText.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(sourceKeyText) ? sourceKeyText : 'EU_FUNDING_TENDERS:' + sha(identifier);
  const observationId = 'observation-' + index;
  const out = skeleton(), base = '/variants/' + index;
  const ids = new Set();
  function e(name, locator, transform = 'IDENTITY', excerpt = null) {
    if (ids.has(name)) invalid();
    if (ids.size >= 512) invalid('SOURCE_V2_LIMIT_EXCEEDED');
    ids.add(name);
    out.provenance.evidence.push({ id: name, observationId, locatorType: 'JSON_POINTER', locator: base + locator, excerpt, transform });
    return name;
  }
  function issue(code, field, refs) { out.quality.issues.push({ code, field, evidenceRefs: refs }); }
  const record = e('record', '/metadata');
  const nf = reason => absent(reason, [record], 'NOT_FOUND');
  out.identity.kind = type === '8' ? 'CASCADE_CALL' : 'CALL';
  const references = [{ kind: type === '2' ? 'CALL_REFERENCE' : 'TOPIC_REFERENCE', value: topic }];
  const referenceEvidence = [e('topic-id', '/metadata/identifier/0')];
  if (type === '8') {
    references.unshift({ kind: 'SOURCE_CALL_ID', value: call });
    referenceEvidence.unshift(e('call-id', '/metadata/callccm2Id/0'));
  }
  out.identity.references = present(references, referenceEvidence);
  out.sourceRecords = [{ key: sourceKey, namespace: 'EU_FUNDING_TENDERS', externalId: identifier, transport: 'API', role: 'CALL', url }];
  out.provenance.mappingVersion = `eu-funding-type${type}-v2.1`;
  out.provenance.observations = [{ id: observationId, sourceRecordKey: sourceKey, observedAt, sourceModifiedAt: null, artifactSha256, document: null, coverage: 'FULL_RECORD' }];

  const callTitle = type === '8' ? scalar(m, 'callTitle') : null;
  const hasContent = typeof raw.content === 'string' && raw.content.trim();
  if (type === '8' && !hasContent && !callTitle) invalid();
  // Titles are compared in full; only the stored value is bounded to 300.
  const fullTitle = value => n.text(plain(value), { maxLength: 4000 });
  if (type === '8' && hasContent && callTitle && !sameTitle(fullTitle(raw.content), fullTitle(callTitle))) invalid('SOURCE_V2_CONFLICT');
  const titlePath = hasContent ? '/content' : type === '8' ? '/metadata/callTitle/0' : '/metadata/title/0';
  const title = titlePath === '/content' ? raw.content : scalar(m, type === '8' && titlePath.includes('callTitle') ? 'callTitle' : 'title', true);
  // Some publishers put a paragraph in the title. Keep the first 299 characters
  // with an ellipsis and flag it, rather than rejecting a current call.
  const publishedTitle = fullTitle(title), titleChars = [...publishedTitle], titleExcerpt = titleChars.length > 300;
  const titleRef = e('call-title', titlePath, titleExcerpt ? 'TEXT_NFC_TRIM_EXCERPT' : 'TEXT_NFC_TRIM');
  out.description.title = present(titleExcerpt ? titleChars.slice(0, 299).join('').trimEnd() + '…' : publishedTitle, [titleRef]);
  if (titleExcerpt) issue('TITLE_EXCERPT', '/description/title', [titleRef]);
  const titleText = publishedTitle;
  // The search API's summary repeats the title. The published narrative lives in
  // descriptionByte (topics) or description (cascade calls); a distinct published
  // summary still wins, and ambiguous or empty narratives are never used.
  const published = typeof raw.summary === 'string' && raw.summary.trim() ? n.text(plain(raw.summary), { maxLength: 4000 }) : null;
  const narrativeKey = type === '8' ? 'description' : 'descriptionByte';
  const narratives = [...new Set(values(m, narrativeKey))];
  const narrative = narratives.length === 1 ? plain(narratives[0]).toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').normalize('NFC').trim() : '';
  if (narrative && (!published || published === titleText)) {
    const chars = [...narrative], excerpt = chars.length > 4000;
    const ref = e('summary', '/metadata/' + narrativeKey + '/0', excerpt ? 'HTML_TO_TEXT_NFC_TRIM_EXCERPT' : 'HTML_TO_TEXT_NFC_TRIM');
    out.description.summary = present(excerpt ? chars.slice(0, 3999).join('').trimEnd() + '…' : narrative, [ref]);
    if (excerpt) issue('DESCRIPTION_EXCERPT', '/description/summary', [ref]);
  } else out.description.summary = published ? present(published, [e('summary', '/summary', 'TEXT_NFC_TRIM')]) : nf('SUMMARY_NOT_DECLARED');
  const language = typeof raw.language === 'string' ? raw.language : scalar(m, 'language', true);
  out.description.language = present(n.text(language, { maxLength: 35 }), [e('language', typeof raw.language === 'string' ? '/language' : '/metadata/language/0')]);

  const programmeIds = [...new Set(values(m, 'frameworkProgramme').map(value => n.text(value, { maxLength: 128 })))];
  if (programmeIds.length > 64) invalid('SOURCE_V2_LIMIT_EXCEEDED');
  const programmes = programmeIds.map(id => {
    const entry = programmeFor(id), label = entry?.label || id;
    return { key: n.conceptKey('EU_FRAMEWORK_PROGRAMME', label), sourceId: id, code: entry?.code || null, label, scheme: 'EU_FRAMEWORK_PROGRAMME', schemeVersion: entry ? TAXONOMY_VERSION : null, mapping: entry ? 'VERIFIED' : 'UNMAPPED' };
  });
  out.programmes = programmes.length ? present(programmes, [e('programme', '/metadata/frameworkProgramme', 'EU_PROGRAMME_TAXONOMY_20261111')]) : nf('PROGRAMME_NOT_DECLARED');
  if (programmes.some(value => value.mapping === 'UNMAPPED')) issue('PROGRAMME_TAXONOMY_UNMAPPED', '/programmes', out.programmes.evidenceRefs);
  out.funds = nf('FUNDS_NOT_DECLARED');
  out.publication = present('PUBLISHED', [e('source-type', '/metadata/type/0', `EU_TYPE${type}_PUBLIC_CALL`)]);

  const openings = [...new Set(sourceOpenings(m))];
  if (openings.length > 1) invalid('SOURCE_V2_CONFLICT');
  out.schedule.opening = openings.length ? present(temporal(openings[0]), [e('opening', '/metadata/startDate', openings[0].length === 10 ? 'CONFIRMED_CIVIL_DATE' : 'OFFSET_TO_UTC')]) : nf('OPENING_NOT_DECLARED');
  const sourceDates = [...new Set(sourceDeadlines(m))];
  if (sourceDates.length > 64) invalid('SOURCE_V2_LIMIT_EXCEEDED');
  const deadlines = [...new Map(sourceDates.map(value => { const at = temporal(value); return [at.precision + ':' + at.value, { at, phase: null }]; })).values()].sort((a, b) => a.at.value < b.at.value ? -1 : a.at.value > b.at.value ? 1 : 0);
  out.schedule.deadlines = deadlines.length ? present(deadlines, [e('deadlines', '/metadata/deadlineDate', deadlines.every(value => value.at.precision === 'INSTANT') ? 'OFFSET_TO_UTC_SORT_UNIQUE' : 'CONFIRMED_CALENDAR_SORT_UNIQUE')]) : nf('DEADLINES_NOT_DECLARED');
  const model = scalar(m, 'deadlineModel');
  const models = { 'single-stage': 'SINGLE', 'single stage': 'SINGLE', single: 'SINGLE', 'multiple cut-off': 'MULTIPLE_CUTOFF', continuous: 'CONTINUOUS' };
  out.schedule.deadlineModel = model ? present(models[model.toLowerCase()] || 'OTHER', [e('deadline-model', '/metadata/deadlineModel/0', 'EU_DEADLINE_MODEL')]) : nf('DEADLINE_MODEL_NOT_DECLARED');
  const status = scalar(m, 'status');
  if (status) {
    const ref = e('status', '/metadata/status/0', 'EU_STATUS_CODE');
    out.status.published = present(STATUS[status] || 'UNKNOWN', [ref]);
    out.status.publishedCode = present(n.text(status, { maxLength: 64 }), [ref]);
  } else { out.status.published = nf('STATUS_NOT_DECLARED'); out.status.publishedCode = nf('STATUS_NOT_DECLARED'); }

  for (const [key, field, limit] of [['acronym', 'projectAcronym', 128], ['name', 'projectName', 300], ['grantAgreementNumber', 'projectId', 128]]) {
    const value = scalar(m, field);
    out.relatedProject[key] = value ? present(n.text(value, { maxLength: limit }), [e(field, '/metadata/' + field + '/0', field === 'projectId' ? 'IDENTIFIER_AS_TEXT' : 'TEXT_NFC_TRIM')]) : nf('PROJECT_FIELD_NOT_DECLARED');
  }
  out.relatedProject.url = nf('PROJECT_URL_NOT_DECLARED');
  out.links.official = present(url, [e('official-url', type === '8' ? '/metadata/callccm2Id/0' : type === '2' ? '/metadata/url/0' : '/metadata/identifier/0', type === '8' ? 'EU_CASCADE_CANONICAL_URL' : type === '2' ? 'EU_PUBLISHED_COMMISSION_URL' : 'EU_TOPIC_CANONICAL_URL')]);
  if (raw.url !== url || scalar(m, 'url') !== url) issue('SOURCE_URL_RECONSTRUCTED_FROM_CALL_ID', '/links/official', out.links.official.evidenceRefs);
  if (values(m, 'closingDate').length) issue('SOURCE_CLOSINGDATE_NOT_A_DEADLINE', '/schedule/deadlines', [e('unused-closing', '/metadata/closingDate/0', 'EXCLUDE_NON_CALENDAR_METADATA')]);

  function currency(value, ref, name = 'currency', locator = '/metadata/currency/0') {
    if (value === null || value === undefined || value === '') return absent('CURRENCY_NOT_DECLARED', [ref], 'NOT_FOUND');
    if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) invalid();
    return present(value, [e(name, locator, 'EXPLICIT_CURRENCY_CODE')]);
  }
  const programmeRefs = programmes.map(value => value.key);
  function allocation(amount, code, key, period = null, group = null) {
    return { key, money: { amount, currency: code, interpretation: amount === '0' ? 'ZERO_UNEXPLAINED' : 'PUBLISHED_AMOUNT' }, scope: type !== '1' ? 'CALL_TOTAL' : 'TOPIC_OR_SHARED', basis: 'CONFIRMED', programmeRefs, fundRefs: [], period, sharedGroup: group, aggregation: type !== '1' ? 'STANDALONE' : 'UNKNOWN', qualifiers: [] };
  }

  if (type !== '1') {
    const budget = scalar(m, 'budget');
    if (budget !== null) {
      const amount = n.decimal(budget), budgetRef = e('budget', '/metadata/budget/0', 'DECIMAL_CANONICAL');
      const rawCurrency = scalar(m, 'currency');
      const currencyRef = rawCurrency ? record : e('currency-absence', '/metadata', 'ABSENT_CURRENCY_KEY');
      const moneyCurrency = currency(rawCurrency, currencyRef);
      out.financing.allocations = present([allocation(amount, moneyCurrency, 'allocation-1')], [budgetRef]);
      if (moneyCurrency.state !== 'PRESENT') issue('CURRENCY_NOT_DECLARED', '/financing/allocations/value/0/money/currency', [currencyRef]);
    } else out.financing.allocations = nf('BUDGET_NOT_DECLARED');
    const description = type === '8' ? scalar(m, 'description') : null;
    if (description) {
      const narrative = plain(description);
      // Only an explicit direct-awarder clause supplies a party. Portal or
      // programme membership alone never creates a European Commission party.
      const awarders = directAwarders(narrative);
      if (awarders.length > 1) invalid('SOURCE_V2_CONFLICT');
      if (awarders.length) out.parties = present([{ role: 'DIRECT_AWARDER', name: awarders[0], externalId: null }], [e('direct-awarder', '/metadata/description/0', 'EXPLICIT_NAMED_ROLE')]);
      // Narrow published grammar, not a search for arbitrary currency amounts.
      const monthly = [...narrative.matchAll(/For\s+([^,\n]{1,300}),\s+the\s+maximum amount of financial support\s+is set at\s+€([0-9][0-9,.]{0,80})\s+per month of internship(?:,\s+calculated based on an estimated structure of\s+(\d{1,12})\s+internships with a\s+(\d{1,12})-month duration each)?/gi)];
      if (monthly.length > 1) invalid('SOURCE_V2_CONFLICT');
      if (monthly.length) {
        const match = monthly[0], amount = n.decimal(match[2], { groupSeparator: ',' });
        const cap = e('monthly-support', '/metadata/description/0', 'EXPLICIT_MONTHLY_INTERNSHIP_CAP');
        const euro = e('support-currency', '/metadata/description/0', 'EXPLICIT_EURO_SYMBOL');
        const conditions = `Maximum per month of internship at ${n.text(match[1], { maxLength: 300 })}`
          + (match[3] && match[4] ? `; estimated structure: ${match[3]} internships of ${match[4]} months each.` : '.');
        out.financing.support = present([{ minimum: null, maximum: amount, currency: present('EUR', [euro]), unit: 'PER_PERSON_MONTH', conditions }], [cap]);
      }
    }
  } else {
    mapTopicMoney(m, topic, out, { e, nf, allocation, issue });
  }
  return validateSnapshotV2(out);
}

function parseStructured(raw) {
  // Node's JSON reviver source preserves the original numeric lexical value.
  // Never reconstruct a decimal from an already rounded IEEE-754 value.
  try {
    return JSON.parse(raw, (key, value, context) => {
      if (typeof value === 'number') {
        if (!context || typeof context.source !== 'string') invalid();
        return context.source;
      }
      return value;
    });
  } catch { invalid(); }
}

function mapTopicMoney(metadata, topic, out, { e, nf, allocation, issue }) {
  const raw = scalar(metadata, 'budgetOverview');
  if (!raw) { out.financing.allocations = nf('BUDGET_NOT_DECLARED'); out.financing.support = nf('SUPPORT_NOT_DECLARED'); return; }
  const overview = parseStructured(raw), map = overview?.budgetTopicActionMap;
  if (!map || Array.isArray(map) || typeof map !== 'object') invalid();
  const allocations = [], support = [];
  // JSON inside a source string has a single real JSON Pointer. The transform
  // and typed group/period retain the internal mapping, without fictional paths.
  const locator = '/metadata/budgetOverview/0';
  const budgetRef = e('budget-overview', locator, 'TOPIC_ACTION_EXACT_BUDGET_YEAR');
  const supportRef = e('support-overview', locator, 'TOPIC_ACTION_EXACT_CONTRIBUTION');
  let rowNumber = 0;
  for (const [group, rows] of Object.entries(map)) {
    if (!Array.isArray(rows)) invalid();
    for (const row of rows) {
      if (!row || typeof row.action !== 'string') invalid();
      if (!row.action.startsWith(topic + ' - ')) continue;
      const action = n.text(row.action, { maxLength: 300 });
      const suffix = rowNumber++;
      const currencyValue = row.currency ?? overview.currency;
      const currencyRef = e('topic-currency-source-' + suffix, locator, currencyValue ? 'EXPLICIT_BUDGET_CURRENCY' : 'ABSENT_BUDGET_CURRENCY');
      const rowCurrency = currencyValue === undefined || currencyValue === null || currencyValue === ''
        ? absent('CURRENCY_NOT_DECLARED', [currencyRef], 'NOT_FOUND')
        : present(typeof currencyValue === 'string' && /^[A-Z]{3}$/.test(currencyValue) ? currencyValue : invalid(), [currencyRef]);
      if (row.budgetYearMap !== undefined && (!row.budgetYearMap || Array.isArray(row.budgetYearMap) || typeof row.budgetYearMap !== 'object')) invalid();
      for (const [period, value] of Object.entries(row.budgetYearMap || {})) {
        if (allocations.length >= 128) invalid('SOURCE_V2_LIMIT_EXCEEDED');
        const amount = n.decimal(value);
        allocations.push(allocation(amount, rowCurrency, 'allocation-' + (allocations.length + 1), n.text(period, { maxLength: 128 }), n.text(group, { maxLength: 128 })));
      }
      const minimum = row.minContribution == null ? null : n.decimal(row.minContribution);
      const maximum = row.maxContribution == null ? null : n.decimal(row.maxContribution);
      if (minimum !== null || maximum !== null) {
        if (support.length >= 64) invalid('SOURCE_V2_LIMIT_EXCEEDED');
        support.push({ minimum, maximum, currency: rowCurrency, unit: 'PER_PROJECT', conditions: `${action}; budget group ${n.text(group, { maxLength: 128 })}` });
      }
    }
  }
  out.financing.allocations = allocations.length ? present(allocations, [budgetRef]) : nf('TOPIC_BUDGET_NOT_DECLARED');
  out.financing.support = support.length ? present(support, [supportRef]) : nf('TOPIC_SUPPORT_NOT_DECLARED');
  allocations.forEach((value, index) => {
    if (value.money.currency.state !== 'PRESENT') issue('CURRENCY_NOT_DECLARED', `/financing/allocations/value/${index}/money/currency`, value.money.currency.evidenceRefs);
  });
}

function adaptEuOpportunityV2(input, options = {}) {
  const evidence = cloneData(input, { maxBytes: 2 * 1024 * 1024 });
  const config = cloneData(options, { maxBytes: 1024 });
  if (!config || Array.isArray(config) || Object.keys(config).length !== 1 || !Object.hasOwn(config, 'observedAt') || !verifyEvidence(evidence)) invalid();
  const observedAt = n.instant(config.observedAt);
  if (observedAt !== config.observedAt) invalid();
  const artifactSha256 = sha(JSON.stringify(evidence));
  const snapshots = evidence.variants.map((_, index) => mapVariant(evidence, index, observedAt, artifactSha256));
  const digests = snapshots.map(contentDigestV2);
  if (new Set(digests).size !== 1) invalid('SOURCE_V2_CONFLICT');
  return snapshots[0];
}

module.exports = { adaptEuOpportunityV2, sameTitle };
