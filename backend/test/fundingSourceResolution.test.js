'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {validateSnapshot}=require('../src/opportunities/contracts');
const metadata=()=>({schemaVersion:1,resolutionId:randomUUID(),decidedAt:'2026-10-28T23:00:00.000Z',sourceFingerprint:'a'.repeat(64),reason:'Reviewed official timetable',note:'Current session closed; certification may have later sessions.',sources:[{url:'https://youth.europa.eu/guide.pdf',title:'Official guide',locator:'Page 73'}]});
const snapshot=()=>({schemaVersion:1,title:'Preserved title',funderName:'European Commission',provenanceId:randomUUID(),lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1'});
test('public source resolution survives snapshot validation without exposing actor or raw evidence',()=>{
 const m=metadata();assert.deepEqual(validateSnapshot({...snapshot(),sourceResolution:m}).sourceResolution,m);
 for(const extra of [{actorId:randomUUID()},{evidence:{variants:[]}},{sources:[{url:'javascript:alert(1)',title:'Unsafe'}]},{sources:[]},{sourceFingerprint:'invented'}])assert.throws(()=>validateSnapshot({...snapshot(),sourceResolution:{...m,...extra}}));
});
test('resolution temporal overlay preserves unrelated fields and rejects existing manual temporal corrections',()=>{
 const {resolvedSnapshot}=require('../src/fundingTenders/resolutions');
 const s={...snapshot(),summary:'Human summary',fundingAmountMin:'100',fundingAmountMax:'200',currencyCode:'EUR',closingDate:'2021-09-22'};
 const row={snapshot:s,last_source_fields:{title:'Original title',closingDate:'2021-09-22'},corrections:{title:'Preserved title'}};
 const decision={fields:{closingDate:'2026-09-22',sourceTemporal:{status:'CLOSED',deadlines:['2026-09-22T17:00:00+02:00'],openings:[]}}};
 const out=resolvedSnapshot(row,decision,metadata());
 for(const key of ['title','summary','fundingAmountMin','fundingAmountMax','currencyCode','validationState'])assert.deepEqual(out[key],s[key]);
 assert.equal(out.closingDate,'2026-09-22');
 assert.throws(()=>resolvedSnapshot({...row,corrections:{closingDate:'2021-09-22'}},decision,metadata()),{code:'FUNDING_RESOLUTION_MANUAL_CONFLICT'});
 assert.throws(()=>resolvedSnapshot({...row,snapshot:{...s,closingDate:'2028-01-01'}},decision,metadata()),{code:'FUNDING_RESOLUTION_MANUAL_CONFLICT'});
});
function fixture(){
 const {IDS,createResolutionService}=require('../src/fundingTenders/resolutions');
 const {buildEvidence}=require('../src/fundingTenders/sourceEvidence');
 const userId=randomUUID();
 const decisions=IDS.map((id,index)=>{
  const variants=['31094502','31094503'].map(status=>({metadata:{identifier:[id],type:['1'],status:[status],callccm2Id:['123'],ccm2Id:[String(index+100)],language:['en'],DATASOURCE:[status==='31094502'?'SEDIA_PRD_CENTRICITY':'SEDIA'],deadlineDate:['2026-09-22']}}));
  const evidence=buildEvidence(id,variants);
  return {externalIdentifier:id,evidence,expectedFingerprint:evidence.fingerprint,fields:{closingDate:'2026-09-22',sourceTemporal:{status:'CLOSED',deadlines:['2026-09-22T17:00:00+02:00'],openings:[]}},reason:'Reviewed documents',note:'Session ended.',sources:metadata().sources};
 });
 let state={rows:decisions.map(d=>({external_identifier:d.externalIdentifier,opportunity_id:randomUUID(),current_revision_id:randomUUID(),row_version:1,snapshot:{...snapshot(),closingDate:'2021-09-22'},last_source_fields:{title:'Preserved title',closingDate:'2021-09-22'},corrections:{},source_review:'CONFLICT'})),archive:[],commands:[],audits:[],busy:false,revoked:false};
 let lookups=0,transform=batch=>batch,failAuditAt=null;
 const client={async query(sql,p=[]){
  if(sql.includes('SELECT * FROM opportunity_catalog.funding_resolution'))return {rows:structuredClone(state.archive.filter(r=>r.request_id===p[0]))};
  if(sql.includes('SELECT f.*,o.current_revision_id'))return {rows:state.rows.map(row=>{const active=state.archive.find(r=>r.resolution_id===row.snapshot.sourceResolution?.resolutionId);return structuredClone({...row,decision_digest:active?.decision_digest||null,active_resolution_id:active?.resolution_id||null,applied_revision_id:active?.applied_revision_id||null});})};
  if(sql.startsWith('SELECT run_id'))return {rows:state.busy?[{}]:[]};
  if(sql.startsWith('INSERT INTO opportunity_catalog.funding_resolution')){const keys=['resolution_id','request_id','batch_digest','command_digest','decision_digest','external_identifier','opportunity_id','previous_revision_id','applied_revision_id','source_fingerprint','evidence','decision','decided_by','decided_at'];state.archive.push(Object.fromEntries(keys.map((k,i)=>[k,structuredClone(p[i])])));return {rowCount:1,rows:[]};}
  if(sql.startsWith('UPDATE opportunity_catalog.funding_identity')){const row=state.rows.find(r=>r.external_identifier===p[0]);row.last_source_fields=structuredClone(p[1]);row.source_review=null;return {rowCount:1,rows:[]};}
  if(sql==='RESET ROLE'||sql.includes('pg_advisory_xact_lock'))return {rows:[]};
  throw new Error('Unexpected SQL: '+sql);
 }};
 const repository={resolutionSupported:true,async transaction(work){const before=structuredClone(state);try{return await work(client);}catch(error){state=before;throw error;}},async administrator(){if(state.revoked)throw Object.assign(new Error('revoked'),{code:'FUNDING_FORBIDDEN'});}};
 const catalog={async withTransactionClient(c,work){assert.equal(c,client);return work();},async update(command,context){assert.equal(context.actor.type,'HUMAN');assert.equal(command.provenance.sourceType,'C4G_MANUAL');state.commands.push(structuredClone(command));const row=state.rows.find(r=>r.opportunity_id===command.opportunityId),revisionId=randomUUID();row.snapshot=structuredClone(command.snapshot);row.current_revision_id=revisionId;row.row_version++;return {opportunityId:row.opportunity_id,revisionId};}};
 const source={async lookup({externalIdentifier}){lookups++;const d=decisions.find(d=>d.externalIdentifier===externalIdentifier);return transform({outcome:'CONFLICT',observedAt:'2026-10-28T23:00:00.000Z',received:2,evidence:structuredClone(d.evidence)});}};
 const service=createResolutionService({repository,source,decisions,catalog,clock:()=>new Date('2026-10-28T23:00:00Z'),audit:async(c,event)=>{state.audits.push(event);if(state.audits.length===failAuditAt)throw new Error('Injected audit failure');}});
 return {service,userId,decisions,get state(){return state;},get lookups(){return lookups;},set transform(fn){transform=fn;},set failAuditAt(n){failAuditAt=n;},command(prepared){return {requestId:randomUUID(),expectedDigest:prepared.digest,expectedRevisions:prepared.items.map(i=>({externalIdentifier:i.externalIdentifier,revisionId:i.revisionId}))};}};
}
test('six resolutions apply atomically with original evidence, human provenance and network-free replay',async()=>{
 const f=fixture(),prepared=await f.service.prepare(f.userId),command=f.command(prepared),before=structuredClone(f.state.rows);
 const applied=await f.service.apply(f.userId,command);assert.equal(applied.items.length,6);assert.equal(applied.replayed,false);
 assert.equal(f.state.archive.length,6);assert.equal(f.state.commands.length,6);assert.equal(f.state.audits.length,6);
 for(let i=0;i<6;i++){
  assert.equal(f.state.archive[i].previous_revision_id,before[i].current_revision_id);
  assert.deepEqual(f.state.archive[i].evidence,f.decisions[i].evidence);
  assert.equal(f.state.rows[i].source_review,null);assert.equal(f.state.rows[i].snapshot.title,before[i].snapshot.title);
 }
 const lookups=f.lookups;f.transform=()=>{throw new Error('Network must not run on replay');};
 assert.equal((await f.service.apply(f.userId,command)).replayed,true);assert.equal(f.lookups,lookups);assert.equal(f.state.archive.length,6);
 f.state.revoked=true;await assert.rejects(f.service.apply(f.userId,command),{code:'FUNDING_FORBIDDEN'});
});
test('revocation, stale digest, stale revision and active worker reject the complete batch',async()=>{
 for(const mode of ['revoked','digest','revision','busy']){
  const f=fixture(),command=f.command(await f.service.prepare(f.userId));
  if(mode==='revoked')f.state.revoked=true;
  if(mode==='digest')command.expectedDigest='b'.repeat(64);
  if(mode==='revision')command.expectedRevisions[0].revisionId=randomUUID();
  if(mode==='busy')f.state.busy=true;
  await assert.rejects(f.service.apply(f.userId,command),{code:{revoked:'FUNDING_FORBIDDEN',digest:'FUNDING_RESOLUTION_STALE_DIGEST',revision:'FUNDING_RESOLUTION_STALE_REVISION',busy:'FUNDING_BUSY'}[mode]});
  assert.equal(f.state.archive.length,0);assert.equal(f.state.commands.length,0);
 }
});
test('authority is rechecked after provider requests and a changed retry intention is rejected',async()=>{
 const f=fixture(),command=f.command(await f.service.prepare(f.userId));
 f.transform=batch=>{f.state.revoked=true;return batch;};
 await assert.rejects(f.service.apply(f.userId,command),{code:'FUNDING_FORBIDDEN'});assert.equal(f.state.archive.length,0);
 const g=fixture(),second=g.command(await g.service.prepare(g.userId));await g.service.apply(g.userId,second);
 const lookups=g.lookups;await assert.rejects(g.service.apply(g.userId,{...second,expectedDigest:'c'.repeat(64)}),{code:'IDEMPOTENCY_CONFLICT'});assert.equal(g.lookups,lookups);
 const preparedAgain=await g.service.prepare(g.userId);assert.ok(preparedAgain.items.every(i=>i.alreadyApplied));
 assert.equal((await g.service.apply(g.userId,g.command(preparedAgain))).replayed,true);assert.equal(g.state.archive.length,6);
});
test('a fresh explicit decision resolves reopened reviews while original-request replay preserves them',async()=>{
 for(const review of ['CONFLICT','ABSENT','ERROR']){
  const f=fixture(),original=f.command(await f.service.prepare(f.userId));await f.service.apply(f.userId,original);
  const firstArchive=structuredClone(f.state.archive),firstRevisions=f.state.rows.map(r=>r.current_revision_id);
  f.state.rows[0].source_review=review;
  const lookups=f.lookups;assert.equal((await f.service.apply(f.userId,original)).replayed,true);
  assert.equal(f.lookups,lookups);assert.equal(f.state.rows[0].source_review,review);assert.equal(f.state.archive.length,6);
  const reviewer=randomUUID(),replacement=f.command(await f.service.prepare(reviewer));
  const result=await f.service.apply(reviewer,replacement);
  assert.equal(result.replayed,false);assert.equal(f.state.archive.length,12);assert.equal(f.state.commands.length,12);assert.equal(f.state.audits.length,12);
  assert.deepEqual(f.state.archive.slice(0,6),firstArchive);
  for(let i=0;i<6;i++){
   assert.equal(f.state.rows[i].source_review,null);assert.notEqual(f.state.rows[i].current_revision_id,firstRevisions[i]);
   assert.equal(f.state.archive[i+6].previous_revision_id,firstRevisions[i]);assert.equal(f.state.archive[i+6].decided_by,reviewer);
  }
  assert.equal((await f.service.apply(reviewer,replacement)).replayed,true);assert.equal(f.state.archive.length,12);
 }
});
test('evidence changes and a failure halfway never leave partial resolutions',async()=>{
 const f=fixture(),command=f.command(await f.service.prepare(f.userId)),before=structuredClone(f.state.rows);
 f.failAuditAt=3;await assert.rejects(f.service.apply(f.userId,command),/Injected audit failure/);
 assert.equal(f.state.archive.length,0);assert.deepEqual(f.state.rows,before);
 f.failAuditAt=null;f.transform=batch=>({...batch,evidence:{...batch.evidence,fingerprint:'b'.repeat(64)}});
 await assert.rejects(f.service.apply(f.userId,command),{code:'FUNDING_RESOLUTION_EVIDENCE_CHANGED'});assert.equal(f.state.archive.length,0);
});
test('active resolution requires identical complete evidence even when lookup becomes a single FOUND',async()=>{
 const {retainResolution}=require('../src/fundingTenders/resolutions');const f=fixture(),d=f.decisions[0],id=d.externalIdentifier;
 const row={last_source_fields:{title:'Preserved title',...d.fields},snapshot:{sourceResolution:{resolutionId:randomUUID(),sourceFingerprint:d.expectedFingerprint}},source_fingerprint:d.expectedFingerprint};row.resolution_id=row.snapshot.sourceResolution.resolutionId;
 const client={query:async()=>({rows:[row]})};
 const valid={outcome:'CONFLICT',received:2,observedAt:'2026-10-28T23:00:00Z',evidence:d.evidence};
 const retained=await retainResolution(client,id,valid);assert.equal(retained.outcome,'FOUND');assert.deepEqual(retained.record.fields,row.last_source_fields);
 const {buildEvidence}=require('../src/fundingTenders/sourceEvidence');
 const shuffled=structuredClone(d.evidence.variants).reverse();shuffled[0].metadata.esDA_IngestDate=['2026-10-29T01:00:00Z'];
 assert.equal((await retainResolution(client,id,{...valid,evidence:buildEvidence(id,shuffled)})).outcome,'FOUND');
 const altered=structuredClone(d.evidence.variants);altered[0].content='Financing conditions changed';
 const changedEvidence=await retainResolution(client,id,{...valid,evidence:buildEvidence(id,altered)});
 assert.equal(changedEvidence.outcome,'CONFLICT');
 assert.deepEqual(changedEvidence.conflictReasons,['PROTECTED_RESOLUTION_CHANGED']);
 for(const delta of [{evidence:undefined},{received:1},{limited:true},{evidence:{...d.evidence,fingerprint:'b'.repeat(64)}},{outcome:'FOUND',evidence:undefined,record:{externalIdentifier:id,fields:{title:'Bad'}}}]){
  const changed=await retainResolution(client,id,{...valid,...delta});assert.equal(changed.outcome,'CONFLICT');assert.equal(changed.record,undefined);
 }
 for(const outcome of ['ABSENT','ERROR'])assert.equal((await retainResolution(client,id,{...valid,outcome})).outcome,outcome);
});
test('known source request failures flag review only while authority, lease and fence remain current',async()=>{
 const {createFundingRepository}=require('../src/fundingTenders/repository');
 for(const mode of ['valid','revoked','expired','forbidden']){
  const calls=[],run={run_id:randomUUID(),fence:1,checkpoint:{input_cursor:{phase:'KNOWN',externalIdentifier:'ESC-HUMAID-2021-QUAL-LABEL-FP'}}};
  const row={...run,requested_by:randomUUID(),status:'RUNNING',source_code:'EU_FUNDING_TENDERS',failed_count:0};
  const client={release(){},async query(sql,p){calls.push([sql,p]);
   if(sql.includes('FROM public.global_user')||sql.includes('FROM public.platform_admin_assignment'))return {rows:mode==='revoked'?[]:[{id:row.requested_by}]};
   if(sql.startsWith('SELECT * FROM opportunity_catalog.funding_run'))return {rows:sql.includes('lease_until>')&&mode==='expired'?[]:[row]};
   if(sql.startsWith('UPDATE opportunity_catalog.funding_run SET status='))return {rows:[{...row,status:'ERROR'}]};
   return {rows:[],rowCount:0};
  }};
  const repository=createFundingRepository({pool:{connect:async()=>client},resolutionEnabled:true,refreshEnabled:true,audit:async()=>{}});
  await repository.finish(run,mode==='forbidden'?'FUNDING_FORBIDDEN':'SOURCE_TIMEOUT');
  const mutations=calls.filter(([sql])=>sql.startsWith('UPDATE opportunity_catalog.funding_identity'));
  assert.equal(mutations.length,mode==='valid'?1:0,mode);
 }
});
test('resolved catalog data cannot be overwritten outside a verified durable known-lookup binding',async()=>{
 const {createFundingRepository}=require('../src/fundingTenders/repository');
 for(const mode of ['legacy','disabled','missing-binding','stale-binding','changed-fields']){
  const run={run_id:randomUUID(),fence:1,...(mode==='legacy'?{}:{checkpoint:{input_cursor:{phase:'KNOWN',externalIdentifier:'ESC-HUMAID-2021-QUAL-LABEL-FP'}}})};
  const resolution=metadata(),fields={title:'Preserved title',funderName:'European Commission',closingDate:'2026-09-22'};
  const identity={external_identifier:'ESC-HUMAID-2021-QUAL-LABEL-FP',opportunity_id:randomUUID(),last_source_fields:fields,corrections:{}};
  const previous={current_revision_id:randomUUID(),row_version:2,snapshot:{...snapshot(),...fields,sourceResolution:resolution}};
  const stored={external_identifier:identity.external_identifier,source_fields:mode==='changed-fields'?{...fields,closingDate:'2030-01-01'}:fields,source_resolution_id:mode==='missing-binding'?null:mode==='stale-binding'?randomUUID():resolution.resolutionId};
  const calls=[],client={release(){},async query(sql,p){calls.push(sql);
   if(sql.includes('FROM public.global_user')||sql.includes('FROM public.platform_admin_assignment'))return {rows:[{id:randomUUID()}]};
   if(sql.startsWith('SELECT * FROM opportunity_catalog.funding_run WHERE'))return {rows:[{source_code:'EU_FUNDING_TENDERS',requested_by:randomUUID()}]};
   if(sql.startsWith('SELECT * FROM opportunity_catalog.funding_run_item'))return {rows:[stored]};
   if(sql.startsWith('SELECT * FROM opportunity_catalog.funding_identity'))return {rows:[identity]};
   if(sql.startsWith('SELECT o.*,r.snapshot'))return {rows:[previous]};
   return {rows:[],rowCount:1};
  }};
  const repository=createFundingRepository({pool:{connect:async()=>client},resolutionEnabled:mode!=='disabled',refreshEnabled:true,audit:async()=>{}});
  await assert.rejects(repository.apply(run,stored),{code:'FUNDING_RESOLUTION_REQUIRES_LOOKUP'},mode);
  assert.equal(calls.filter(sql=>/^(INSERT|UPDATE|DELETE) /i.test(sql)).length,0,mode);
 }
});
