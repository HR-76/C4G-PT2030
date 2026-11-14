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
