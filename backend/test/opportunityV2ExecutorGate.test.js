'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseArgs,inputHashes}=require('../../test/integration/opportunity-v2/executor-11145-gate.cjs');
const {createLive11145Transport}=require('../../test/integration/opportunity-v2/executor-11145-transport.cjs');
test('live executor gate requires both isolated infrastructure and explicit live11145 scope',()=>{
 for(const args of [[],['--isolated'],['--live-11145'],['--isolated','--live-11145','--database=habitual'],['--isolated','--live-11146']])assert.throws(()=>parseArgs(args));
 assert.doesNotThrow(()=>parseArgs(['--isolated','--live-11145']));
});
test('live executor transport rejects other endpoints and broader discovery before any network or files',async()=>{
 const report={},transport=createLive11145Transport({outputDirectory:'UNREACHABLE_TEST_OUTPUT',report});
 await assert.rejects(transport.fetchImpl('https://example.invalid/',{}));
 const {ENDPOINT,formData}=require('../src/fundingTenders/source');
 const url=ENDPOINT+'?apiKey=SEDIA&language=en&pageNumber=1&pageSize=5&text=***';
 await assert.rejects(transport.fetchImpl(url,{method:'POST',redirect:'error',body:formData('EU_FUNDING_TENDERS','CASCADE:11146')}));
 await assert.rejects(transport.fetchImpl(url,{method:'POST',redirect:'error',body:formData('EU_FUNDING_TENDERS')}));
 assert.deepEqual(transport.observations,[]);
});
test('executor report pins full production composition and every executable gate seam',()=>{
 const hashes=inputHashes();for(const name of ['backend/src/productionComposition.js','backend/src/opportunities/v2/collector11145.js','backend/src/opportunities/v2/executor11145.js','backend/src/fundingTenders/source11145.js','frontend/src/api/api.js','backend/.env.example','test/integration/opportunity-v2/executor-11145-proof.cjs','test/integration/opportunity-v2/executor-11145-transport.cjs'])assert.match(hashes[name],/^[0-9a-f]{64}$/);
 assert(!Object.keys(hashes).some(name=>name.endsWith('/.env')));
});
