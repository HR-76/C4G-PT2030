'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {derive,checkIncrement,allowance,loadHistory}=require('./browser-increment');
test('increment preserves recorded baseline and independently caps cleanup and payload',()=>{
 const baseline={functionalRequests:482,cleanupRequests:65,applicationBytes:60516456,objectIntentions:23,completedObjects:22,multipartIntentions:3,unresolvedMultipart:0};
 const value=derive(baseline);assert.equal(value.limits.functionalRequests,528);assert.equal(value.limits.cleanupRequests,70);assert.equal(value.limits.applicationBytes,60584720);assert.equal(value.limits.multipartIntentions,3);assert.deepEqual(value.baseline,baseline);
 assert.doesNotThrow(()=>checkIncrement(allowance));for(const key of Object.keys(allowance))assert.throws(()=>checkIncrement({...allowance,[key]:allowance[key]+1}));
});
test('real historical journals are read only and linked without claiming reconciliation',()=>{
 const value=loadHistory('C:/Users/Utilizador/c4g-evidence/doc-mvp-01/idp-browser/5f6360f0-696a-4b8e-9147-e1db4321dd83');assert.match(value.source,/UNKNOWN_NOT_RECONCILED/);
});
