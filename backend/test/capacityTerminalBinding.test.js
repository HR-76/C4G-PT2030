'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {matchesTerminalBinding}=require('../src/async/capacityTerminalBinding');
const base=Object.freeze({organizationId:'11111111-1111-4111-8111-111111111111',tenantId:'22222222-2222-4222-8222-222222222222',databaseGenerationId:'33333333-3333-4333-8333-333333333333',rootExecutionId:'44444444-4444-4444-8444-444444444444',executionId:'55555555-5555-4555-8555-555555555555',jobType:'document.scan',generation:2,authorityEpoch:3,contentDigest:'a'.repeat(64),bindingDigest:'b'.repeat(64)});
test('matching successful observation binds all expected identities and versions',()=>{
 assert.equal(matchesTerminalBinding(base,{...base,outcome:'SUCCESS'}),true);
});
test('refuses changed organization, tenant, physical generation, lineage and authority',()=>{
 for(const key of ['organizationId','tenantId','databaseGenerationId','rootExecutionId','executionId'])
  assert.equal(matchesTerminalBinding(base,{...base,[key]:'66666666-6666-4666-8666-666666666666',outcome:'SUCCESS'}),false,key);
 for(const key of ['generation','authorityEpoch'])assert.equal(matchesTerminalBinding(base,{...base,[key]:base[key]+1,outcome:'SUCCESS'}),false,key);
 for(const key of ['contentDigest','bindingDigest'])assert.equal(matchesTerminalBinding(base,{...base,[key]:'c'.repeat(64),outcome:'SUCCESS'}),false,key);
 assert.equal(matchesTerminalBinding(base,{...base,jobType:'document.reconcile',outcome:'SUCCESS'}),false);
});
test('refuses terminal failures, unknown fields, malformed values, getters and proxies',()=>{
 for(const outcome of ['FAILED','CANCELLED','UNCERTAIN','',null])assert.equal(matchesTerminalBinding(base,{...base,outcome}),false);
 assert.equal(matchesTerminalBinding(base,{...base,outcome:'SUCCESS',extra:true}),false);
 assert.equal(matchesTerminalBinding({...base,generation:0},{...base,outcome:'SUCCESS'}),false);
 let accessed=false;const getter={...base,outcome:'SUCCESS'};Object.defineProperty(getter,'bindingDigest',{enumerable:true,get(){accessed=true;return base.bindingDigest;}});
 assert.equal(matchesTerminalBinding(base,getter),false);assert.equal(accessed,false);
 assert.equal(matchesTerminalBinding(base,new Proxy({...base,outcome:'SUCCESS'},{})),false);
});
