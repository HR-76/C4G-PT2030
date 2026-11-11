'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assertFixture,captureBaseSql,compareSnapshots,driftCases}=require('./integration/central-snapshot-ab/equivalence.cjs');
test('equivalence refuses unowned and habitual endpoints before SQL',()=>{
  const pool=port=>({options:{host:'127.0.0.1',port,database:'c4g_f13_authority_synthetic_central'},query(){throw Error('SQL forbidden');},connect(){}});
  const fixture={ownership:{isolated:true,runId:'a'.repeat(32),centralDatabase:'c4g_f13_authority_synthetic_central'},reader:pool(15432),central:{pool:pool(15432),authorityPool:pool(15432),permitSecret:'x'.repeat(32)}};
  assert.doesNotThrow(()=>assertFixture(fixture,'043_opportunity_eu_writer_v2'));
  fixture.reader=pool(5432);assert.throws(()=>assertFixture(fixture,'043_opportunity_eu_writer_v2'),/AB_OWNED_FIXTURE_REQUIRED/);
  fixture.reader=pool(15433);assert.throws(()=>assertFixture(fixture,'043_opportunity_eu_writer_v2'),/AB_OWNED_FIXTURE_REQUIRED/);
  fixture.reader=pool(15432);fixture.ownership.isolated=false;assert.throws(()=>assertFixture(fixture,'043_opportunity_eu_writer_v2'),/AB_OWNED_FIXTURE_REQUIRED/);
});
test('capture obtains only first aggregate SQL without querying a database',async()=>{
  let later=false;
  const sql=await captureBaseSql({async centralSchemaSnapshot(c){await c.query('SELECT sample');later=true;}});
  assert.equal(sql,'SELECT sample');assert.equal(later,false);
  await assert.rejects(captureBaseSql({async centralSchemaSnapshot(){throw Error('unrelated');}}),/unrelated/);
});
test('serialized parity preserves ordering and duplicates, not merely a set',()=>{
  assert.equal(compareSnapshots({a:[1,1]},{a:[1,1]}).equal,true);
  assert.throws(()=>compareSnapshots({a:[1,2]},{a:[2,1]}),/AB_SNAPSHOT_MISMATCH/);
  assert.throws(()=>compareSnapshots({a:[1,1]},{a:[1]}),/AB_SNAPSHOT_MISMATCH/);
  assert.throws(()=>compareSnapshots({a:1,b:2},{b:2,a:1}),/AB_SNAPSHOT_MISMATCH/);
});
test('real drift matrix includes independent coverage of security edge cases',()=>{
  const cases=driftCases();assert.equal(new Set(cases.map(x=>x.name)).size,cases.length);
  for(const name of ['public-table','third-party-table','public-column','third-party-column','foreign-column-view','foreign-function','foreign-schema','owned-empty-acl','owned-null-acl','membership','role-attribute','multiple-grantors','not-null-quoted','not-null-no-inherit','not-null-not-valid'])assert(cases.some(x=>x.name===name),name);
  assert(cases.every(x=>Array.isArray(x.sql)&&x.sql.length));
});
