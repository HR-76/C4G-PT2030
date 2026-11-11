'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSource, normalizeRecord, LIMITS } = require('../src/fundingTenders/source');
const { mergeSource } = require('../src/fundingTenders/merge');
const item = (id = 'SYNTHETIC-1', deadline = '2027-02-01') => ({ content: 'Synthetic call', url: 'https://example.invalid/call', metadata: { identifier: [id], frameworkProgramme: ['43108390'], startDate: ['2027-01-01'], deadlineDate: [deadline] } });
const response = results => new Response(JSON.stringify({ results }), { headers: { 'content-type': 'application/json' } });

test('mapping uses existing programme vocabulary and civil dates', () => {
  const r = normalizeRecord(item());
  assert.equal(r.externalIdentifier, 'SYNTHETIC-1'); assert.equal(r.fields.programmeName, 'HORIZON');
  assert.equal(r.fields.openingDate, '2027-01-01');
  assert.throws(() => normalizeRecord(item('x', '2027-02-30')));
  assert.throws(() => normalizeRecord({ ...item(), url: 'javascript:alert(1)' }));

});
test('explicit transport required; callers cannot expand collection caps', () => {
  assert.throws(() => createSource());
  assert.throws(() => createSource({ fetchImpl: fetch, limits: { ...LIMITS, results: 101 } }));
});
test('bounded pagination is four pages even when the source promises more', async () => {
  const calls = [];
  const source = createSource({ fetchImpl: async (target, options) => {
    calls.push(new URL(target)); assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({ totalResults: 10000, results: Array.from({ length: 25 }, (_, i) => item(`${calls.length}-${i}`)) }));
  } });
  const r = await source.collect(); assert.equal(calls.length, 4); assert.equal(r.records.length, 100); assert.equal(r.limited, true);
  assert.deepEqual(calls.map(u => u.searchParams.get('pageNumber')), ['1', '2', '3', '4']);
});
test('duplicates collapse deterministically and rejected items are counted', async () => {
  const r = await createSource({ fetchImpl: async () => response([item('same', '2027-03-01'), item('same'), { metadata: {} }]) }).collect();
  assert.equal(r.records.length, 1); assert.equal(r.records[0].fields.closingDate, '2027-02-01'); assert.equal(r.failed, 1);
});
test('429 retries respect Retry-After and remain bounded', async () => {
  const waits = []; let n = 0;
  const r = await createSource({ sleep: async ms => waits.push(ms), fetchImpl: async () => ++n < 3 ? new Response('', { status: 429, headers: { 'retry-after': '2' } }) : response([item()]) }).collect();
  assert.deepEqual(waits, [2000, 2000]); assert.equal(r.records.length, 1);
});
test('permanent rejection and malformed or oversized bodies do not retry', async () => {
  for (const make of [() => new Response('', { status: 403 }), () => new Response('{'), () => new Response('x'.repeat(150))]) {
    let calls = 0;
    await assert.rejects(createSource({ limits: { ...LIMITS, bytes: 100 }, fetchImpl: async () => { calls++; return make(); } }).collect());
    assert.equal(calls, 1);
  }
});
test('5xx retry exhaustion and long Retry-After cannot escape budget', async () => {
  let calls = 0;
  await assert.rejects(createSource({ sleep: async () => {}, fetchImpl: async () => { calls++; return new Response('', { status: 503 }); } }).collect(), { code: 'SOURCE_UNAVAILABLE' });
  assert.equal(calls, 3);
  await assert.rejects(createSource({ fetchImpl: async () => new Response('', { status: 429, headers: { 'retry-after': '1000' } }) }).collect(), { code: 'SOURCE_TIMEOUT' });
});
test('abort cancels pending request and never returns success', async () => {
  const controller = new AbortController();
  const pending = createSource({ fetchImpl: async (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) }).collect({ signal: controller.signal });
  controller.abort(); await assert.rejects(pending, { code: 'SOURCE_TIMEOUT' });
});
test('abort during retry backoff stops promptly without another provider request', async () => {
  const controller=new AbortController();let calls=0,resume,entered;
  const started=new Promise(resolve=>{entered=resolve});
  const source=createSource({fetchImpl:async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'10'}})},
    sleep:()=>new Promise(resolve=>{resume=resolve;entered()})});
  const pending=source.collect({signal:controller.signal});await started;controller.abort();
  try{
    const result=await Promise.race([pending.then(()=>({code:'UNEXPECTED_SUCCESS'}),error=>({code:error.code})),new Promise(resolve=>setTimeout(()=>resolve({code:'STUCK'}),200))]);
    assert.equal(result.code,'SOURCE_TIMEOUT');assert.equal(calls,1);
  }finally{resume();await pending.catch(()=>{});}
});
test('manual fields prevail; uncorrected fields refresh; source observation remains distinct', () => {
  const previousSource = { title: 'Original', closingDate: '2027-01-01' };
  const current = { title: 'Corrected', closingDate: '2027-01-01' };
  const incoming = { title: 'Provider changed', closingDate: '2027-02-01' };
  const r = mergeSource({ previousSource, current, incoming });
  assert.deepEqual(r.fields, { title: 'Corrected', closingDate: '2027-02-01' });
  assert.deepEqual(r.conflicts, ['title']); assert.deepEqual(r.corrections, { title: 'Corrected' });
  const repeated = mergeSource({ previousSource: incoming, current: r.fields, incoming, corrections: r.corrections });
  assert.equal(repeated.sourceChanged, false); assert.equal(repeated.effectiveChanged, false);
});
test('explicit manual removals and corrections survive a coincident source value', () => {
  const r = mergeSource({ incoming: { title: 'Manual', summary: 'Provider' }, corrections: { title: 'Manual', summary: null } });
  assert.deepEqual(r.fields, { title: 'Manual' }); assert.deepEqual(r.conflicts, ['summary']);
  const later = mergeSource({ incoming: { title: 'Other' }, corrections: r.corrections });
  assert.equal(later.fields.title, 'Manual'); assert.deepEqual(later.conflicts, ['title']);
});
test('a later manual correction replaces the earlier correction per field', () => {
  const r=mergeSource({previousSource:{title:'API'},current:{title:'New manual'},incoming:{title:'New API'},corrections:{title:'Old manual'}});
  assert.equal(r.fields.title,'New manual');assert.equal(r.corrections.title,'New manual');
});
test('request timeout aborts a nonresponding transport', async () => {
  await assert.rejects(createSource({limits:{...LIMITS,requestMs:10,totalMs:50,retries:0},fetchImpl:async(_, {signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))}).collect(),{code:'SOURCE_TIMEOUT'});
});
test('a published title longer than 300 characters is kept as an excerpt, never rejected or silently cut', () => {
  const long = 'SYSTEMEU - Financial Support to Third Parties ' + 'x'.repeat(320);
  const r = normalizeRecord({ ...item(), content: long });
  assert.equal([...r.fields.title].length, 300); assert.ok(r.fields.title.endsWith('…')); assert.ok(long.startsWith(r.fields.title.slice(0, -1)));
  assert.equal(normalizeRecord({ ...item(), content: 'x'.repeat(300) }).fields.title, 'x'.repeat(300));
  assert.throws(() => normalizeRecord({ ...item(), content: '   ' }));
  assert.throws(() => normalizeRecord({ ...item(), content: 42 }));
});
