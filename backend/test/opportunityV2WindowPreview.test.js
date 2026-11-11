'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {args,ownedFolder,bytes,observeOfficial,sourceSummary}=require('../scripts/localPlatform/prepareOpportunityV2Window');
const raw=fs.readFileSync(path.resolve(__dirname,'../../context/references/opportunity-v2/evidence/eu-11145.json'));
test('window preview refuses apply, other identities, destinations and CLI options',()=>{
 args(['--refresh-preview']);for(const input of [[],['--apply'],['--refresh-preview','--id=11146']])assert.throws(()=>args(input));
 for(const value of ['C:/elsewhere/preview-x',path.resolve(__dirname,'../../output/opportunity-v2-window/../existing')])assert.throws(()=>ownedFolder(value));
});
test('official capture bounds bytes and rejects unsuccessful responses',async()=>{
 await assert.rejects(bytes(new Response('abc',{status:500})));await assert.rejects(bytes(new Response('abcdef'),5));
 await assert.rejects(bytes(new Response('a',{headers:{'content-length':'10'}}),5));assert.equal((await bytes(new Response('abc'),3)).toString(),'abc');
});
test('current source uses the application adapter, preserves exact raw bytes and compares factual semantics',async()=>{
 let calls=0;const observed=await observeOfficial({fetchImpl:async(url,options)=>{calls++;assert.equal(new URL(url).hostname,'api.tech.ec.europa.eu');assert.equal(options.redirect,'error');return new Response(raw);}});
 assert.equal(calls,1);assert.deepEqual(observed.capture.body,raw);assert.equal(observed.metadata.totalResults,1);
 const summary=sourceSummary(observed);assert.equal(summary.normativeComparison.changed,false);assert.equal(summary.candidateSnapshot.financing.allocations.value[0].money.amount,'120000');assert.equal(summary.candidateSnapshot.schedule.deadlines.value.length,7);
 assert.equal(summary.candidateSnapshot.financing.allocations.value[0].money.currency.state,'NOT_FOUND');
 assert.equal(JSON.stringify(summary.metadata).includes('apiKey'),false);
});
test('official wrong identity or incomplete response never becomes a reviewed candidate',async()=>{
 const value=JSON.parse(raw);value.results[0].metadata.callccm2Id=['11146'];await assert.rejects(observeOfficial({fetchImpl:async()=>new Response(JSON.stringify(value))}));
 await assert.rejects(observeOfficial({fetchImpl:async()=>new Response(JSON.stringify({results:[],totalResults:0}))}));
});
