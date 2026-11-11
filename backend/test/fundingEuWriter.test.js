'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const eu=require('../../context/references/opportunity-v2/examples/eu-11145.json');
const {implementationDigest}=require('../src/opportunities/v2/activationArchive');
const writer=require('../src/fundingTenders/euWriter');
const mapping=()=>implementationDigest('EU_FUNDING_TENDERS',eu.provenance.mappingVersion);
function previous(){return {opportunityId:randomUUID(),revisionId:randomUUID(),rowVersion:5,lifecycleState:'ACTIVE',snapshot:structuredClone(eu),mappingDigest:mapping(),corrections:{},conflicts:[],resolutions:[]};}
test('EU writer policy accepts unchanged and safe changed existing v2 only',()=>{
 const accepted=previous(),snapshot=structuredClone(eu);
 assert.equal(writer.evaluateEuWriterPolicy({accepted,snapshot,mappingDigest:mapping()}).outcome,'UNCHANGED');
 snapshot.description.summary.value='Official factual update';
 const decision=writer.evaluateEuWriterPolicy({accepted,snapshot,mappingDigest:mapping()});
 assert.equal(decision.decision,'ACCEPTED');assert.equal(decision.outcome,'UPDATED');assert.deepEqual(decision.reasonCodes,[]);
});
test('new, v1, mapping drift, protected metadata and identity ambiguity produce durable-review decisions',()=>{
 const cases=[null,{...previous(),snapshot:{schemaVersion:1}}, {...previous(),mappingDigest:'a'.repeat(64)}, {...previous(),corrections:{title:{value:'Editorial'}}}, {...previous(),resolutions:[{resolution_id:randomUUID()}]}, {...previous(),conflicts:['title']}, {...previous(),lifecycleState:'ARCHIVED'}];
 for(const accepted of cases){const result=writer.evaluateEuWriterPolicy({accepted,snapshot:eu,mappingDigest:mapping()});assert.equal(result.decision,'REVIEW');assert(result.reasonCodes.length);}
 assert.equal(writer.evaluateEuWriterPolicy({accepted:previous(),snapshot:eu,mappingDigest:mapping(),identityConflict:true}).decision,'REVIEW');
});
test('financial losses, collection removal and conflicts never inherit automatic acceptance',()=>{
 for(const mutate of [s=>{s.description.summary={...s.description.summary,state:'NOT_FOUND',value:null,reason:'SOURCE_NOT_DECLARED'};},s=>{s.schedule.deadlines.value.pop();},s=>{s.description.summary={...s.description.summary,state:'CONFLICT',value:null,evidenceRefs:['summary','call-title'],reason:'OFFICIAL_CONFLICT'};}]){
  const snapshot=structuredClone(eu);mutate(snapshot);const result=writer.evaluateEuWriterPolicy({accepted:previous(),snapshot,mappingDigest:mapping()});assert.equal(result.decision,'REVIEW');assert(result.reasonCodes.length);
 }
});
test('writer configuration is a closed, versioned type1/type8 bundle and fails closed on drift',()=>{
 const config=writer.euWriterConfiguration();assert.equal(config.policyVersion,'eu-existing-v2.0');assert.match(config.mappingDigest,/^[a-f0-9]{64}$/);
 assert.deepEqual(writer.assertEuWriterConfiguration(config),config);
 for(const value of [null,{}, {...config,extra:true},{...config,policyVersion:'future'}, {...config,mappingDigest:'a'.repeat(64)}])assert.throws(()=>writer.assertEuWriterConfiguration(value));
});

