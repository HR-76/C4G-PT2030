'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {mergeSource}=require('../src/fundingTenders/merge');
const firstTime='2026-10-29T00:00:00.000Z',laterTime='2026-10-29T01:00:00.000Z';
const enrichment=(observedAt=firstTime,text='Published condition')=>({schemaVersion:1,mappingVersion:'eu-framework-2026-10-29',observedAt,fields:Object.fromEntries(['programme','instrument','budget','support','rate','territories','beneficiaries','consortium','conditions','documents','submission'].map(key=>[key,key==='conditions'?{status:'PUBLISHED',items:[{value:{text},evidence:{url:'https://ec.europa.eu/call',locator:'conditions',excerpt:text,observedAt}}],truncated:false}:{status:'NOT_FOUND',items:[],truncated:false}]))});
const core=()=>({title:'Published title',funderName:'European Commission',callReference:'KNOWN',officialUrl:'https://ec.europa.eu/call',closingDate:'2026-09-22',sourceTemporal:{status:'CLOSED',deadlines:['2026-09-22'],openings:[]}});
const snapshot=fields=>({schemaVersion:1,...fields,provenanceId:randomUUID(),lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1'});

test('unconsulted enrichment survives source merging without an invented manual correction',()=>{
 const previousSource={...core(),sourceEnrichment:enrichment()},current=structuredClone(previousSource);
 const result=mergeSource({previousSource,current,incoming:core()});
 assert.deepEqual(result.fields,current);assert.deepEqual(result.corrections,{});assert.equal(result.sourceChanged,false);assert.equal(result.effectiveChanged,false);
 assert.deepEqual(result.sourceFields,previousSource);
});
test('repeated facts retain their first observation and material changes preserve manual fields',()=>{
 const previousSource={...core(),sourceEnrichment:enrichment()},current={...previousSource,title:'Manual title'};
 const repeated=mergeSource({previousSource,current,incoming:{...core(),sourceEnrichment:enrichment(laterTime)}});
 assert.equal(repeated.sourceChanged,false);assert.equal(repeated.effectiveChanged,false);assert.deepEqual(repeated.sourceFields.sourceEnrichment,previousSource.sourceEnrichment);
 const changed=mergeSource({previousSource,current,incoming:{...core(),sourceEnrichment:enrichment(laterTime,'Changed published condition')}});
 assert.equal(changed.sourceChanged,true);assert.equal(changed.fields.title,'Manual title');assert.equal(changed.fields.sourceEnrichment.fields.conditions.items[0].value.text,'Changed published condition');
});
test('explicit manual enrichment survives incoming source updates and unconsulted refreshes',()=>{
 const previousSource={...core(),sourceEnrichment:enrichment()},manual=enrichment(firstTime,'Human correction'),current={...previousSource,sourceEnrichment:manual};
 const changed=mergeSource({previousSource,current,incoming:{...core(),sourceEnrichment:enrichment(laterTime,'Provider update')}});
 assert.deepEqual(changed.fields.sourceEnrichment,manual);assert.deepEqual(changed.conflicts,['sourceEnrichment']);
 const unconsulted=mergeSource({previousSource:changed.sourceFields,current:changed.fields,incoming:core(),corrections:changed.corrections});
 assert.deepEqual(unconsulted.fields.sourceEnrichment,manual);assert.equal(unconsulted.sourceChanged,false);assert.equal(unconsulted.effectiveChanged,false);
});
test('enrichment discovery defers every new identity until its complete known lookup',async()=>{
 const {discovered}=require('../src/fundingTenders/refresh');const targets=new Set(['OLD']),seen=new Set(),calls=[];
 const client={async query(sql,p){calls.push(sql);if(sql.startsWith('INSERT INTO opportunity_catalog.funding_cycle_seen')){for(const id of p[1])seen.add(id);return {rowCount:p[1].length,rows:[]};}if(sql.startsWith('UPDATE opportunity_catalog.funding_refresh_target'))return {rows:p[1].filter(id=>targets.has(id)).map(external_identifier=>({external_identifier})),rowCount:p[1].length};throw Error(sql);}};
 const records=['OLD','NEW'].map(externalIdentifier=>({externalIdentifier,fields:core()}));
 assert.deepEqual(await discovered(client,{cycle_id:randomUUID()},records,{enrichmentEnabled:true}),[]);
 assert.ok(seen.has('NEW'));assert.equal(targets.has('NEW'),false);
 assert.equal(calls.some(sql=>sql.startsWith('INSERT INTO opportunity_catalog.funding_refresh_target')),false);
});

function fixture({resolved=false,fields=core(),enrichmentEnabled=true}={}){
 const id='KNOWN',opportunityId=randomUUID(),run={run_id:randomUUID(),fence:1,checkpoint:{input_cursor:{phase:'KNOWN',externalIdentifier:id}}};
 const identity={external_identifier:id,opportunity_id:opportunityId,last_source_fields:structuredClone(fields),corrections:{}};
 const previous={current_revision_id:randomUUID(),row_version:1,lifecycle_state:'ACTIVE',validation_state:'PENDING_REVIEW',snapshot:snapshot(structuredClone(fields))};
 const {buildEvidence}=require('../src/fundingTenders/sourceEvidence');
 const evidence=buildEvidence(id,[{content:'Published title',metadata:{identifier:[id],type:['1'],status:['31094503'],frameworkProgramme:['43108390'],language:['en'],DATASOURCE:['SEDIA'],ccm2Id:['123'],callccm2Id:['123'],deadlineDate:['2026-09-22']}}]);
 const resolution={schemaVersion:1,resolutionId:randomUUID(),decidedAt:firstTime,sourceFingerprint:evidence.fingerprint,reason:'Reviewed',note:'Original decision',sources:[{url:'https://ec.europa.eu/call',title:'Call'}]};
 if(resolved)previous.snapshot.sourceResolution=resolution;
 const archive={resolution_id:resolution.resolutionId,source_fingerprint:evidence.fingerprint,evidence,external_identifier:id,opportunity_id:opportunityId};
 let stored={external_identifier:id,source_fields:structuredClone(fields),source_resolution_id:resolved?resolution.resolutionId:null};
 const state={commands:[],queries:[],observations:[]};
 const row={...run,requested_by:randomUUID(),source_code:'EU_FUNDING_TENDERS',observed_at:laterTime};
 const client={release(){},async query(sql,p){state.queries.push([sql,p]);
  if(sql.includes('FROM public.global_user')||sql.includes('FROM public.platform_admin_assignment'))return {rows:[{id:row.requested_by}],rowCount:1};
  if(sql.startsWith('SELECT * FROM opportunity_catalog.funding_run WHERE'))return {rows:[row],rowCount:1};
  if(sql.startsWith('SELECT * FROM opportunity_catalog.funding_batch WHERE'))return {rows:[run.checkpoint],rowCount:1};
  if(sql.startsWith('SELECT * FROM opportunity_catalog.funding_run_item'))return {rows:[stored],rowCount:1};
  if(sql.startsWith('SELECT * FROM opportunity_catalog.funding_identity'))return {rows:[identity],rowCount:1};
  if(sql.startsWith('SELECT o.*,r.snapshot'))return {rows:[previous],rowCount:1};
  if(sql.includes('FROM opportunity_catalog.funding_resolution'))return {rows:[archive],rowCount:1};
  if(sql.startsWith('INSERT INTO opportunity_catalog.funding_identity')){identity.last_source_fields=structuredClone(p[2]);identity.corrections=structuredClone(p[3]);}
  if(sql.startsWith('INSERT INTO opportunity_catalog.funding_observation'))state.observations.push(structuredClone(p));
  if(sql.startsWith('UPDATE opportunity_catalog.funding_run_item SET result='))stored.result=p[2];
  return {rows:[],rowCount:1};
 }};
 const catalog={withTransactionClient:async(c,work)=>work(),async update(command){state.commands.push(structuredClone(command));previous.snapshot=structuredClone(command.snapshot);previous.current_revision_id=randomUUID();previous.row_version++;return {opportunityId,revisionId:previous.current_revision_id};}};
 const {createFundingRepository}=require('../src/fundingTenders/repository');
 const repository=createFundingRepository({pool:{connect:async()=>client},catalog,audit:async()=>{},coverageEnabled:true,refreshEnabled:true,resolutionEnabled:true,enrichmentEnabled});
 return {id,identity,previous,archive,evidence,resolution,row,run,state,repository,stage(fields){stored={external_identifier:id,source_fields:structuredClone(fields),source_resolution_id:resolved?resolution.resolutionId:null};return stored;},apply(){return repository.apply(run,stored);}};
}
test('persisted facts create a revision once and operational observations remain current',async()=>{
 const f=fixture(),old=structuredClone(f.previous.snapshot);f.stage({...core(),sourceEnrichment:enrichment()});await f.apply();
 assert.equal(f.state.commands.length,1);assert.equal(old.sourceEnrichment,undefined);assert.deepEqual(f.previous.snapshot.sourceEnrichment,enrichment());
 f.stage({...core(),sourceEnrichment:enrichment(laterTime)});await f.apply();
 assert.equal(f.state.commands.length,1);assert.deepEqual(f.identity.last_source_fields.sourceEnrichment,enrichment());assert.equal(f.state.observations.at(-1)[4],laterTime);
 f.stage({...core(),sourceEnrichment:enrichment(laterTime,'Changed')});await f.apply();assert.equal(f.state.commands.length,2);
});
test('disabled or missing detail preserves existing enrichment and unrelated manual snapshot fields',async()=>{
 const f=fixture({fields:{...core(),sourceEnrichment:enrichment()},enrichmentEnabled:false});f.previous.snapshot.summary='Human summary';f.identity.corrections.summary='Human summary';
 f.stage(core());await f.apply();assert.equal(f.state.commands.length,0);assert.deepEqual(f.identity.last_source_fields.sourceEnrichment,enrichment());assert.equal(f.previous.snapshot.summary,'Human summary');
});
test('resolved staging recalculates only enrichment from complete identical evidence',async()=>{
 const {retainResolution}=require('../src/fundingTenders/resolutions');const f=fixture({resolved:true});
 const row={...f.archive,last_source_fields:f.identity.last_source_fields,snapshot:f.previous.snapshot};
 const client={query:async()=>({rows:[row]})},batch={outcome:'CONFLICT',received:1,observedAt:laterTime,evidence:f.evidence};
 const retained=await retainResolution(client,f.id,batch,{enrichmentEnabled:true});assert.equal(retained.outcome,'FOUND');assert.ok(retained.record.fields.sourceEnrichment);
 const {sourceEnrichment,...unchanged}=retained.record.fields;assert.deepEqual(unchanged,f.identity.last_source_fields);assert.equal(retained.record.sourceResolutionId,f.resolution.resolutionId);
 const {buildEvidence}=require('../src/fundingTenders/sourceEvidence');const changed=structuredClone(f.evidence.variants);changed[0].content='New conditions';
 assert.equal((await retainResolution(client,f.id,{...batch,evidence:buildEvidence(f.id,changed)},{enrichmentEnabled:true})).outcome,'CONFLICT');
});
test('resolved apply rederives its allowed overlay from archived evidence and preserves the decision',async()=>{
 const f=fixture({resolved:true}),{extractEnrichment}=require('../src/fundingTenders/enrichment'),expected=extractEnrichment(f.evidence.variants,{externalIdentifier:f.id,observedAt:laterTime});
 f.stage({...core(),sourceEnrichment:expected});await f.apply();assert.equal(f.state.commands.length,1);assert.deepEqual(f.previous.snapshot.sourceResolution,f.resolution);
 assert.deepEqual(f.previous.snapshot.sourceTemporal,core().sourceTemporal);
 f.stage({...core(),sourceEnrichment:expected});await f.apply();assert.equal(f.state.commands.length,1);
});
test('forged resolved enrichment, different core, archive and staged timestamps cannot pass the durable guard',async()=>{
 for(const mode of ['enrichment','core','evidence','timestamp','binding']){
  const f=fixture({resolved:true}),{extractEnrichment}=require('../src/fundingTenders/enrichment');
  const fields={...core(),sourceEnrichment:structuredClone(extractEnrichment(f.evidence.variants,{externalIdentifier:f.id,observedAt:laterTime}))};
  if(mode==='enrichment')fields.sourceEnrichment=enrichment(laterTime,'Invented support');
  if(mode==='core')fields.closingDate='2030-01-01';
  if(mode==='evidence')f.archive.evidence={...f.evidence,fingerprint:'f'.repeat(64)};
  if(mode==='timestamp')fields.sourceEnrichment.observedAt=firstTime;
  const item=f.stage(fields);if(mode==='binding')item.source_resolution_id=randomUUID();
  await assert.rejects(f.apply(),{code:'FUNDING_RESOLUTION_REQUIRES_LOOKUP'},mode);assert.equal(f.state.commands.length,0,mode);
 }
});
