'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDocumentConcurrency}=require('../src/documents/concurrency');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
test('queued jobs are bounded per organization and globally while others can progress',async()=>{
 const gate=deferred(),limiter=createDocumentConcurrency({global:2,perOrganization:1,queueLimit:2,perOrganizationQueueLimit:1});
 const active=limiter.run('a',()=>gate.promise),queued=limiter.run('a',()=>1);
 await assert.rejects(limiter.run('a',()=>2),{code:'DOCUMENT_QUEUE_FULL'});
 assert.equal(await limiter.run('b',()=>3),3);gate.resolve();assert.equal(await queued,1);await active;assert.equal(limiter.snapshot().queued,0);
});
test('aborted queued job is removed and never executes',async()=>{
 const gate=deferred(),limiter=createDocumentConcurrency({global:1,perOrganization:1}),ctrl=new AbortController();let invoked=false;
 const active=limiter.run('a',()=>gate.promise),pending=limiter.run('a',()=>{invoked=true},{signal:ctrl.signal});ctrl.abort();
 await assert.rejects(pending,{code:'DOCUMENT_QUEUE_CANCELLED'});assert.equal(limiter.snapshot().queued,0);gate.resolve();await active;assert.equal(invoked,false);
});
test('aborting after work starts does not release its concurrency slot early',async()=>{
 const gate=deferred(),limiter=createDocumentConcurrency({global:1,perOrganization:1}),ctrl=new AbortController(),started=deferred();
 const active=limiter.run('a',()=>{started.resolve();return gate.promise},{signal:ctrl.signal});await started.promise;ctrl.abort();assert.equal(limiter.snapshot().active,1);gate.resolve();await active;assert.equal(limiter.snapshot().active,0);
});
test('global queue cap rejects another organization and failures release capacity',async()=>{
 const gate=deferred(),limiter=createDocumentConcurrency({global:1,perOrganization:1,queueLimit:1,perOrganizationQueueLimit:1});
 const active=limiter.run('a',()=>gate.promise),queued=limiter.run('b',()=>{throw Error('expected')});
 await assert.rejects(limiter.run('c',()=>1),{code:'DOCUMENT_QUEUE_FULL'});gate.resolve();await active;await assert.rejects(queued,/expected/);assert.equal(await limiter.run('c',()=>7),7);assert.equal(limiter.snapshot().active,0);
});
test('already aborted signal fails without running work',async()=>{const limiter=createDocumentConcurrency(),c=new AbortController();c.abort();let invoked=false;await assert.rejects(limiter.run('a',()=>{invoked=true},{signal:c.signal}),{code:'DOCUMENT_QUEUE_CANCELLED'});assert.equal(invoked,false);});
