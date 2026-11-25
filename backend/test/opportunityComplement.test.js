'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { complementLayer, complementDigest, effectiveComplement } = require('../src/opportunities/complement');
const { adaptNotice, readNoticeSite, ENDPOINT } = require('../src/portugal2030/noticeSite');

// Shape observed on 14/11/2026 in the public notice pages; values shortened.
const published = (overrides = {}) => ({
  id: 256012, link: 'https://portugal2030.pt/aviso/qualificacao-de-pessoas/', modified_gmt: '2026-09-14T17:19:38',
  title: { rendered: 'Qualificação de pessoas' },
  yoast_head_json: { og_description: 'O presente Aviso visa apoiar a&#8217;ção de formação, dotando-as de competências que [&hellip;]' },
  acf: { id: '7937', codigo: 'FA0241/2025', prioridade: ['4A - Madeira + Social e Inclusiva'], tipologia_acao: ['ESO4.8-03 - Integração'],
    tipologia_intervencao: ['ESO4.8-03-01 - Integração'], tipologia_operacao: ['4046 - Qualificação'], comparticipacao: 85, df: 250000 },
  ...overrides,
});
const reject = (input, code = 'COMPLEMENT_INVALID_INPUT') => assert.throws(() => complementLayer(input), { code });

test('a layer keeps only stated fields, normalized, and refuses anything else', () => {
  assert.deepEqual(complementLayer({ description: '  Linha um.\r\nLinha dois.  ', cofinancingRate: 85, priorities: ['4A'] }),
    { description: 'Linha um.\nLinha dois.', priorities: ['4A'], cofinancingRate: 85 });
  assert.deepEqual(complementLayer({}), {});
  reject({ title: 'Outro título' }, 'COMPLEMENT_UNKNOWN_FIELD');
  reject({ description: null }); reject({ description: '   ' }); reject({ description: 'x'.repeat(8001) });
  reject({ noticeCode: 'FA\n0241' }); reject({ description: 'tab\there' });
  reject({ officialUrl: 'http://portugal2030.pt/aviso/x/' }); reject({ officialUrl: 'javascript:alert(1)' }); reject({ officialUrl: 'https://user:pw@example.pt/' });
  reject({ cofinancingRate: 101 }); reject({ cofinancingRate: '85' }); reject({ cofinancingRate: 85.123 });
  reject({ priorities: [] }); reject({ priorities: ['A', 'A'] }); reject({ priorities: Array(21).fill(0).map((_, index) => 'P' + index) });
  reject([]); reject(Object.create({ description: 'herdado' }));
});

test('the digest covers the content and not the order the fields were given in', () => {
  assert.equal(complementDigest({ noticeCode: 'A', description: 'B' }), complementDigest({ description: 'B', noticeCode: 'A' }));
  assert.notEqual(complementDigest({ description: 'B' }), complementDigest({ description: 'C' }));
});

test('the administrator wins field by field and each field names its origin', () => {
  const collected = { fields: complementLayer({ description: 'Resumo publicado', noticeCode: 'FA0241/2025' }), sourceUrl: 'https://portugal2030.pt/aviso/x/', observedAt: '2026-11-14T10:00:00.000Z', descriptionTruncated: true };
  assert.equal(effectiveComplement({}), null);
  assert.deepEqual(effectiveComplement({ collected }).fields.description,
    { value: 'Resumo publicado', origin: 'COLLECTED', sourceUrl: collected.sourceUrl, observedAt: collected.observedAt, truncated: true });
  const merged = effectiveComplement({ collected, editorial: { fields: complementLayer({ description: 'Texto da C4G' }) } }).fields;
  assert.deepEqual(merged.description, { value: 'Texto da C4G', origin: 'EDITORIAL' });
  assert.equal(merged.noticeCode.origin, 'COLLECTED');
  assert.equal(merged.noticeCode.truncated, undefined);
});

