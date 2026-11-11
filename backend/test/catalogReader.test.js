'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {readerOptions,createCatalogReader}=require('../src/fundingTenders/catalogReader');
const {createFundingRepository}=require('../src/fundingTenders/repository');
test('reader has no fallback and rejects incomplete configuration without exposing it',()=>{
  for(const value of [undefined,'postgres://host/db','postgres://reader@host/db','https://reader:synthetic@host/db']){
    assert.throws(()=>readerOptions({CATALOG_DATABASE_URL:value}),error=>error.message==='CATALOG_CONFIGURATION_REQUIRED');
  }
});
test('dedicated reader exposes no write handle and closes only its pool once',async()=>{
  let ends=0;class Pool{end(){ends++;return Promise.resolve();}connect(){throw Error('unexpected connection');}}
  const port=createCatalogReader({env:{CATALOG_DATABASE_URL:'postgres://reader:synthetic@localhost/disposable'},Pool});
  assert.deepEqual(Object.keys(port).sort(),['close','dashboardSummary','get','list','ready','revision']);
  await Promise.all([port.close(),port.close()]);assert.equal(ends,1);
  await assert.rejects(()=>port.list(),/CATALOG_READER_CLOSED/);
});
test('reader reuses catalog queries in role-local read-only transactions, rollback on failure',async()=>{
  const queries=[];let failed=false,released=0;
  const client={release(){released++;},async query(sql){queries.push(sql);if(sql.startsWith('SELECT o.opportunity_id')){if(failed)throw Object.assign(Error('synthetic'),{code:'42501'});return {rows:[]};}return {rows:[]};}};
  const repo=createFundingRepository({pool:{connect:async()=>client},readRole:true});
  assert.deepEqual((await repo.list()).items,[]);
  assert.deepEqual(queries.slice(0,2),['BEGIN READ ONLY','SET LOCAL ROLE c4g_catalog_reader']);assert.equal(queries.at(-1),'COMMIT');
  failed=true;await assert.rejects(()=>repo.list(),e=>e.code==='42501');assert.equal(queries.at(-1),'ROLLBACK');assert.equal(released,2);
});
test('catalog routing refuses composition without an explicit reader',()=>{
  assert.throws(()=>require('../src/fundingTenders/http').createFundingRouters({}),/CATALOG_READER_REQUIRED/);
});
