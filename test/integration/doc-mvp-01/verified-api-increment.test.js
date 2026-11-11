'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {derive,checkIncrement,allowance,loadHistory}=require('./verified-api-increment');
test('measured API download plan adds inventories and isolates cleanup without resetting history',()=>{
 const value=loadHistory('C:/Users/Utilizador/c4g-evidence/doc-mvp-01/idp-browser/5f6360f0-696a-4b8e-9147-e1db4321dd83');
 assert.deepEqual(value.limits,{functionalRequests:560,cleanupRequests:73,applicationBytes:60531072,objectIntentions:25,completedObjects:24,multipartIntentions:3,unresolvedMultipart:0});
 assert.match(value.source,/UNKNOWN_NOT_RECONCILED/);assert.equal(allowance.functionalRequests+allowance.cleanupRequests,47);
 for(const key of Object.keys(allowance))assert.throws(()=>checkIncrement({...allowance,[key]:allowance[key]+1}));
 assert.doesNotThrow(()=>checkIncrement(allowance));assert.deepEqual(derive(value.baseline).baseline,value.baseline);
});
