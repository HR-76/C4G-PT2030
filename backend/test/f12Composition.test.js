'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createOpportunityApplicationService}=require('../src/opportunities/applicationService');
const {createOpportunityAuditPort}=require('../src/opportunities/audit');
const {createOpportunityTelemetry}=require('../src/opportunities/telemetry');
const {createOpportunityJobRegistry,JOBS}=require('../src/opportunities/jobs');
const {createOpportunityDocumentBinding}=require('../src/opportunities/documentBinding');
const {MetricRegistry}=require('../src/observability/metrics');
const {createF11ObjectStorageDouble}=require('./support/f11ObjectStorageDouble');
const ID='01890f3e-7b12-7abc-8def-0123456789ab',REV='01890f3e-7b12-7abc-8def-0123456789ac',ORG='11111111-1111-4111-8111-111111111111';
const snapshot=Object.freeze({schemaVersion:1,title:'Synthetic grant',funderName:'Synthetic funder',provenanceId:REV,lifecycleState:'DRAFT',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1'});
const provenance=Object.freeze({schemaVersion:1,sourceType:'ORGANIZATION_MANUAL',sourceNamespace:'SYNTHETIC',observedAt:'2030-01-01T00:00:00.000Z'});
const ctx=Object.freeze({actor:Object.freeze({type:'HUMAN',id:ID,organizationId:ORG,membershipId:REV,membershipVersion:1,authorizationVersion:1}),correlationId:ID,causationId:REV,assuranceEvidence:null,resourceId:ORG});
function fixture({denied=false,auditFailure=false,authority='ORGANIZATION'}={}){let writes=0;const row=Object.freeze({opportunityId:ID,revisionId:REV,revisionNumber:1,rowVersion:1,lifecycleState:'DRAFT',qualityBucket:'LOW',contentDigest:'a'.repeat(64)});const repository={authority,create:async()=>{writes++;return row;},get:async id=>id===ID?row:null,list:async()=>Object.freeze({items:Object.freeze([row]),nextCursor:null}),update:async()=>{writes++;return Object.freeze({...row,rowVersion:2});},changeLifecycle:async()=>{writes++;return Object.freeze({...row,lifecycleState:'ARCHIVED',rowVersion:2});},recordCandidate:async input=>{writes++;return Object.freeze({leftOpportunityId:input.left.opportunityId,rightOpportunityId:input.right.opportunityId,classification:input.classification,ruleVersion:input.ruleVersion});}};const events=[];const audit=createOpportunityAuditPort({accept:async event=>{events.push(event);if(auditFailure&&event.eventCode==='OPPORTUNITY_CREATED')throw new Error('synthetic');return {status:'ACCEPTED'};}});const metrics=new MetricRegistry();const service=createOpportunityApplicationService({repository,authorization:{authorize:async()=>Object.freeze({allowed:!denied})},audit,telemetry:createOpportunityTelemetry({metrics})});return {service,row,events,metrics,writes:()=>writes,repository,audit};}
test('F12 composition authorizes, audits critically before create and records bounded telemetry',async()=>{const f=fixture();const result=await f.service.create({schemaVersion:1,requestId:'synthetic-create',snapshot,provenance},ctx);assert.equal(result.opportunityId,ID);assert.equal(f.writes(),1);assert.equal(f.events[0].eventCode,'OPPORTUNITY_CREATED');assert.equal(f.metrics.snapshot().records[0].labels.operation,'opportunity.create');assert.ok(Object.isFrozen(result));});
test('F12 critical F7 failure and F5 denial have no functional write',async()=>{const critical=fixture({auditFailure:true});await assert.rejects(()=>critical.service.create({schemaVersion:1,requestId:'synthetic-create',snapshot,provenance},ctx));assert.equal(critical.writes(),0);const denied=fixture({denied:true});await assert.rejects(()=>denied.service.update({schemaVersion:1,requestId:'synthetic-update',opportunityId:ID,expectedRowVersion:1,snapshot,provenance},ctx),error=>error.code==='OPPORTUNITY_NOT_FOUND');assert.equal(denied.writes(),0);assert.equal(denied.events.at(-1).eventCode,'OPPORTUNITY_ACCESS_DENIED');});
test('F12 get loads resource before authorization and returns immutable projection',async()=>{const f=fixture();const calls=[];f.repository.get=async id=>{calls.push('load');return id===ID?f.row:null;};const service=createOpportunityApplicationService({repository:f.repository,authorization:{authorize:async()=>{calls.push('authorize');return {allowed:true};}},audit:f.audit,telemetry:createOpportunityTelemetry({metrics:new MetricRegistry()})});const result=await service.get({schemaVersion:1,kind:'GET',opportunityId:ID},ctx);assert.deepEqual(calls,['load','authorize']);assert.ok(Object.isFrozen(result));});
test('F12 lifecycle and deterministic duplicate paths use only approved operations',async()=>{const f=fixture();await f.service.changeLifecycle({schemaVersion:1,requestId:'synthetic-archive',opportunityId:ID,expectedRowVersion:1,action:'ARCHIVE'},ctx);const right=Object.freeze({...f.row,opportunityId:'01890f3e-7b12-7abc-8def-0123456789ad',revisionId:'01890f3e-7b12-7abc-8def-0123456789ae'});f.repository.get=async()=>f.row;const result=await f.service.evaluateDuplicate({left:f.row,right,result:{ruleVersion:'opportunity-deduplication-v1',classification:'POSSIBLE',reasonCodes:['TITLE_FUNDER_MATCH'],evidenceFields:['title','funderName']}},ctx);assert.equal(result.classification,'POSSIBLE');assert.equal(f.events.at(-1).eventCode,'OPPORTUNITY_DUPLICATE_CANDIDATE_IDENTIFIED');});
test('F12 telemetry failure never changes functional result',async()=>{const f=fixture();const service=createOpportunityApplicationService({repository:f.repository,authorization:{authorize:async()=>({allowed:true})},audit:f.audit,telemetry:createOpportunityTelemetry({metrics:{record(){throw new Error('synthetic telemetry failure');}}})});assert.equal((await service.get({schemaVersion:1,kind:'GET',opportunityId:ID},ctx)).opportunityId,ID);});
test('F12 registers exactly two closed envelope-v2 job handlers',async()=>{const seen=[];const registry=createOpportunityJobRegistry(Object.fromEntries(JOBS.map(type=>[type,async envelope=>{seen.push(envelope);return Object.freeze({resultClass:'SUCCESS'});}])));assert.deepEqual(registry.types,JOBS);const definition=registry.resolve(JOBS[0]);await assert.rejects(()=>definition.handler({envelopeVersion:1,payload:{}}));await definition.handler({envelopeVersion:2,payload:{opportunityId:ID,revisionId:REV,ruleVersion:'opportunity-deduplication-v1'}});assert.equal(seen.length,1);});
test('F12 F11 binding is tenant-only, double-backed, authorized and availability-gated',async()=>{
 const f=fixture(),bound=[],authorized=[];
 const storage=createF11ObjectStorageDouble();
 const dependencies={repository:f.repository,authorization:{authorize:async input=>{authorized.push(input);return {allowed:true};}},documents:{load:async()=>({organizationId:ORG,state:'AVAILABLE'}),bind:async input=>{bound.push(input);return {status:'BOUND'};}},storage,audit:f.audit};
 const binding=createOpportunityDocumentBinding(dependencies);
 const result=await binding.bind({opportunityId:ID,documentId:REV,context:ctx});
 assert.equal(result.status,'BOUND');assert.ok(Object.isFrozen(result));
 assert.deepEqual(bound,[{resourceType:'OPPORTUNITY',resourceId:ID,documentId:REV,idempotencyKey:`${ID}:${REV}`}]);
 assert.deepEqual(authorized.map(({operationCode,resourceId,actor})=>({operationCode,resourceId,actor})),[
  {operationCode:'OPPORTUNITY_READ',resourceId:ID,actor:ctx.actor},
  {operationCode:'DOCUMENT_READ',resourceId:REV,actor:ctx.actor}
 ]);
 assert.equal(f.events.at(-1).eventCode,'OPPORTUNITY_PROVENANCE_LINKED');
 assert.throws(()=>createOpportunityDocumentBinding({...dependencies,repository:{authority:'CENTRAL'}}),/Private opportunity document binding dependencies/);
 const {abortMultipartSession,...incomplete}=storage;
 assert.equal(typeof abortMultipartSession,'function');
 for(const invalidStorage of [incomplete,{...storage,undeclaredOperation:async()=>{}}]){
  assert.throws(()=>createOpportunityDocumentBinding({...dependencies,storage:invalidStorage}),/ObjectStoragePort contract is incomplete or open/);
 }
});
test('F12 F11 binding denies either authorization before loading or binding a document',async()=>{
 for(const deniedOperation of ['OPPORTUNITY_READ','DOCUMENT_READ']){
  const f=fixture(),authorized=[];let loaded=0,bound=0;
  const binding=createOpportunityDocumentBinding({repository:f.repository,authorization:{authorize:async({operationCode})=>{authorized.push(operationCode);return {allowed:operationCode!==deniedOperation};}},documents:{load:async()=>{loaded++;return {organizationId:ORG,state:'AVAILABLE'};},bind:async()=>{bound++;}},storage:createF11ObjectStorageDouble(),audit:f.audit});
  await assert.rejects(()=>binding.bind({opportunityId:ID,documentId:REV,context:ctx}),error=>error.code==='OPPORTUNITY_NOT_FOUND');
  assert.deepEqual(authorized,deniedOperation==='OPPORTUNITY_READ'?['OPPORTUNITY_READ']:['OPPORTUNITY_READ','DOCUMENT_READ']);
  assert.equal(loaded,0);assert.equal(bound,0);assert.equal(f.events.length,0);
 }
});
test('F12 F11 binding rejects foreign, unavailable and missing documents without a write',async()=>{
 for(const document of [null,{organizationId:REV,state:'AVAILABLE'},{organizationId:ORG,state:'QUARANTINED'},{organizationId:ORG,state:'UPLOADING'}]){
  const f=fixture();let bound=0;
  const binding=createOpportunityDocumentBinding({repository:f.repository,authorization:{authorize:async()=>({allowed:true})},documents:{load:async()=>document,bind:async()=>{bound++;}},storage:createF11ObjectStorageDouble(),audit:f.audit});
  await assert.rejects(()=>binding.bind({opportunityId:ID,documentId:REV,context:ctx}),error=>error.code==='OPPORTUNITY_NOT_FOUND');
  assert.equal(bound,0);assert.equal(f.events.length,0);
 }
});
test('F12 audit rejects free text, identities and unknown fields',async()=>{const audit=createOpportunityAuditPort({accept:async()=>({status:'ACCEPTED'})});await assert.rejects(()=>audit.emit('OPPORTUNITY_CREATED',{title:'forbidden'}));await assert.rejects(()=>audit.emit('OPPORTUNITY_CREATED',{organizationId:ORG}));});