test('a published notice becomes a collected complement tied to its plan identifier', () => {
  assert.deepEqual(adaptNotice(published()), { planId: '7937', sourceUrl: 'https://portugal2030.pt/aviso/qualificacao-de-pessoas/',
    sourceModifiedAt: '2026-09-14T17:19:38Z', descriptionTruncated: true, fields: {
      description: 'O presente Aviso visa apoiar a’ção de formação, dotando-as de competências que', noticeCode: 'FA0241/2025',
      officialUrl: 'https://portugal2030.pt/aviso/qualificacao-de-pessoas/', priorities: ['4A - Madeira + Social e Inclusiva'], actionTypologies: ['ESO4.8-03 - Integração'],
      interventionTypologies: ['ESO4.8-03-01 - Integração'], operationTypologies: ['4046 - Qualificação'], cofinancingRate: 85 } });
  const bare = adaptNotice(published({ yoast_head_json: {}, acf: { id: 8470 } }));
  assert.deepEqual(bare.fields, { officialUrl: 'https://portugal2030.pt/aviso/qualificacao-de-pessoas/' });
  assert.equal(bare.descriptionTruncated, false);
  // The summary must say more than the title, and markup never survives.
  assert.equal(adaptNotice(published({ yoast_head_json: { og_description: 'Qualificação de pessoas' } })).fields.description, undefined);
  assert.equal(adaptNotice(published({ yoast_head_json: { og_description: '<b>Apoio</b> a <script>x()</script>projetos.' } })).fields.description, 'Apoio a projetos.');
});

test('an item that cannot be tied to the plan or leaves the site is skipped', () => {
  for (const item of [null, {}, published({ acf: null }), published({ acf: { id: '' } }), published({ acf: { id: '79-37' } }),
    published({ link: 'https://example.org/aviso/x/' }), published({ link: 'https://portugal2030.pt/noticias/x/' }), published({ link: 'nada' })]) assert.equal(adaptNotice(item), null);
});

function site(pages, { status = 200, type = 'application/json; charset=UTF-8' } = {}) {
  const requested = [];
  return { requested, fetch: async (url, options) => {
    requested.push({ url, options });
    const page = Number(new URL(url).searchParams.get('page'));
    return new Response(JSON.stringify(pages[page - 1] || []), { status, headers: { 'content-type': type, 'x-wp-totalpages': String(pages.length) } });
  } };
}

test('every page is read from the fixed address and ambiguous identifiers are dropped', async () => {
  const twice = published({ acf: { id: '9000' } });
  const source = site([[published(), twice, { acf: {} }], [published({ acf: { id: '8000' } }), twice]]);
  const result = await readNoticeSite({ fetch: source.fetch, clock: () => new Date('2026-11-14T10:00:00Z') });
  assert.deepEqual({ ...result, notices: result.notices.map(notice => notice.planId) },
    { sourceNamespace: 'PORTUGAL2030_SITE', observedAt: '2026-11-14T10:00:00.000Z', total: 5, skipped: 1, ambiguous: ['9000'], notices: ['7937', '8000'] });
  assert.equal(source.requested.length, 2);
  for (const { url, options } of source.requested) {
    assert.ok(url.startsWith(ENDPOINT + '?per_page=100&page='));
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['user-agent'], 'C4G-Funding-Platform');
  }
});

test('an unavailable or unexpected site fails without partial results', async () => {
  await assert.rejects(readNoticeSite({ fetch: site([[published()]], { status: 503 }).fetch }), { code: 'PT2030_SITE_UNAVAILABLE' });
  await assert.rejects(readNoticeSite({ fetch: site([[published()]], { type: 'text/html' }).fetch }), { code: 'PT2030_SITE_UNEXPECTED' });
  await assert.rejects(readNoticeSite({ fetch: async () => new Response('{"code":"rest_no_route"}', { headers: { 'content-type': 'application/json', 'x-wp-totalpages': '1' } }) }), { code: 'PT2030_SITE_UNEXPECTED' });
  await assert.rejects(readNoticeSite({ fetch: site(Array(51).fill([])).fetch }), { code: 'PT2030_SITE_TOO_LARGE' });
});

// --- service and routes over a scripted database (the real one is exercised by test/integration/opportunity-complement).
const { createOpportunityComplementService, createOpportunityComplementRouter, publicError } = require('../src/opportunities/complementService');
const OPPORTUNITY = '11111111-1111-4111-8111-111111111111', ACTOR = '22222222-2222-4222-8222-222222222222';
const adminRequest = { authContext: { sessionId: 'sid-1' }, sessionID: 'sid-1', user: { id: ACTOR } };
function scripted(answer) {
  const statements = [];
  const query = async (sql, params) => { statements.push({ sql, params }); return answer(sql, params) || { rows: [], rowCount: 0 }; };
  return { statements, query, connect: async () => ({ query, release() {} }) };
}

