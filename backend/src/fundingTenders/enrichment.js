'use strict';
const { externalIdentity, CASCADE_BASE } = require('./identity');
const { sourceDescription } = require('./sourceDescription');
const { VERSION, programmeFor } = require('./programmeTaxonomy');
const { FIELDS, fitEnrichment, safePublicUrl } = require('../opportunities/sourceEnrichment');
const { canonicalize } = require('../organizationalProfile/canonicalization');
const TOPIC_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';
function invalid() { throw Object.assign(new Error('SOURCE_RECORD_INVALID'), { code: 'SOURCE_RECORD_INVALID' }); }
function plain(value) {
  if (typeof value !== 'string') return '';
  return (sourceDescription(value, value.length * 2 + 100) || '').toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}
// Limits are UTF-16 lengths, matching the public snapshot validator. Do not split pairs.
function clip(value, maximum) { return value.slice(0, maximum).replace(/[\ud800-\udbff]$/, ''); }
function values(m, key) { return Array.isArray(m[key]) ? m[key].filter(v => typeof v === 'string') : []; }
function first(m, key) { return values(m, key)[0]; }
function state() { return { status: 'NOT_FOUND', items: [], truncated: false, signatures: [] }; }
function unsupported(field) { if (field.status !== 'CONFLICT') field.status = 'UNSUPPORTED'; }
function add(field, value, source, locator, excerpt, originalValue = value) {
  field.items.push({ value, evidence: { url: source.url, locator: clip(locator, 240), excerpt: clip(plain(excerpt), 500), observedAt: source.observedAt } });
  field.signatures.push(canonicalize(originalValue));
  if (field.status === 'NOT_FOUND') field.status = 'PUBLISHED';
}
function text(field, value, source, locator, maximum = 1800) {
  const full = plain(value); if (!full) return;
  if (full.length > maximum) field.truncated = true;
  add(field, { text: clip(full, maximum) }, source, locator, full, { text: full });
}
function structured(m, key, expected, field) {
  const raw = values(m, key); if (!raw.length || raw.every(v => !v.trim())) return null;
  if (raw.length !== 1) { unsupported(field); return null; }
  try { const v = JSON.parse(raw[0]); if (!expected(v)) throw Error(); return v; }
  catch { unsupported(field); return null; }
}
function decimal(value) {
  if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) >= Number.MAX_SAFE_INTEGER)) return undefined;
  if (!['string', 'number'].includes(typeof value)) return value == null ? null : undefined;
  const s = String(value).trim();
  if (!/^(?:0|[1-9]\d{0,23})(?:\.\d{1,8})?$/.test(s)) return undefined;
  if (!/[1-9]/.test(s)) return null;
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}
function monetaryUnits(v) { const [whole, fraction = ''] = v.split('.'); return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0')); }
function currency(value, field) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && /^[A-Z]{3}$/.test(value)) return value;
  unsupported(field); return null;
}
function money(m, fields, source) {
  if (source.type !== '1') {
    for (const raw of values(m, 'budget')) {
      const amount = decimal(raw); if (amount === undefined) unsupported(fields.budget);
      else if (amount) add(fields.budget, { amount, currency: currency(first(m, 'currency'), fields.budget), period: null, scope: 'CALL', group: null, action: null }, source, 'metadata.budget', raw);
    }
    return;
  }
  const b = structured(m, 'budgetOverview', v => v && !Array.isArray(v) && typeof v === 'object', fields.budget);
  if (!b) { if (fields.budget.status === 'UNSUPPORTED') unsupported(fields.support); return; }
  const map = b.budgetTopicActionMap;
  if (!map || Array.isArray(map) || typeof map !== 'object') { unsupported(fields.budget); unsupported(fields.support); return; }
  for (const [group, rows] of Object.entries(map)) {
    if (!Array.isArray(rows)) { unsupported(fields.budget); unsupported(fields.support); continue; }
    for (const row of rows) {
      // The opaque map key is not the topic ccm2Id. Never assign another topic's money.
      if (!row || typeof row.action !== 'string' || !row.action.startsWith(source.topic + ' - ')) continue;
      if (row.action.length > 300 || group.length > 100) { unsupported(fields.budget); unsupported(fields.support); continue; }
      const base = `metadata.budgetOverview.budgetTopicActionMap[${group}]`;
      const yearMap = row.budgetYearMap;
      if (yearMap && !Array.isArray(yearMap) && typeof yearMap === 'object') {
        for (const [period, raw] of Object.entries(yearMap)) {
          const amount = decimal(raw);
          if (amount === undefined || period.length > 80) { unsupported(fields.budget); continue; }
          if (amount) add(fields.budget, { amount, currency: currency(row.currency ?? b.currency, fields.budget), period, scope: 'TOPIC_OR_SHARED', group, action: row.action }, source, `${base}.budgetYearMap[${period}]`, `${row.action}; ${period}: ${raw}`);
        }
      } else if (yearMap != null) unsupported(fields.budget);
      const minimum = decimal(row.minContribution), maximum = decimal(row.maxContribution);
      if (minimum === undefined || maximum === undefined || minimum && maximum && monetaryUnits(minimum) > monetaryUnits(maximum)) { unsupported(fields.support); continue; }
      if (minimum || maximum) add(fields.support, { minimum, maximum, currency: currency(row.currency ?? b.currency, fields.support), unit: 'PER_PROJECT', action: row.action }, source, base + '.minContribution/maxContribution', `${row.action}; minContribution=${row.minContribution ?? ''}; maxContribution=${row.maxContribution ?? ''}`);
    }
  }
}
const SECTION_LABELS = Object.freeze({
  rate: /^(?:funding|co-financing) rates?$/i,
  territories: /^(?:eligible countries|geographical eligibility|territorial eligibility)$/i,
  beneficiaries: /^(?:eligible participants|eligible applicants|eligible beneficiaries|who can apply\??)$/i,
  consortium: /^(?:consortium composition|consortium requirements|minimum consortium composition)$/i
});
function sections(html, fields, source, key) {
  const headings = [...html.matchAll(/<(h[1-6]|strong|b)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i], label = plain(h[2]).replace(/^\d+[a-z]?[.)]?\s*/i, '').replace(/[:?]\s*$/, '').trim();
    const field = Object.keys(SECTION_LABELS).find(k => SECTION_LABELS[k].test(label));
    if (!field) continue;
    const body = html.slice(h.index + h[0].length, headings[i + 1]?.index ?? html.length);
    if (plain(body)) text(fields[field], `${plain(h[2])}\n${body}`, source, `metadata.${key}; ${label}`);
  }
}
function isDocument(url) {
  const u = new URL(url);
  return /\.(?:pdf|docx?|xlsx?|odt|ods|pptx?|zip)$/i.test(u.pathname) || /(^|\.)europa\.eu$/i.test(u.hostname) && /\/(?:document|download)\//i.test(u.pathname);
}
function documents(html, field, source, key) {
  const inert = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  for (const a of inert.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(a[1]);
    if (!href) continue;
    const rawUrl = plain(href[1] ?? href[2] ?? href[3]);
    const url = safePublicUrl(rawUrl);
    if (!url) { unsupported(field); continue; }
    if (!isDocument(url)) continue;
    const rawTitle = plain(a[2]) || new URL(url).pathname.split('/').pop() || url;
    if (rawTitle.length > 200) field.truncated = true;
    add(field, { title: clip(rawTitle, 200), url }, source, `metadata.${key}; a[href]`, plain(a[2]) || url, { title: rawTitle, url });
  }
}
function variant(raw, externalIdentifier, observedAt) {
  const m = raw?.metadata;
  if (!m || typeof m !== 'object') invalid();
  const type = first(m, 'type'), topic = first(m, 'identifier'), call = first(m, 'callccm2Id');
  if (!['1', '2', '8'].includes(type) || !topic || externalIdentity(type, topic, call) !== externalIdentifier) invalid();
  const url = safePublicUrl(first(m, 'url')) || safePublicUrl(raw.url) || (type === '8' ? CASCADE_BASE + call : TOPIC_BASE + encodeURIComponent(topic));
  const source = { url, observedAt, type, topic };
  const fields = Object.fromEntries(FIELDS.map(k => [k, state()]));
  for (const id of values(m, 'frameworkProgramme')) {
    if (!id.trim()) continue;
    if (id.length > 100) { unsupported(fields.programme); continue; }
    const p = programmeFor(id);
    add(fields.programme, p || { id, code: null, label: id }, source, 'metadata.frameworkProgramme; official FACET 2026-11-11', id);
    if (!p) unsupported(fields.programme);
  }
  if (new Set(fields.programme.signatures).size > 1) fields.programme.status = 'CONFLICT';
  const actions = structured(m, 'actions', Array.isArray, fields.instrument);
  if (actions) {
    for (const action of actions) {
      if (!Array.isArray(action?.types)) { unsupported(fields.instrument); continue; }
      for (const t of action.types) {
        if (typeof t?.typeOfAction === 'string') text(fields.instrument, t.typeOfAction, source, 'metadata.actions[].types[].typeOfAction');
        else unsupported(fields.instrument);
      }
    }
  } else for (const value of values(m, 'typesOfAction')) text(fields.instrument, value, source, 'metadata.typesOfAction');
  money(m, fields, source);
  for (const key of ['topicConditions', 'descriptionByte', 'description', 'beneficiaryAdministration', 'furtherInformation', 'supportInfo']) {
    for (const html of values(m, key)) {
      if (key === 'topicConditions' || type === '8' && key === 'beneficiaryAdministration') text(fields.conditions, html, source, 'metadata.' + key, 3000);
      sections(html, fields, source, key); documents(html, fields.documents, source, key);
    }
  }
  // External action calls list their official documents as structured data.
  if (type === '2') for (const raw of values(m, 'publicationDocuments')) {
    if (!raw.trim()) continue;
    let list; try { list = JSON.parse(raw); } catch { list = null; }
    if (!Array.isArray(list)) { unsupported(fields.documents); continue; }
    for (const doc of list) {
      const url = safePublicUrl(doc?.docUrl), rawTitle = plain(doc?.nameDoc);
      if (!url || !rawTitle) { unsupported(fields.documents); continue; }
      if (rawTitle.length > 200) fields.documents.truncated = true;
      add(fields.documents, { title: clip(rawTitle, 200), url }, source, 'metadata.publicationDocuments[].docUrl', rawTitle, { title: rawTitle, url });
    }
  }
  const links = structured(m, 'links', Array.isArray, fields.submission);
  for (const link of links || []) {
    const url = safePublicUrl(link?.url);
    if (!url) { unsupported(fields.submission); continue; }
    const title = plain(link.criterionDescription) || plain(link.criterionCode) || plain(link.callIdentifier) || url;
    if (title.length > 200) fields.submission.truncated = true;
    add(fields.submission, { title: clip(title, 200), url, availability: 'UNKNOWN' }, source, 'metadata.links[].url', title, { title, url, availability: 'UNKNOWN' });
  }
  return fields;
}
function reconcile(candidates, key) {
  const known = candidates.filter(f => f.items.length);
  const signatures = new Set(known.map(f => canonicalize([...new Set(f.signatures)].sort())));
  const status = candidates.some(f => f.status === 'CONFLICT') || signatures.size > 1 ? 'CONFLICT'
    : candidates.some(f => f.status === 'UNSUPPORTED') ? 'UNSUPPORTED' : known.length ? 'PUBLISHED' : 'NOT_FOUND';
  const items = new Map();
  for (const f of known) for (const i of f.items) {
    const signature = canonicalize(i.value), previous = items.get(signature);
    if (!previous || canonicalize(i).localeCompare(canonicalize(previous)) < 0) items.set(signature, i);
  }
  const sorted = [...items.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item), limit = key === 'conditions' ? 1 : 8;
  return { status, items: sorted.slice(0, limit), truncated: sorted.length > limit || candidates.some(f => f.truncated) };
}
function extractEnrichment(rawItems, { externalIdentifier, observedAt } = {}) {
  if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > 25 || typeof externalIdentifier !== 'string' || Buffer.byteLength(JSON.stringify(rawItems)) > 2097152) invalid();
  const variants = rawItems.map(r => variant(r, externalIdentifier, observedAt));
  const fields = Object.fromEntries(FIELDS.map(key => [key, reconcile(variants.map(v => v[key]), key)]));
  return fitEnrichment({ schemaVersion: 1, mappingVersion: VERSION, observedAt, fields });
}
module.exports = { extractEnrichment };
