'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFundingRepository } = require('../src/fundingTenders/repository');

function fixture() {
  const calls = [];
  let connections = 0;
  const repository = createFundingRepository({
    clock: () => new Date('2026-11-01T12:00:00Z'),
    pool: { async connect() { connections++; return {
      release() {},
      async query(sql, values) {
        calls.push({ sql, values });
        if (/^(BEGIN READ ONLY|SET LOCAL|COMMIT|ROLLBACK)/.test(sql) || sql.startsWith('SELECT o.opportunity_id') || sql.startsWith('WITH ranked AS') || sql.startsWith('SELECT DISTINCT programme')) return { rows: [] };
        throw new Error('Unexpected SQL');
      },
    }; } },
  });
  return { repository, calls, connections: () => connections };
}

test('catalog listing treats adversarial search text as literal positional parameters', async () => {
  const f = fixture();
  const q = "%' OR 1=1; SELECT pg_sleep(10); --";
  const programme = "Horizon_\\'; DROP TABLE opportunity; --";
  const cursor = '00000000-0000-4000-8000-000000000001';
  const result = await f.repository.list({ q, programme, cursor, closingFrom: '2026-11-01', closingTo: '2026-12-31', temporalState: 'OPEN' });
  const query = f.calls.find(call => call.sql.startsWith('SELECT o.opportunity_id'));
  assert.deepEqual(query.values, [cursor, q, programme, '2026-11-01', '2026-12-31', 'OPEN', '2026-11-01T12:00:00.000Z', null]);
  for (const value of [q, programme, cursor]) assert.equal(query.sql.includes(value), false);
  assert.ok(query.sql.includes('strpos('));
  assert.ok(query.sql.includes('ORDER BY o.opportunity_id LIMIT 26'));
  assert.equal(f.calls[0].sql, 'BEGIN READ ONLY');
  assert.equal(f.calls.at(-1).sql, 'COMMIT');
  assert.deepEqual(result.items, []);
});

test('invalid catalogue filters and forged organization scope never open a database connection', async () => {
  const f = fixture();
  for (const input of [{ source:'fake' }, { sort:'amount; DROP' }, { interventionArea:'fake' }, { organizationId: 'other' }, { q: ['first', 'second'] }, { programme: {} }, { cursor: "x' OR 1=1 --" }, { closingFrom: '2027-02-29' }, { temporalState: 'OPEN; SELECT 1' }]) {
    await assert.rejects(f.repository.list(input), { code: 'INVALID_INPUT' });
  }
  assert.equal(f.connections(), 0);
  assert.deepEqual(f.calls, []);
});


test('intervention filter scans beyond the first page and resumes without duplicates',async()=>{
 const snapshot=require('../../context/references/opportunity-v2/examples/pt2030-8614.json');
 const records=Array.from({length:80},(_,i)=>{
  const copy=structuredClone(snapshot);copy.description.title.value=i%2?'Digitalização':'Aviso genérico';
  copy.description.summary={state:'NOT_FOUND',value:null,reason:'NO_COLUMN_IN_SOURCE',evidenceRefs:['headers']};
  copy.classification.specificObjectives={state:'NOT_FOUND',value:null,reason:'NO_COLUMN_IN_SOURCE',evidenceRefs:['headers']};
  return {opportunityId:'01900000-0000-7000-8000-'+String(i+1).padStart(12,'0'),revisionId:'01900000-0000-7000-8000-999999999999',temporalSnapshot:copy};
 });
 let reads=0;
 const repository=createFundingRepository({pool:{connect:async()=>({release(){},async query(sql,p){
  if(sql.startsWith('SELECT o.opportunity_id')){reads++;return {rows:records.filter(r=>!p[0]||r.opportunityId>p[0]).slice(0,26)}}
  return {rows:[]};
 }})}});
 const first=await repository.list({interventionArea:'DIGITAL'});assert.equal(first.items.length,25);assert.ok(reads>=2);assert.ok(first.interventionAreas.some(a=>a.code==='DIGITAL'));
 const next=await repository.list({interventionArea:'DIGITAL',cursor:first.nextCursor});assert.equal(next.items.length,15);assert.equal(next.nextCursor,null);
 assert.equal(new Set([...first.items,...next.items].map(i=>i.opportunityId)).size,40);
 const unknown=await repository.list({interventionArea:'UNCLASSIFIED'});assert.equal(unknown.items.length,25);
});

