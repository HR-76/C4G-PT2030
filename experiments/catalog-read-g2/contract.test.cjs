'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {validate,validateQuery,consistentFixturePair,definitions}=require('./validate.cjs');
const valid=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/valid.json'),'utf8'));
const cases=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/cases.json'),'utf8'));
const clone=x=>structuredClone(x);
test('offline guard blocks network calls before connecting',()=>{
  assert.throws(()=>require('node:https').get('https://example.org/'),/G2_OFFLINE_NETWORK_DISABLED/);
  assert.throws(()=>require('node:net').connect(5432,'127.0.0.1'),/G2_OFFLINE_NETWORK_DISABLED/);
  assert.throws(()=>globalThis.fetch('https://example.org/'),/G2_OFFLINE_NETWORK_DISABLED/);
});
test('permission policy denies writes and child processes',()=>{
  assert.equal(process.permission.has('fs.write'),false);
  assert.equal(process.permission.has('child'),false);
  assert.throws(()=>fs.writeFileSync(path.join(__dirname,'must-not-exist.txt'),'blocked'),{code:'ERR_ACCESS_DENIED'});
});
test('application and NODE_OPTIONS environment are not inherited',()=>{
  for(const key of ['DATABASE_URL','CATALOG_DATABASE_URL','NODE_OPTIONS','PGHOST','PGPASSWORD']) assert.equal(process.env[key],undefined);
});
for(const [name,value] of Object.entries(valid)) test(`valid fixture: ${name}`,()=>{
  const before=clone(value);const result=validate(name,value);
  assert.equal(result.valid,true,JSON.stringify(result.errors));assert.deepEqual(value,before);
});
for(const c of cases) test(`${c.id}: ${c.description}`,()=>{
  const value=c.value===undefined?clone(valid[c.schema]):clone(c.value);
  for(const edit of c.edits||[]) {
    let node=value;for(const p of edit.path.slice(0,-1))node=node[p];
    const last=edit.path.at(-1);
    if(edit.op==='delete')delete node[last];else node[last]=clone(edit.value);
  }
  const before=clone(value);
  const result=c.pairs?validateQuery(c.schema,c.pairs):validate(c.schema,value);
  assert.equal(result.valid,c.expected,JSON.stringify(result.errors));
  if(c.error) assert.ok(result.errors.some(e=>e.code===c.error||e.keyword===c.error),JSON.stringify(result.errors));
  assert.deepEqual(value,before,'validator must not mutate input');
});
test('all 48 schema definitions compile',()=>assert.equal(definitions.length,48));
test('G1 list/detail fixture coherence',()=>assert.equal(consistentFixturePair(valid.ListResponse,valid.DetailResponse),true));
test('different revision in detail rejected by fixture comparison',()=>{
  const d=clone(valid.DetailResponse);d.data.summary.revisionId='30000000-0000-4000-8000-000000000001';
  assert.equal(consistentFixturePair(valid.ListResponse,d),false);
});
test('different generation rejected by fixture comparison',()=>{
  const d=clone(valid.DetailResponse);d.meta.generationId='30000000-0000-4000-8000-000000000001';
  assert.equal(consistentFixturePair(valid.ListResponse,d),false);
});
test('changed summary under same revision rejected by fixture comparison',()=>{
  const d=clone(valid.DetailResponse);d.data.summary.title.value='Changed';
  assert.equal(consistentFixturePair(valid.ListResponse,d),false);
});
test('UTF8 byte budget is not character count',()=>{
  const d=clone(valid.DetailResponse);
  d.data.summary.programmes.items=Array.from({length:32},(_,i)=>({id:`P${i}`,label:'😀'.repeat(500)}));
  d.data.summary.officialLinks=Array.from({length:32},()=>({label:'😀'.repeat(500),url:'https://example.org/'+('a'.repeat(1950))}));
  d.data.summary.sources=Array.from({length:32},(_,i)=>({namespace:`S${i}`,externalId:'😀'.repeat(200),officialUrl:'https://example.org/'+('a'.repeat(1950))}));
  d.data.description.value='😀'.repeat(80000);
  const result=validate('DetailResponse',d);
  assert.equal(result.valid,false);assert.ok(result.errors.some(e=>e.code==='BYTE_BUDGET'),JSON.stringify(result.errors));
});
test('duplicate rows cannot hide behind changed fields',()=>{
  const d=clone(valid.ListResponse);const row=clone(d.data[0]);row.title.value='Other title';d.data.push(row);d.page.returned=2;
  const r=validate('ListResponse',d);assert.ok(r.errors.some(e=>e.code==='DUPLICATE_ID'));
});
