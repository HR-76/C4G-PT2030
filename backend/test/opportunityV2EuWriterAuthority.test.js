'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEuWriterAuthorityV2,WRITER_POLICY,WRITER_MODE}=require('../src/opportunities/v2/euWriterAuthority');
const {sourceState,createEuSourceControlV2}=require('../src/opportunities/v2/euSourceControl');
const id='01900000-0000-7000-8000-000000000001',other='01900000-0000-7000-8000-000000000002',sha='a'.repeat(64);
const context={runId:id,runFence:2,sourceFence:5,executionId:id,inboxFence:3,workerId:'worker-eu-test',consumer:'funding-central-v1'};
const scope={externalIdentifier:'CASCADE:11145',payloadDigest:sha,opportunityId:id,revisionId:other,rowVersion:5,decision:'ACCEPTED'};
test('EU service authority rejects caller fabricated permits, wrong clients and malformed worker scope',async()=>{
 const calls=[],client={async query(sql,args){calls.push({sql,args});if(sql.includes('current_setting'))return{rows:[{role:'none'}]};return{rows:[{permit:{permitId:id,runId:id,sourceFence:5,policyVersion:WRITER_POLICY,mappingDigest:sha,opportunityId:id}}]};}};
 const authority=createEuWriterAuthorityV2({policyVersion:WRITER_POLICY,mappingDigest:sha});
 await assert.rejects(authority.assertCurrent(client,{permitId:id}),{code:'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'});
 for(const bad of [{...context,runFence:'2'},{...context,consumer:'tenant-worker'},{...context,actor:{type:'SERVICE',id:'FUNDING_TENDERS_CENTRAL'}}])await assert.rejects(authority.authorize(client,bad,scope),{code:'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'});
 assert.equal(calls.length,0);
 const permit=await authority.authorize(client,context,scope);assert(Object.isFrozen(permit));
 await assert.rejects(authority.assertCurrent({query:client.query},permit),{code:'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'});
 assert.equal(calls.filter(x=>x.sql.includes('begin_eu_writer_v2')).length,1);
});
test('EU service commit check is persisted and failures expose only bounded codes',async()=>{
 let deny=false;const client={async query(sql){if(sql.includes('current_setting'))return{rows:[{role:'none'}]};if(deny)throw Object.assign(Error('private SQL connection detail'),{code:'P0001'});return{rows:[{permit:{permitId:id,runId:id,sourceFence:5,policyVersion:WRITER_POLICY,mappingDigest:sha,opportunityId:id}}]};}};
 const authority=createEuWriterAuthorityV2({policyVersion:WRITER_POLICY,mappingDigest:sha}),permit=await authority.authorize(client,context,scope);deny=true;
 await assert.rejects(authority.assertCurrent(client,permit),{code:'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED',message:'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'});
});
test('canonical source resume requires explicit matching capability while legacy baseline stays compatible',async()=>{
 const state={family:'EU_FUNDING_TENDERS',state:'QUIESCED',fence:5,queuedRuns:0,pendingRuns:0,otherPendingRuns:0,activeRunLeases:0,activeOutboxLeases:0,activeInboxLeases:0,expiredPendingRuns:0,unrecoverablePendingRuns:0,acceptedV2:1,writerMode:WRITER_MODE,writerPolicy:WRITER_POLICY,writerMappingDigest:sha,incompatiblePendingRuns:0};
 const client={query:async()=>({rows:[{state}]})},capability={mode:WRITER_MODE,policyVersion:WRITER_POLICY,mappingDigest:sha};
 assert.equal((await sourceState(client)).canResume,false);
 assert.equal((await sourceState(client,capability)).canResume,false,'declared capability without current worker health is insufficient');
 assert.equal((await sourceState(client,capability,true)).canResume,true);
 assert.equal((await sourceState(client,{...capability,mappingDigest:'b'.repeat(64)},true)).canResume,false);
 state.incompatiblePendingRuns=1;assert.equal((await sourceState(client,capability)).canResume,false);
});
test('service execution and claim use dedicated role then restore the transaction role',async()=>{
 const calls=[],proof={runId:id,runFence:2,sourceFence:5,executionId:id,inboxFence:3,policyVersion:WRITER_POLICY,mappingDigest:sha};
 const client={async query(sql,args){calls.push({sql,args});if(sql.includes('current_setting'))return{rows:[{role:'c4g_opportunity_central_runtime'}]};if(sql.includes('claim_eu_writer_run'))return{rows:[{permit:{run_id:id,status:'RUNNING',fence:2,eu_source_fence:5,eu_writer_mode:WRITER_MODE,eu_writer_policy:WRITER_POLICY,eu_writer_mapping_digest:sha}}]};return{rows:[{permit:proof}]};}};
 const authority=createEuWriterAuthorityV2({policyVersion:WRITER_POLICY,mappingDigest:sha});
 assert.equal((await authority.assertExecution(client,context)).actor.type,'SERVICE');
 assert.equal(calls.at(-1).sql,'SET LOCAL ROLE c4g_opportunity_central_runtime');
 const {runFence,...claim}=context;assert.equal((await authority.claimRun(client,claim)).fence,2);
 assert.equal(calls.at(-1).sql,'SET LOCAL ROLE c4g_opportunity_central_runtime');
 await assert.rejects(authority.claimRun(client,context),{code:'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'});
 assert.equal(await authority.releaseRetry(client,context),true);
 assert(calls.some(c=>c.sql.includes('release_eu_writer_retry_v2')));
 assert.equal(calls.at(-1).sql,'SET LOCAL ROLE c4g_opportunity_central_runtime');
});
test('configuring canonical source cannot proceed without an exact live worker capability',async()=>{
 let touched=false;const pool={async connect(){touched=true;throw Error('must not connect');}};
 const options={pool,policyVersion:'test-policy',recentMfaRequirement:{mfa:false,maxAgeSeconds:900,acceptedAcr:[],acceptedAmr:[],amrMode:'any'},euWriterCapability:{policyVersion:WRITER_POLICY,mappingDigest:sha}};
 for(const health of [null,{ready:true},{ready:true,euWriterSupported:true,euWriterPolicyVersion:WRITER_POLICY,euWriterMappingDigest:'b'.repeat(64)}]){
  const control=createEuSourceControlV2({...options,workerHealth:async()=>health});
  await assert.rejects(control.configureWriter({requestId:'writer-configure',expectedFence:3},{actor:{type:'HUMAN',id},sessionId:'session-test'}),{code:'OPPORTUNITY_V2_EU_WRITER_UNAVAILABLE'});
 }
 assert.equal(touched,false);
});
