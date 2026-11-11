'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAcceptedOpportunityV2Repository,command}=require('../src/opportunities/v2/acceptedRepository');
const eu=require('../../context/references/opportunity-v2/examples/eu-11145.json');
const input=()=>({requestId:'isolated-acceptance-1',candidateId:'normative-eu-11145',snapshot:structuredClone(eu),mappingDigest:'a'.repeat(64),expected:null});
function fixture(overrides={}){
 const calls=[];let released=0,connected=0;
 const client={query:async(sql,params)=>{calls.push({sql,params});return {rows:[],rowCount:0};},release(){released++;}};
 const pool={async connect(){connected++;return client;}};
 const repo=createAcceptedOpportunityV2Repository({pool,authorize:async()=>true,verifyApproval:async()=>true,audit:async()=>{},...overrides});
 return {repo,calls,get connected(){return connected;},get released(){return released;}};
}
test('accepted v2 adapter cannot be composed without explicit central authority, approval and transactional audit ports',()=>{
 const ports={pool:{connect:async()=>{}},authorize:async()=>true,verifyApproval:async()=>true,audit:async()=>{}};
 for(const key of Object.keys(ports)){const missing={...ports};delete missing[key];assert.throws(()=>createAcceptedOpportunityV2Repository(missing),TypeError);}
});
test('acceptance command is closed, exact and leaves the source snapshot untouched',()=>{
 const original=input(),result=command(original);assert.deepEqual(result.snapshot,original.snapshot);assert.ok(Object.isFrozen(result.snapshot));assert.equal(Object.isFrozen(original.snapshot),false);
 assert.throws(()=>command({...original,organizationId:'tenant'}),{code:'OPPORTUNITY_V2_INVALID_COMMAND'});
 assert.throws(()=>command({...original,expected:{opportunityId:'bad',revisionId:'bad',rowVersion:0}}),{code:'OPPORTUNITY_V2_INVALID_COMMAND'});
 assert.throws(()=>command(original,{approval:true}),{code:'OPPORTUNITY_V2_APPROVAL_REQUIRED'});
 let read=false;const hostile=input();Object.defineProperty(hostile,'approvalDigest',{enumerable:true,get(){read=true;return 'a'.repeat(64);}});
 assert.throws(()=>command(hostile));assert.equal(read,false);
});
test('invalid source money is rejected before opening a database transaction',async()=>{
 const f=fixture(),value=input();value.snapshot.financing.allocations.value[0].money.amount='120000.000000001';
 await assert.rejects(f.repo.accept({...value,approvalDigest:'b'.repeat(64)},{}));assert.equal(f.connected,0);
});
test('central authority denial prevents preview or acceptance reads and rolls back',async()=>{
 const f=fixture({authorize:async()=>false});await assert.rejects(f.repo.preview(input(),{}),{code:'OPPORTUNITY_V2_AUTHORITY_DENIED'});
 assert.deepEqual(f.calls.map(c=>c.sql),['BEGIN','SET LOCAL ROLE c4g_opportunity_central_runtime','ROLLBACK']);assert.equal(f.released,1);
});
test('a reviewed digest cannot authorize changed candidate bytes and produces no writes',async()=>{
 let approvalCalls=0;const f=fixture({verifyApproval:async()=>{approvalCalls++;return true;}}),value=input();
 const preview=await f.repo.preview(value,{});value.snapshot.description.summary.value='Changed after review';
 await assert.rejects(f.repo.accept({...value,approvalDigest:preview.previewDigest},{}),{code:'OPPORTUNITY_V2_APPROVAL_STALE'});
 assert.equal(approvalCalls,0);assert.equal(f.calls.some(c=>/^INSERT|^UPDATE/.test(c.sql)),false);assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.equal(f.released,2);
});
test('source identities already owned by another accepted record cannot create a duplicate opportunity',async()=>{
 const calls=[],client={release(){},async query(sql){calls.push(sql);return {rows:sql.includes('FROM opportunity_catalog.source_identity_v2')?[{opportunity_id:'01900000-0000-7000-8000-000000000001'}]:[]};}};
 const repo=createAcceptedOpportunityV2Repository({pool:{connect:async()=>client},authorize:async()=>true,verifyApproval:async()=>true,audit:async()=>{}});
 await assert.rejects(repo.preview(input(),{}),{code:'OPPORTUNITY_V2_STALE_REVISION'});assert.equal(calls.some(sql=>/^INSERT/.test(sql)),false);
});

test('same-transaction acceptance rechecks concrete ports and never obtains another connection or commits its caller',async()=>{
 const value={...input(),approvalDigest:'b'.repeat(64)},calls=[];let authorities=0,approvals=0;
 const {createHash}=require('node:crypto'),{canonicalize}=require('../src/organizationalProfile/canonicalization');
 const expected={opportunityId:'01900000-0000-7000-8000-000000000001',action:'UNCHANGED'};
 const client={async query(sql){calls.push(sql);return {rows:sql.includes('accepted_receipt_v2')?[{intent_digest:createHash('sha256').update(canonicalize(value)).digest('hex'),result:expected}]:[]};}};
 const repo=createAcceptedOpportunityV2Repository({pool:{connect(){throw Error('Nested checkout forbidden');}},authorize:async actual=>{assert.equal(actual,client);authorities++;return true;},verifyApproval:async actual=>{assert.equal(actual,client);approvals++;return true;},audit:async()=>{throw Error('Replay must not audit again');}});
 assert.deepEqual(await repo.acceptInTransaction(client,value,{}),expected);assert.equal(authorities,2);assert.equal(approvals,1);
 assert.equal(calls.some(sql=>/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL ROLE)/.test(sql)),false);
});
