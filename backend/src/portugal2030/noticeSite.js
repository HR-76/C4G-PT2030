'use strict';
// Reader of the public notice pages of portugal2030.pt (WordPress REST, no
// credentials). It is not a documented service: every item is validated and an
// unexpected shape is skipped and counted, never guessed. The origin is fixed
// here; no caller-supplied address is ever requested.
const { sourceDescription } = require('../fundingTenders/sourceDescription');
const { complementLayer } = require('../opportunities/complement');

const SOURCE_NAMESPACE = 'PORTUGAL2030_SITE';
const ORIGIN = 'https://portugal2030.pt';
const ENDPOINT = ORIGIN + '/wp-json/wp/v2/aviso';
const FIELDS = 'id,link,modified_gmt,title,acf,yoast_head_json.og_description';
const PAGE_SIZE = 100, MAX_PAGES = 50, MAX_PAGE_BYTES = 4 * 1024 * 1024, TIMEOUT_MS = 15000;
const CUT = /\s*\[(?:…|\.\.\.|&hellip;)\]\s*$/;

function fail(code) { throw Object.assign(new Error(code), { code }); }
const plain = value => typeof value === 'string' ? sourceDescription(value, value.length + 100)?.replace(/\s*\n\s*/g, ' ') : undefined;
const labels = value => Array.isArray(value) ? [...new Set(value.map(plain).filter(item => item && item.length <= 300))].slice(0, 20) : [];

// One published item to one collected complement, or null when the item cannot
// be tied to a plan row or states nothing usable.
function adaptNotice(item) {
  const acf = item?.acf;
  if (!acf || typeof acf !== 'object' || Array.isArray(acf)) return null;
  const planId = typeof acf.id === 'string' || Number.isSafeInteger(acf.id) ? String(acf.id).trim() : '';
  if (!/^(?:0|[1-9]\d{0,15})$/.test(planId)) return null;
  let sourceUrl;
  try { sourceUrl = new URL(item.link); } catch { return null; }
  if (sourceUrl.origin !== ORIGIN || !sourceUrl.pathname.startsWith('/aviso/')) return null;
  const title = plain(item.title?.rendered), published = plain(item.yoast_head_json?.og_description);
  const descriptionTruncated = !!published && CUT.test(published);
  const description = published?.replace(CUT, '').trim();
  const candidate = { officialUrl: sourceUrl.href };
  // A summary that only repeats the title says nothing.
  if (description && description !== title && description.length <= 8000) candidate.description = description;
  const code = plain(acf.codigo);
  if (code && code.length <= 64) candidate.noticeCode = code;
  for (const [key, source] of [['priorities', 'prioridade'], ['actionTypologies', 'tipologia_acao'], ['interventionTypologies', 'tipologia_intervencao'], ['operationTypologies', 'tipologia_operacao']]) {
    const values = labels(acf[source]);
    if (values.length) candidate[key] = values;
  }
  if (typeof acf.comparticipacao === 'number' && acf.comparticipacao > 0 && acf.comparticipacao <= 100) candidate.cofinancingRate = acf.comparticipacao;
  let fields;
  try { fields = complementLayer(candidate); } catch { return null; }
  const modified = typeof item.modified_gmt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(item.modified_gmt) ? item.modified_gmt + 'Z' : null;
  return Object.freeze({ planId, sourceUrl: sourceUrl.href, sourceModifiedAt: modified,
    descriptionTruncated: Object.hasOwn(fields, 'description') && descriptionTruncated, fields });
}

async function readPage(fetchImpl, page) {
  const response = await fetchImpl(`${ENDPOINT}?per_page=${PAGE_SIZE}&page=${page}&_fields=${FIELDS}`,
    { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json', 'user-agent': 'C4G-Funding-Platform' } });
  if (!response.ok) fail('PT2030_SITE_UNAVAILABLE');
  if (!/^application\/json\b/i.test(response.headers.get('content-type') || '')) fail('PT2030_SITE_UNEXPECTED');
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_PAGE_BYTES) fail('PT2030_SITE_TOO_LARGE');
  let items;
  try { items = JSON.parse(body.toString('utf8')); } catch { fail('PT2030_SITE_UNEXPECTED'); }
  const pages = Number(response.headers.get('x-wp-totalpages'));
  if (!Array.isArray(items) || !Number.isSafeInteger(pages) || pages < 0) fail('PT2030_SITE_UNEXPECTED');
  return { items, pages };
}

// Reads every notice page. A plan identifier published twice is ambiguous and
// is dropped on both sides instead of letting the last one win.
async function readNoticeSite({ fetch: fetchImpl = globalThis.fetch, clock = () => new Date() } = {}) {
  const byPlan = new Map(), ambiguous = new Set();
  let total = 0, skipped = 0;
  for (let page = 1, pages = 1; page <= pages; page++) {
    if (page > MAX_PAGES) fail('PT2030_SITE_TOO_LARGE');
    const result = await readPage(fetchImpl, page);
    pages = result.pages;
    for (const item of result.items) {
      total++;
      const notice = adaptNotice(item);
      if (!notice) { skipped++; continue; }
      if (byPlan.has(notice.planId) || ambiguous.has(notice.planId)) { byPlan.delete(notice.planId); ambiguous.add(notice.planId); continue; }
      byPlan.set(notice.planId, notice);
    }
  }
  return { sourceNamespace: SOURCE_NAMESPACE, observedAt: clock().toISOString(), total, skipped, ambiguous: [...ambiguous].sort(), notices: [...byPlan.values()] };
}

module.exports = { adaptNotice, readNoticeSite, SOURCE_NAMESPACE, ENDPOINT };
