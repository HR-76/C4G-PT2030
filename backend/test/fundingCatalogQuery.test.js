'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { catalogQuery } = require('../src/fundingTenders/catalogQuery');
test('catalog temporal filter admits the six explicit states including forecasts',()=>{
 for(const temporalState of ['OPEN','UPCOMING','PLANNED','CLOSED','CANCELLED','UNKNOWN'])assert.equal(catalogQuery({temporalState}).temporalState,temporalState);
 assert.throws(()=>catalogQuery({temporalState:'ACTIVE'}),{code:'INVALID_INPUT'});
});
test('catalog accepts bounded literal filters and real inclusive dates', () => {
  assert.deepEqual(catalogQuery({ q: '  100%_ ', programme: 'Horizon', closingFrom: '2028-02-29', closingTo: '2028-02-29' }), { q: '100%_', programme: 'Horizon', closingFrom: '2028-02-29', closingTo: '2028-02-29' });
  assert.deepEqual(catalogQuery({ q: ' ' }), {});
});
test('catalog rejects malformed filters before database access', () => {
  for (const input of [{ q: ['x'] }, { q: 'x'.repeat(201) }, { organizationId: 'x' }, { cursor: 'bad' }, { closingFrom: '2027-02-29' }, { closingTo: 'not-a-date' }, { closingFrom: '2027-03-02', closingTo: '2027-03-01' }]) assert.throws(() => catalogQuery(input), { code: 'INVALID_INPUT' });
});

test('source filter accepts canonical namespaces and rejects legacy or forged codes',()=>{
 for(const source of ['EU_FUNDING_TENDERS','PORTUGAL2030_PLAN','PORTUGAL2030_NOTICE','INTERREG_EUROPE','POCTEP','C4G_MANUAL'])assert.equal(catalogQuery({source}).source,source);
 for(const source of ['PORTUGAL_2030','CORDIS','MULTIPLE_SOURCES','fake', ['POCTEP']])assert.throws(()=>catalogQuery({source}),{code:'INVALID_INPUT'});
});
