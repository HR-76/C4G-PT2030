'use strict';

const { normaliseProgramme } = require('../utils/programmeMapping');
const { text, date, url } = require('../opportunities/normalization');
const { sourceDescription } = require('./sourceDescription');
const { selection } = require('./programmes');
const { externalIdentity, CASCADE_BASE } = require('./identity');
const { buildEvidence, sourceDeadlines, sourceOpenings } = require('./sourceEvidence');
const ENDPOINT = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search';
const SOURCE = 'EU_FUNDING_TENDERS';
// Bump when query, ordering, identity or normalization semantics change.
const CURSOR_VERSION = 8;
const LIMITS = Object.freeze({ results: 100, pageSize: 25, pages: 4, requestMs: 15000, totalMs: 120000, bytes: 2 * 1024 * 1024, retries: 2 });
// LIMITS are the defaults; CAPS are the most any caller may request. The public
// API serves at most 100 records per request (observed 2026-11-11, largest page
// 891 kB against the 2 MiB bound), so approved collection uses one page of 100.
const CAPS = Object.freeze({ ...LIMITS, pageSize: 100 });
// Exact lookups stay within the evidence bound (sourceEvidence MAX_VARIANTS).
const LOOKUP_PAGE_SIZE = 25;
function failure(code) { return Object.assign(new Error(code), { code }); }
function first(metadata, key) { return Array.isArray(metadata[key]) ? metadata[key][0] : undefined; }
function bounded(value, maximum, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw failure('SOURCE_RECORD_INVALID');
    return undefined;
  }
  if (typeof value !== 'string') throw failure('SOURCE_RECORD_INVALID');
  const normalized = text(value);
  if ((required && !normalized) || [...normalized].length > maximum) throw failure('SOURCE_RECORD_INVALID');
  return normalized || undefined;
}
// Some publishers put a paragraph in the title: keep an excerpt with an ellipsis
// instead of rejecting a current call. Empty or non-text titles stay invalid.
function boundedTitle(value) {
  if (typeof value !== 'string') throw failure('SOURCE_RECORD_INVALID');
  const normalized = text(value);
  if (!normalized) throw failure('SOURCE_RECORD_INVALID');
  const chars = [...normalized];
  return chars.length > 300 ? chars.slice(0, 299).join('').trimEnd() + '…' : normalized;
}
function sourceDate(value) {
  if (!value) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) throw failure('SOURCE_RECORD_INVALID');
  if (value.length > 10 && !Number.isFinite(Date.parse(value))) throw failure('SOURCE_RECORD_INVALID');
  return date(value.slice(0, 10));
}
function hasCanonicalTitleConflict(evidence) {
  const n = require('../opportunities/v2/normalization');
  return evidence.variants.some(raw => {
    if (raw.metadata?.type?.[0] !== '8' || !Array.isArray(raw.metadata.callTitle)
      || raw.metadata.callTitle.length !== 1 || typeof raw.metadata.callTitle[0] !== 'string'
      || typeof raw.content !== 'string' || !raw.content.trim()) return false;
    try {
      const plain = value => sourceDescription(value, value.length + 1) || '';
      return !require('./adapterV2').sameTitle(n.text(plain(raw.content), { maxLength: 4000 }), n.text(plain(raw.metadata.callTitle[0]), { maxLength: 4000 }));
    } catch { return false; }
  });
}
function normalizeRecord(item, { asOf = null, known = false } = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item) || !item.metadata || Array.isArray(item.metadata)) throw failure('SOURCE_RECORD_INVALID');
  const m = item.metadata;
  const topicIdentifier = bounded(first(m, 'identifier') || item.id, 128, true);
  const externalIdentifier = externalIdentity(first(m, 'type'), topicIdentifier, first(m, 'callccm2Id'));
  const deadlines = (Array.isArray(m.deadlineDate) ? m.deadlineDate : []).map(sourceDate).filter(Boolean).sort();
  const closingDate = deadlines.find(value => !asOf || value >= asOf) || (known ? deadlines.at(-1) : undefined);
  if (!known && asOf && (!closingDate || (first(m, 'status') && !['31094501', '31094502'].includes(first(m, 'status'))))) throw failure('SOURCE_NOT_CURRENT');
  const fields = {
    title: boundedTitle(item.content || first(m, 'title')),
    callReference: topicIdentifier,
    programmeName: bounded(normaliseProgramme(first(m, 'frameworkProgramme')), 200),
    officialUrl: first(m, 'type') === '8'
      ? CASCADE_BASE + first(m, 'callccm2Id')
      : item.url ? url(bounded(item.url, 2048)) : undefined,
    openingDate: sourceDate(first(m, 'startDate')),
    closingDate,
    sourceTemporal: require('../opportunities/temporal').validateTemporal({status:({'31094501':'UPCOMING','31094502':'OPEN','31094503':'CLOSED',OPEN:'OPEN',UPCOMING:'UPCOMING',CLOSED:'CLOSED',CANCELLED:'CANCELLED'})[first(m,'status')]||'UNKNOWN',...(first(m,'status')?{statusCode:first(m,'status')} : {}),deadlines:[...new Set(sourceDeadlines(m))].sort(),openings:[...new Set(sourceOpenings(m))].sort()}),
    summary: sourceDescription(first(m, 'descriptionByte') || (first(m, 'description')
      ? [first(m, 'description'), first(m, 'furtherInformation')].filter(Boolean).join('\n')
      : first(m, 'beneficiaryAdministration')))
  };
  if (fields.openingDate && fields.closingDate && fields.closingDate < fields.openingDate) throw failure('SOURCE_RECORD_INVALID');
  return { externalIdentifier, fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) };
}
// Grant types follow the official "filtered data" example: topics (1), external
// action calls (2) and cascade calls (8). Tenders (0) stay out of scope.
// No programmePeriod term: it dropped current 2028-2034 calls and calls published
// without a period. Stale records are excluded locally (status and future deadline).
// No database, notification, credential or tenant dependency belongs in this port.
function formData(source = SOURCE, externalIdentifier = null) {
  const programmes = selection(source);
  const form = new FormData();
  const parts = {
    query: { bool: { must: [{ terms: { type: ['1', '2', '8'] } }, { terms: { status: ['31094501', '31094502'] } }] } },
    languages: ['en'], sort: [{ field: 'deadlineDate', order: 'DESC' }, { field: 'identifier', order: 'ASC' }, { field: 'callccm2Id', order: 'ASC' }],
    displayFields: ['type', 'identifier', 'reference', 'title', 'status', 'startDate', 'deadlineDate', 'actions', 'frameworkProgramme', 'descriptionByte', 'description', 'furtherInformation', 'beneficiaryAdministration', 'callccm2Id']
  };
  if (programmes.length) parts.query.bool.must.push({ terms: { frameworkProgramme: programmes } });
  if(externalIdentifier){
    const cascade=externalIdentifier.startsWith('CASCADE:');
    // Topics (1) and external action calls (2) share the published identifier namespace.
    parts.query={bool:{must:[cascade?{term:{type:'8'}}:{terms:{type:['1','2']}},{term:{[cascade?'callccm2Id':'identifier']:cascade?externalIdentifier.slice(8):externalIdentifier}}]}};
    delete parts.displayFields;
  }
  for (const [key, value] of Object.entries(parts)) form.append(key, new Blob([JSON.stringify(value)], { type: 'application/json' }));
  return form;
}
async function boundedJson(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) throw failure('SOURCE_RESPONSE_TOO_LARGE');
  if (!response.body) throw failure('SOURCE_RESPONSE_INVALID');
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) throw failure('SOURCE_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw failure('SOURCE_RESPONSE_INVALID'); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function waitForRetry(sleep,ms,signal){
  if(!signal)return sleep(ms);
  if(signal.aborted)throw failure('SOURCE_TIMEOUT');
  let abort;
  try{
    await new Promise((resolve,reject)=>{
      abort=()=>reject(failure('SOURCE_TIMEOUT'));
      signal.addEventListener('abort',abort,{once:true});
      Promise.resolve().then(()=>sleep(ms,signal)).then(resolve,error=>reject(signal.aborted?failure('SOURCE_TIMEOUT'):error));
      if(signal.aborted)abort();
    });
  }finally{signal.removeEventListener('abort',abort);}
}
function retryDelay(response, attempt, clock) {
  const retryAfter = response.headers.get('retry-after');
  const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;
  const at = retryAfter && seconds === null ? Date.parse(retryAfter) : NaN;
  return Math.max(500 * (2 ** attempt), seconds !== null ? seconds * 1000 : Number.isFinite(at) ? at - clock() : 0);
}
function createSource({ fetchImpl, clock = () => Date.now(), sleep = (ms,signal) => require('node:timers/promises').setTimeout(ms,undefined,{signal}), limits = LIMITS, enrichmentEnabled = false, canonicalV2Enabled = false } = {}) {
  if(typeof enrichmentEnabled!=='boolean')throw new TypeError('Invalid enrichment option');
  if(typeof canonicalV2Enabled!=='boolean'||canonicalV2Enabled&&!enrichmentEnabled)throw new TypeError('Canonical EU collection requires complete detail enrichment.');
  if (typeof fetchImpl !== 'function') throw new TypeError('An explicit fixture or approved live transport is required.');
  for (const key of Object.keys(LIMITS)) if (!Number.isSafeInteger(limits[key]) || limits[key] < (key === 'retries' ? 0 : 1) || limits[key] > CAPS[key]) throw new TypeError('Funding collection limits cannot exceed the approved caps.');
  if (limits.results < limits.pageSize) throw new TypeError('A batch must allow at least one complete page.');
  const port={ async collect({ signal, source = SOURCE, cursor = null, onPage, pageBudget = limits.pages, externalIdentifier = null } = {}) {
    if(externalIdentifier!==null&&(typeof externalIdentifier!=='string'||!externalIdentifier.length||externalIdentifier.length>128))throw failure('SOURCE_RECORD_INVALID');
    const programmes = selection(source);
    const pageSize = externalIdentifier ? Math.min(limits.pageSize, LOOKUP_PAGE_SIZE) : limits.pageSize;
    const contractParts = [];
    for (const [key, value] of formData(source,externalIdentifier)) contractParts.push([key, await value.text()]);
    const contract = require('node:crypto').createHash('sha256').update(JSON.stringify([CURSOR_VERSION, ENDPOINT, pageSize, contractParts,enrichmentEnabled,canonicalV2Enabled])).digest('hex');
    if (!Number.isSafeInteger(pageBudget) || pageBudget < 1 || pageBudget > limits.pages || cursor && cursor.contract !== contract) throw failure('SOURCE_CURSOR_INVALID');
    if (cursor !== null && (typeof cursor !== 'object' || cursor.version !== CURSOR_VERSION || cursor.source !== source || cursor.pageSize !== pageSize || !Number.isSafeInteger(cursor.nextPage) || cursor.nextPage < 1 || cursor.nextPage > 1000000 || typeof cursor.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(cursor.asOf))) throw failure('SOURCE_CURSOR_INVALID');
    if (cursor) { try { date(cursor.asOf); } catch { throw failure('SOURCE_CURSOR_INVALID'); } }
    const started = clock(), asOf = cursor?.asOf || new Date(started).toISOString().slice(0, 10);
    const records = new Map(), rawItems = []; let ambiguous = false, failed = 0, excluded = 0, received = 0, pages = 0, limited = false, duplicates = 0, remoteTotal = null, nextCursor = null;
    for (let page = cursor?.nextPage || 1; pages < pageBudget && received < limits.results; page++) {
      // A continuation must keep the provider's page size constant; changing it
      // changes the offset and silently skips or repeats records.
      if (limits.results - received < pageSize) { limited = true; break; }
      let data;
      async function fetchPageWithRetry() {
        for (let attempt = 0; ; attempt++) {
        const remaining = limits.totalMs - (clock() - started);
        if (remaining <= 0 || signal?.aborted) throw failure('SOURCE_TIMEOUT');
        const controller = new AbortController();
        const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, Math.min(limits.requestMs, remaining));
        let retryMs = 0;
        try {
          // The public portal application parameter is documented by the EC API page;
          // it is not a customer's private credential and is never logged.
          const params = new URLSearchParams({ apiKey: 'SEDIA', text: '***', language: 'en', pageSize: String(pageSize), pageNumber: String(page) });
          const response = await fetchImpl(`${ENDPOINT}?${params}`, { method: 'POST', redirect: 'error', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: formData(source,externalIdentifier), signal: controller.signal });
          if (response.status === 429 || response.status >= 500) {
            retryMs = retryDelay(response, attempt, clock);
            await response.body?.cancel();
            throw failure('SOURCE_RETRYABLE');
          }
          if (!response.ok) { await response.body?.cancel(); throw failure('SOURCE_REJECTED'); }
          data = await boundedJson(response, limits.bytes);
          if (!data || !Array.isArray(data.results) || data.results.length > Math.min(pageSize, limits.results - received)) throw failure('SOURCE_RESPONSE_INVALID');
          break;
        } catch (error) {
          if (signal?.aborted) throw failure('SOURCE_TIMEOUT');
          if (controller.signal.aborted && attempt >= limits.retries) throw failure('SOURCE_TIMEOUT');
          const retryable = error.code === 'SOURCE_RETRYABLE' || error.name === 'AbortError' || error.name === 'TimeoutError' || error instanceof TypeError;
          if (!retryable || attempt >= limits.retries) throw failure(retryable ? 'SOURCE_UNAVAILABLE' : error.code || 'SOURCE_RESPONSE_INVALID');
          retryMs ||= 500 * (2 ** attempt);
          if (clock() - started + retryMs >= limits.totalMs) throw failure('SOURCE_TIMEOUT');
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
        await waitForRetry(sleep,retryMs,signal);
      }
      }
      await fetchPageWithRetry();
      pages++; received += data.results.length;
      if (externalIdentifier && rawItems.length + data.results.length <= pageSize) rawItems.push(...data.results);
      const pageRecords = new Map(); let pageFailed = 0, pageExcluded = 0;
      for (const item of data.results) {
        try {
          if (programmes.length && !item?.metadata?.frameworkProgramme?.some(code => programmes.includes(code))) throw failure('SOURCE_RECORD_INVALID');
          const record = normalizeRecord(item, { asOf,known:Boolean(externalIdentifier) }), current = records.get(record.externalIdentifier);
          if(externalIdentifier && record.externalIdentifier!==externalIdentifier)throw failure('SOURCE_RECORD_INVALID');
          if(current && require('../organizationalProfile/canonicalization').canonicalize(current.fields)!==require('../organizationalProfile/canonicalization').canonicalize(record.fields))ambiguous=true;
          const pageCurrent = pageRecords.get(record.externalIdentifier);
          if (!pageCurrent || record.fields.closingDate && (!pageCurrent.fields.closingDate || record.fields.closingDate < pageCurrent.fields.closingDate)) pageRecords.set(record.externalIdentifier, record);
          if (current) duplicates++;
          if (!current || record.fields.closingDate && (!current.fields.closingDate || record.fields.closingDate < current.fields.closingDate)) records.set(record.externalIdentifier, record);
        } catch (error) { if (error.code === 'SOURCE_NOT_CURRENT') { excluded++; pageExcluded++; } else { failed++; pageFailed++; } }
      }
      const total = data.totalResults ?? data.total;
      if (total !== undefined && (!Number.isSafeInteger(total) || total < 0)) throw failure('SOURCE_RESPONSE_INVALID');
      remoteTotal = total ?? null;
      if (remoteTotal !== null && data.results.length < pageSize && (page - 1) * pageSize + data.results.length < remoteTotal) throw failure('SOURCE_RESPONSE_INVALID');
      const complete = data.results.length < pageSize || remoteTotal !== null && page * pageSize >= remoteTotal;
      nextCursor = complete ? null : { version: CURSOR_VERSION, contract, source, pageSize: pageSize, nextPage: page + 1, asOf };
      if (onPage) await onPage({ records: [...pageRecords.values()], received: data.results.length, failed: pageFailed, excluded: pageExcluded, remoteTotal, page, nextCursor, observedAt: new Date(clock()).toISOString() });
      if (complete) break;
      if (pages === pageBudget || limits.results - received < pageSize) limited = true;
    }
    let evidence;
    if (externalIdentifier && !failed && !limited && !nextCursor && received === rawItems.length && received > 0 && (remoteTotal === null || remoteTotal === received)) {
      try { evidence = buildEvidence(externalIdentifier, rawItems); } catch { /* Incomplete identity metadata cannot validate a resolution. */ }
    }
    return { records: [...records.values()], ambiguous, failed, excluded, duplicates, received, pages, limited, remoteTotal, nextCursor, contract, asOf, observedAt: new Date(clock()).toISOString(), ...(evidence ? { evidence } : {}) };
  },async lookup({externalIdentifier,source=SOURCE,signal}){
    const result=await port.collect({externalIdentifier,source,signal,pageBudget:1});
    const unrecognized=result.records.some(record=>record.fields.sourceTemporal.status==='UNKNOWN'&&(enrichmentEnabled||record.fields.sourceTemporal.statusCode));
    let outcome=result.failed?'ERROR':result.limited||result.ambiguous||unrecognized?'CONFLICT':result.records.length?'FOUND':'ABSENT';
    const conflictReasons=[];
    if(outcome==='CONFLICT'){
      if(result.limited)conflictReasons.push('LOOKUP_TRUNCATED');
      if(result.ambiguous)conflictReasons.push('SOURCE_VARIANTS_DIVERGE');
      if(unrecognized)conflictReasons.push('STATUS_UNRECOGNIZED');
    }
    if(enrichmentEnabled&&outcome==='FOUND'){
      if(!result.evidence)outcome='ERROR';
      else {
        const enrichment=require('./enrichment').extractEnrichment(result.evidence.variants,{externalIdentifier,observedAt:result.observedAt});
        result.records[0].fields.sourceEnrichment=enrichment;
        const programme=enrichment.fields.programme;
        if(programme.items.length===1)result.records[0].fields.programmeName=programme.status==='PUBLISHED'&&programme.items[0].value.code||programme.items[0].value.id;
      }
    }
    let canonicalSnapshot;
    if(canonicalV2Enabled&&outcome==='FOUND'){
      if(hasCanonicalTitleConflict(result.evidence)){outcome='CONFLICT';conflictReasons.push('CANONICAL_TITLE_CONFLICT');}
      else try{canonicalSnapshot=require('./adapterV2').adaptEuOpportunityV2(result.evidence,{observedAt:result.observedAt});}
      catch(error){outcome=error.code==='SOURCE_V2_CONFLICT'?'CONFLICT':'ERROR';if(outcome==='CONFLICT')conflictReasons.push('CANONICAL_MAPPING_CONFLICT');}
    }
    return {outcome,...(outcome==='FOUND'?{record:result.records[0]}:{}),...(outcome==='CONFLICT'?{conflictReasons:require('./conflictDiagnostics').validate(outcome,conflictReasons)}:{}),received:result.received,observedAt:result.observedAt,...(result.evidence?{evidence:result.evidence}:{}),...(canonicalSnapshot?{canonicalSnapshot}:{})};
  }};
  return Object.freeze(port);
}
module.exports = { ENDPOINT, SOURCE, LIMITS, CAPS, createSource, normalizeRecord, formData, boundedJson };
