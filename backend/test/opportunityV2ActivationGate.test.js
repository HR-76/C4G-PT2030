'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseArgs,inputHashes}=require('../../test/integration/opportunity-v2/gate.cjs');
test('Activation proof is explicitly isolated and rejects endpoints or activation switches',()=>{
 assert.throws(()=>parseArgs(['--isolated','--activation-only']),/OPPORTUNITY_ACTIVATION_PROOF_SUPERSEDED_USE_ACTIVATION_HTTP_ONLY/);
 for(const args of [['--activation-only'],['--isolated','--activation'],['--isolated','--activation-only','--database=live'],['--isolated','--activation-only','--apply'],['--isolated','--activation-only','--approve']])assert.throws(()=>parseArgs(args));
});
test('Authenticated activation HTTP proof has its own isolated mode and no target endpoint',()=>{
 assert.deepEqual(parseArgs(['--isolated','--activation-http-only']),{temporalOnly:false,bootstrapOnly:false,activationHttpOnly:true});
 for(const args of [['--activation-http-only'],['--isolated','--activation-http-only','--base-url=http://localhost:3000'],['--isolated','--activation-http-only','--resume']])assert.throws(()=>parseArgs(args));
});
test('Activation evidence binds audit and provider implementations as well as SQL',()=>{
 const hashes=inputHashes();
 for(const path of ['backend/src/audit/appendService.js','backend/src/portugal2030/planXlsxV2.js','backend/database/central/candidates/opportunity_persistence_v2.up.sql'])assert.match(hashes[path],/^[a-f0-9]{64}$/);
});
