'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {catalogueProgrammes,sourceNamespaces}=require('../src/fundingTenders/catalogOptions');
const {catalogQuery}=require('../src/fundingTenders/catalogQuery');
test('Portugal 2030 combines plan and notice without relabelling stored provenance',()=>{
 assert.equal(catalogQuery({source:'PORTUGAL2030'}).source,'PORTUGAL2030');
 assert.deepEqual(sourceNamespaces('PORTUGAL2030'),['PORTUGAL2030_PLAN','PORTUGAL2030_NOTICE']);
 assert.deepEqual(sourceNamespaces('POCTEP'),['POCTEP']);
});
test('programme options retain national values and include the existing official EU taxonomy even for an empty catalogue',()=>{
 const empty=catalogueProgrammes();assert.ok(empty.includes('Horizon Europe (HORIZON)'));
 assert.ok(empty.includes('Programme for the Environment and Climate Action (LIFE)'));
 const values=catalogueProgrammes(['CENTRO2030','Horizon Europe (HORIZON)']);
 assert.ok(values.includes('CENTRO2030'));assert.equal(values.filter(v=>v==='Horizon Europe (HORIZON)').length,1);
});