test('source and area filters paginate matching canonical records, including multi-source records',async()=>{
 const template=require('../../context/references/opportunity-v2/examples/pt2030-8614.json');
 const records=Array.from({length:90},(_,i)=>{
  const snapshot=structuredClone(template);
  snapshot.description.title.value=i%3===0?'Aviso digital':'Aviso generico';
  snapshot.description.summary={state:'NOT_FOUND',value:null,reason:'NO_COLUMN_IN_SOURCE',evidenceRefs:['headers']};
  snapshot.classification.specificObjectives={state:'NOT_FOUND',value:null,reason:'NO_COLUMN_IN_SOURCE',evidenceRefs:['headers']};
  if(i%3===0)snapshot.sourceRecords.push({...snapshot.sourceRecords[0],key:'manual-extra',namespace:'C4G_MANUAL'});
  return {opportunityId:'01900000-0000-7000-8000-'+String(i+1).padStart(12,'0'),revisionId:'01900000-0000-7000-8000-999999999999',temporalSnapshot:snapshot};
 });
 let reads=0;
 const repository=createFundingRepository({pool:{connect:async()=>({release(){},async query(sql,p){
  if(sql.startsWith('SELECT o.opportunity_id')){reads++;return {rows:records.filter(r=>!p[0]||r.opportunityId>p[0]).slice(0,26)}}
  return {rows:[]};
 }})}});
 const query={source:'C4G_MANUAL',interventionArea:'DIGITAL'};
 const first=await repository.list(query);assert.equal(first.items.length,25);assert.ok(reads>1);
 const second=await repository.list({...query,cursor:first.nextCursor});assert.equal(second.items.length,5);assert.equal(second.nextCursor,null);
 assert.equal(new Set([...first.items,...second.items].map(i=>i.opportunityId)).size,30);
 assert.ok(first.items.every(i=>i.source==='MULTIPLE_SOURCES'&&i.readModel.sourceRecords.some(s=>s.namespace==='C4G_MANUAL')));
 const none=await repository.list({source:'POCTEP'});assert.deepEqual(none.items,[]);assert.equal(none.nextCursor,null);
 const all=await repository.list({});assert.equal(all.items.length,25);
 assert.deepEqual(first.items[0].readModel.sourceRecords[0].url,template.sourceRecords[0].url);
});

test('source predicate is parameterized in SQL before page limit and matches any canonical namespace',async()=>{
 const f=fixture();await f.repository.list({source:'POCTEP',programme:'Horizon',temporalState:'OPEN'});
 const query=f.calls.find(c=>c.sql.startsWith('SELECT o.opportunity_id'));
 assert.deepEqual(query.values[7],['POCTEP']);assert.equal(query.values[2],'Horizon');assert.equal(query.values[5],'OPEN');
 assert.match(query.sql,/jsonb_array_elements\(r.snapshot->'sourceRecords'\) source WHERE source->>'namespace'=ANY\(\$8\)/);
 assert.ok(query.sql.indexOf('AND ($8::text[]')<query.sql.indexOf('ORDER BY o.opportunity_id LIMIT 26'));
 assert.match(query.sql,/f.external_identifier IS NULL THEN 'C4G_MANUAL'/);
});

test('Portugal 2030 passes both canonical namespaces to SQL without publishing or duplicating sources',async()=>{
 const f=fixture();await f.repository.list({source:'PORTUGAL2030'});
 assert.deepEqual(f.calls.find(c=>c.sql.startsWith('SELECT o.opportunity_id')).values[7],['PORTUGAL2030_PLAN','PORTUGAL2030_NOTICE']);
 assert.ok(!f.calls.some(c=>/INSERT|UPDATE|DELETE/.test(c.sql)));
});

test('combined Portugal 2030 includes plans, notices and mixed records once',async()=>{
 const template=require('../../context/references/opportunity-v2/examples/pt2030-8614.json');
 const records=[['PORTUGAL2030_PLAN'],['PORTUGAL2030_NOTICE'],['PORTUGAL2030_PLAN','PORTUGAL2030_NOTICE']].map((namespaces,index)=>{
  const snapshot=structuredClone(template);snapshot.sourceRecords=namespaces.map((namespace,i)=>({...snapshot.sourceRecords[0],key:i===0?snapshot.sourceRecords[0].key:'source-'+i,namespace}));
  return {opportunityId:'01900000-0000-7000-8000-'+String(index+1).padStart(12,'0'),revisionId:'01900000-0000-7000-8000-999999999999',temporalSnapshot:snapshot};
 });
 const repository=createFundingRepository({pool:{connect:async()=>({release(){},async query(sql){return {rows:sql.startsWith('SELECT o.opportunity_id')?records:[]}}})}});
 const result=await repository.list({source:'PORTUGAL2030'});assert.equal(result.items.length,3);assert.equal(new Set(result.items.map(i=>i.opportunityId)).size,3);assert.equal(result.nextCursor,null);
});

test('sorted catalogue pages use the filtered rank and resume at the UUID tie breaker', async () => {
  for (const sort of ['closing_asc','closing_desc','amount_asc','amount_desc']) {
    const f = fixture();
    await f.repository.list({sort, temporalState:'PLANNED', cursor:'00000000-0000-4000-8000-000000000001'});
    const query = f.calls.find(call => call.sql.startsWith('WITH ranked AS'));
    assert.ok(query.sql.includes('row_number() OVER (ORDER BY'));
    assert.ok(query.sql.includes((sort.endsWith('_desc') ? 'DESC' : 'ASC') + ' NULLS LAST, o.opportunity_id)'));
    assert.ok(query.sql.indexOf('temporal.temporal_state=$6') < query.sql.indexOf('ORDER BY position LIMIT 26'));
    assert.ok(query.sql.includes('position > (SELECT position FROM ranked WHERE opportunity_id=$1)'));
    assert.equal(query.values[5],'PLANNED');
  }
});