test('EU writer composition requires all durable capabilities and cannot replace its real archive',()=>{
 const {createFundingRepository}=require('../src/fundingTenders/repository'),pool={connect:async()=>{throw Error('No database needed');}},euWriterV2=writer.euWriterConfiguration();
 assert.throws(()=>createFundingRepository({pool,euWriterV2}));
 const options={pool,euWriterV2,euSourceControlEnabled:true,coverageEnabled:true,startCoverage:true,refreshEnabled:true,resolutionEnabled:true,enrichmentEnabled:true};
 for(const flag of ['euSourceControlEnabled','coverageEnabled','startCoverage','refreshEnabled','resolutionEnabled','enrichmentEnabled'])assert.throws(()=>createFundingRepository({...options,[flag]:false}));
 assert.throws(()=>createFundingRepository({...options,candidateArchive:{stage(){},verify(){}}}));
 const repository=createFundingRepository(options);assert.equal(repository.euWriterSupported,true);assert.equal(repository.euWriterMappingDigest,euWriterV2.mappingDigest);
});
test('a persisted canonical run cannot fall back to the legacy writer after restart',async()=>{
 const {createFundingRepository}=require('../src/fundingTenders/repository');const queries=[],row={run_id:randomUUID(),source_code:'EU_FUNDING_TENDERS',status:'QUEUED',requested_by:randomUUID(),eu_writer_mode:'CANONICAL_V2',eu_writer_policy:'eu-existing-v2.0',eu_writer_mapping_digest:writer.euWriterConfiguration().mappingDigest};
 const client={release(){},async query(sql){queries.push(sql);if(sql.startsWith('SELECT * FROM opportunity_catalog.funding_run'))return {rows:[row]};if(sql.includes('public.global_user')||sql.includes('public.platform_admin_assignment'))return {rows:[{}]};return {rows:[],rowCount:1};}};
 const repo=createFundingRepository({pool:{connect:async()=>client}});
 await assert.rejects(repo.claim(row.run_id),{code:'OPPORTUNITY_V2_EU_WRITER_MODE_MISMATCH'});
 assert.equal(queries.some(sql=>sql.startsWith('UPDATE')),false);
});
test('canonical lookup diagnostics never change accepted metadata or retain a legacy resolution',async()=>{
 const refresh=require('../src/fundingTenders/refresh'),queries=[];
 const client={async query(sql){queries.push(sql);return {rowCount:1,rows:[]};}};
 const run={run_id:randomUUID(),checkpoint:{cycle_id:randomUUID(),input_cursor:{phase:'KNOWN',externalIdentifier:'CASCADE:11145'}}};
 assert.deepEqual(await refresh.stage(client,run,{outcome:'CONFLICT',received:2,observedAt:'2026-10-31T12:00:00.000Z'},{canonicalV2:true}),[]);
 assert.equal(queries.some(sql=>sql.includes('UPDATE opportunity_catalog.funding_identity')),false);
});
test('review completion is terminal, visible as partial and counted separately from accepted changes',async()=>{
 const detail=require('../src/fundingTenders/discoveryDetails'),queries=[],row={run_id:randomUUID(),eu_writer_mode:'CANONICAL_V2',status:'SUCCESS',created_count:0,updated_count:0,unchanged_count:0,failed_count:0,review_count:1};
 const client={async query(sql,p){queries.push([sql,p]);if(sql.startsWith('UPDATE opportunity_catalog.funding_cycle'))return {rowCount:1,rows:[{}]};return {rowCount:0,rows:[]};}};
 await detail.finish(client,row,{cycle_id:randomUUID(),input_cursor:{phase:detail.PHASE}},async()=>{throw Error('No successor');},{enrichmentEnabled:true});
 assert.match(queries[0][0],/review_count=review_count\+/);assert.equal(queries[0][1].at(-1),1);
 assert.match(detail.requiresReviewSql,/i\.result='REVIEW'/);
 assert.match(queries.at(-1)[0],/'REVIEW'/);
});
test('known canonical identities are refreshed even without legacy metadata, with exact programme selection',async()=>{
 const queries=[],client={async query(sql,p){queries.push([sql,p]);return {rowCount:1,rows:[]};}};
 await require('../src/fundingTenders/refresh').start(client,randomUUID(),'ERASMUS',{canonicalV2:true});
 assert(queries.some(([sql,p])=>sql.includes('source_identity_v2')&&sql.includes("'EU_FRAMEWORK_PROGRAMME'")&&p[2].includes('43353764')));
 assert(queries.filter(([sql])=>sql.includes('INSERT INTO opportunity_catalog.funding_refresh_target'))
  // The legacy-compatible selection reads the column tolerantly (no v2 package installed).
  .every(([sql])=>sql.includes('o.current_schema_version=2')||sql.includes("to_jsonb(o)->>'current_schema_version'='2'")));
});
test('public review counters do not inflate accepted results or count deferred known records twice',()=>{
 const {publicRun}=require('../src/fundingTenders/repository');
 const run=publicRun({review_count:1,cycle_reviewed:2,cycle_status:'PARTIAL',cycle_created:0,cycle_updated:0,cycle_unchanged:1,cycle_failed:0,unique_count:5,invalid_count:0,known_refresh:{DISCOVERY_DEFERRED:2,REVIEW:1}});
 assert.equal(run.reviewed,3);assert.equal(run.created,0);assert.equal(run.updated,0);assert.equal(run.coverage.pending,0);
});
test('worker passes actual inbox execution authority through every repository step and publishes exact writer capability',async()=>{
 const {createFundingWorker}=require('../src/fundingTenders/worker'),calls=[],config=writer.euWriterConfiguration();
 const run={run_id:randomUUID(),source_code:'EU_FUNDING_TENDERS'},repository={euWriterSupported:true,euWriterPolicyVersion:config.policyVersion,euWriterMappingDigest:config.mappingDigest,transaction(){throw Error('Unused');},async claim(id,ctx){calls.push(ctx);return run;},async stage(r,b,ctx){calls.push(ctx);},async pending(r,ctx){calls.push(ctx);return [{}];},async apply(r,i,ctx){calls.push(ctx);},async finish(r,code,ctx){assert.equal(code,null);calls.push(ctx);}};
 const worker=createFundingWorker({pool:{},queue:{shutdown:async()=>{},claim:async()=>[]},source:{collect:async()=>({})},repository});
 const executionId=randomUUID(),handler=worker.registry.resolve('funding_tenders.refresh').handler;
 await handler({executionId,payload:{runId:run.run_id},fencingToken:7});
 assert.equal(calls.length,5);for(const context of calls){assert.equal(context.executionId,executionId);assert.equal(context.inboxFence,7);assert.match(context.workerId,/^funding-/);assert.equal(context.consumer,'funding-central-v1');}
 assert.equal(worker.health().euWriterMappingDigest,config.mappingDigest);
});
test('canonical retry release uses the protected helper and refuses an inbox owned by another worker',async()=>{
 const {createFundingRepository}=require('../src/fundingTenders/repository'),config=writer.euWriterConfiguration(),runId=randomUUID(),executionId=randomUUID(),queries=[];
 const row={run_id:runId,source_code:'EU_FUNDING_TENDERS',eu_writer_mode:'CANONICAL_V2',eu_writer_policy:config.policyVersion,eu_writer_mapping_digest:config.mappingDigest,eu_source_fence:4,fence:2};let owned=false;
 const client={async query(sql,p){queries.push(sql);if(sql.startsWith('SELECT * FROM opportunity_catalog.funding_run'))return {rows:[row]};if(sql.includes('FROM async_exec.inbox'))return {rows:owned?[{fence:3}]:[]};if(sql.includes("current_setting('role')"))return {rows:[{role:'none'}]};if(sql.includes('release_eu_writer_retry_v2'))return {rows:[{permit:{runId,runFence:2,sourceFence:4,executionId,inboxFence:3,policyVersion:config.policyVersion,mappingDigest:config.mappingDigest}}]};return {rows:[]};}};
 const repo=createFundingRepository({pool:{connect(){throw Error('Nested checkout');}},euWriterV2:config,euSourceControlEnabled:true,coverageEnabled:true,refreshEnabled:true,resolutionEnabled:true,enrichmentEnabled:true});
 const envelope={payload:{runId},executionId,idempotencyKey:runId};
 await assert.rejects(repo.releaseRetry(client,envelope,'worker-one'),{code:'OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED'});
 owned=true;await repo.releaseRetry(client,envelope,'worker-one');
 assert(queries.some(sql=>sql.includes('release_eu_writer_retry_v2')));assert.equal(queries.some(sql=>sql.startsWith('UPDATE')),false);
});