test('a Central without 053 simply has no complement, and other failures are not hidden', async () => {
  const missing = createOpportunityComplementService({ centralPool: scripted(() => { throw Object.assign(new Error('relation does not exist'), { code: '42P01' }); }) });
  assert.equal(await missing.effective(OPPORTUNITY), null);
  assert.equal(await missing.effective('not-an-id'), null);
  const broken = createOpportunityComplementService({ centralPool: scripted(() => { throw Object.assign(new Error('connection lost'), { code: '08006' }); }) });
  await assert.rejects(broken.effective(OPPORTUNITY), { code: '08006' });
});

test('writes are refused before the database is asked to store anything invalid', async () => {
  const pool = scripted(sql => sql.includes('email_platform_admin') ? { rows: [{ allowed: true }] } : sql.includes('opportunity_catalog.opportunity') ? { rows: [{}], rowCount: 1 } : null);
  const service = createOpportunityComplementService({ centralPool: pool });
  const body = { fields: { description: 'Texto' }, expectedRevision: 0, idempotencyKey: '33333333-3333-4333-8333-333333333333' };
  for (const invalid of [{ ...body, fields: { title: 'x' } }, { ...body, expectedRevision: -1 }, { ...body, idempotencyKey: 'x' }, { ...body, extra: 1 }, { fields: {} }, null]) {
    await assert.rejects(service.save(OPPORTUNITY, invalid, adminRequest), { code: 'INVALID_INPUT' });
  }
  assert.equal(pool.statements.some(item => item.sql.includes('opportunity_complement_write')), false);
  await assert.rejects(service.save('x', body, adminRequest), { code: 'RESOURCE_NOT_AVAILABLE' });
  // A request whose session does not match its authenticated context never reaches the database.
  const before = pool.statements.length;
  await assert.rejects(service.save(OPPORTUNITY, body, { ...adminRequest, sessionID: 'other' }), { code: 'C4G_ADMIN_REQUIRED' });
  assert.equal(pool.statements.slice(before).some(item => item.sql.includes('email_platform_admin')), false);
  await service.save(OPPORTUNITY, body, adminRequest);
  const write = pool.statements.find(item => item.sql.includes('opportunity_complement_write'));
  assert.deepEqual([write.params[0], write.params[1], write.params[3], write.params[4], write.params[5], write.params.slice(7, 12), write.params[13]],
    ['sid-1', ACTOR, OPPORTUNITY, 'EDITORIAL', '{"description":"Texto"}', [null, null, null, null, null], 0]);
});

test('collection is off unless the deployment chooses what may be copied', async () => {
  const pool = scripted(sql => sql.includes('email_platform_admin') ? { rows: [{ allowed: true }] } : null);
  let read = 0;
  const service = createOpportunityComplementService({ centralPool: pool, readSite: async () => { read++; return {}; } });
  await assert.rejects(service.collect({ idempotencyKey: '33333333-3333-4333-8333-333333333333' }, adminRequest), { code: 'COLLECTION_NOT_CONFIGURED' });
  assert.equal(read, 0);
  assert.throws(() => createOpportunityComplementService({ centralPool: pool, collectionMode: 'everything' }), TypeError);
});

test('only the closed list of codes leaves the server', async () => {
  assert.deepEqual(publicError({ code: 'STALE_REVISION' }), { status: 409, body: { code: 'STALE_REVISION' } });
  assert.deepEqual(publicError(Object.assign(new Error('secret detail'), { code: '08006' })), { status: 503, body: { code: 'SERVICE_UNAVAILABLE' } });
  const express = require('express'), http = require('node:http');
  const service = { get: async id => ({ opportunityId: id }), save: async () => { throw Object.assign(new Error('x'), { code: 'STALE_REVISION' }); }, collect: async () => ({ written: 0 }) };
  const app = express(); app.use(express.json());
  app.use('/c', createOpportunityComplementRouter({ express, service, authenticate: (request, response, next) => next() }));
  const server = await new Promise(resolve => { const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s)); });
  const call = (method, path, body) => fetch(`http://127.0.0.1:${server.address().port}/c${path}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  try {
    const got = await call('GET', '/' + OPPORTUNITY);
    assert.deepEqual([got.status, got.headers.get('cache-control'), await got.json()], [200, 'no-store', { opportunityId: OPPORTUNITY }]);
    const stale = await call('PUT', '/' + OPPORTUNITY, {});
    assert.equal(stale.status, 409); assert.equal((await stale.json()).error.code, 'STALE_REVISION');
    assert.equal((await call('GET', '/' + OPPORTUNITY + '?x=1')).status, 400);
    assert.equal((await call('POST', '/collections/portugal2030', {})).status, 200);
    assert.equal((await call('DELETE', '/' + OPPORTUNITY)).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
