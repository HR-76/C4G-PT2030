'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('failed observer setup releases its connection and pool, preserving failure',async()=>{
 for(const failAt of ['connect','extension']){
  let releases=0,ends=0;const original=Error('SETUP_FAILURE');
  class Pool{async connect(){if(failAt==='connect')throw original;return {query:async()=>{throw original;},release(){releases++;}};}async end(){ends++;}}
  const module={exports:{}};const code=fs.readFileSync(require.resolve('./resource-profile.cjs'),'utf8');
  const fakeRequire=name=>name.endsWith('/node_modules/pg')?{Pool}:name.endsWith('/centralSchemaManifest')?{centralSchemaSnapshot:async()=>({})}:name.endsWith('/readSchema')?{fingerprint:async()=>({})}:require(name);
  vm.runInNewContext(code,{require:fakeRequire,module,process,performance,setTimeout});
  const catalog={catalogPool:{connect:async()=>({release(){}})}};
  await assert.rejects(module.exports.create({db:{central:{connectionString:'test-only'}},catalog,hooks:{ignore(){}},out:'.'}),e=>e===original);
  assert.equal(releases,failAt==='connect'?0:1);assert.equal(ends,1);
 }
});
