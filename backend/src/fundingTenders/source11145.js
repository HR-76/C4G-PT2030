'use strict';

const { createHash } = require('node:crypto');
const { createSource, ENDPOINT, SOURCE, LIMITS } = require('./source');
const { deepFreeze } = require('../opportunities/v2/data');
const EXTERNAL_IDENTIFIER = 'CASCADE:11145';
const COLLECTION_LIMITS = Object.freeze({ ...LIMITS, results: 5, pageSize: 5, pages: 1, retries: 0, totalMs: 30000 });
const QUERY = { bool: { must: [{ term: { type: '8' } }, { term: { callccm2Id: '11145' } }] } };
function fail() { throw Object.assign(new Error('OPPORTUNITY_V2_11145_SOURCE_INVALID'), { code: 'OPPORTUNITY_V2_11145_SOURCE_INVALID' }); }

// This port has no caller-selected URL, identity, page, parser or timeout. The
// optional transport is the same HTTP seam as createSource, not a snapshot port.
async function observe11145({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('An HTTP transport is required.');
  const controller = new AbortController();
  let timer, capture, requests = 0;
  const source = createSource({ enrichmentEnabled: true, canonicalV2Enabled: true, limits: COLLECTION_LIMITS,
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      if (++requests !== 1 || parsed.origin + parsed.pathname !== ENDPOINT || options.method !== 'POST'
          || options.redirect !== 'error' || parsed.searchParams.get('pageNumber') !== '1'
          || parsed.searchParams.get('pageSize') !== '5' || options.body.has('displayFields')
          || JSON.stringify(JSON.parse(await options.body.get('query').text())) !== JSON.stringify(QUERY)) fail();
      const response = await fetchImpl(url, options);
      if (response.status !== 200 || Number(response.headers.get('content-length')) > COLLECTION_LIMITS.bytes || !response.body) {
        await response.body?.cancel().catch(() => {}); fail();
      }
      const reader = response.body.getReader(), chunks = [];
      let length = 0;
      const abort = () => { reader.cancel().catch(() => {}); };
      options.signal.addEventListener('abort', abort, { once: true });
      try {
        for (;;) {
          const next = await reader.read();
          if (options.signal.aborted) fail();
          if (next.done) break;
          length += next.value.byteLength;
          if (length > COLLECTION_LIMITS.bytes) fail();
          chunks.push(Buffer.from(next.value));
        }
      } finally {
        options.signal.removeEventListener('abort', abort);
        await reader.cancel().catch(() => {}); reader.releaseLock();
      }
      const body = Buffer.concat(chunks), data = JSON.parse(body.toString('utf8'));
      const total = data?.totalResults ?? data?.total;
      if (!Array.isArray(data?.results) || !Number.isSafeInteger(total) || total < 1
          || total > COLLECTION_LIMITS.pageSize || total !== data.results.length) fail();
      capture = { endpoint: ENDPOINT, method: 'POST', externalIdentifier: EXTERNAL_IDENTIFIER,
        status: response.status, capturedAt: new Date().toISOString(), bytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'), totalResults: total };
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    } });
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
      controller.abort(); reject(Object.assign(new Error('OPPORTUNITY_V2_11145_SOURCE_INVALID'), { code: 'OPPORTUNITY_V2_11145_SOURCE_INVALID' }));
    }, COLLECTION_LIMITS.totalMs); });
    const batch = await Promise.race([source.lookup({ externalIdentifier: EXTERNAL_IDENTIFIER, source: SOURCE, signal: controller.signal }), timeout]);
    if (batch.outcome !== 'FOUND' || batch.record?.externalIdentifier !== EXTERNAL_IDENTIFIER || !batch.canonicalSnapshot
        || !capture || requests !== 1 || batch.received !== capture.totalResults || batch.evidence?.variants?.length !== capture.totalResults) fail();
    return deepFreeze({ batch, transport: capture });
  } catch { fail(); }
  finally { clearTimeout(timer); controller.abort(); }
}

module.exports = { EXTERNAL_IDENTIFIER, SOURCE, COLLECTION_LIMITS, observe11145 };
