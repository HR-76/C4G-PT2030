'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {previewReconciliation}=require('../src/opportunities/v2/reconciliation');
const eu=require('../../context/references/opportunity-v2/examples/eu-11145.json');
const pt=require('../../context/references/opportunity-v2/examples/pt2030-8614.json');
const copy=value=>structuredClone(value),mappingDigest='a'.repeat(64);
const id=n=>'01900000-0000-7000-8000-'+String(n).padStart(12,'0');
const candidate=(snapshot=eu,candidateId='candidate-1',extra={})=>({candidateId,snapshot,mappingDigest,...extra});
const accepted=(snapshot=eu,extra={})=>({opportunityId:id(1),revisionId:id(2),rowVersion:3,snapshot,mappingDigest,...extra});
const preview=(snapshot=eu,previous=accepted())=>previewReconciliation({accepted:previous?[previous]:[],candidates:[candidate(snapshot)]});
function renamedCall(number){const value=copy(eu);value.sourceRecords[0].externalId='CASCADE:'+number;value.sourceRecords[0].url=value.sourceRecords[0].url.replace('/11145','/'+number);value.links.official.value=value.sourceRecords[0].url;value.identity.references.value.find(x=>x.kind==='SOURCE_CALL_ID').value=number;return value;}

test('reconciliation binds exact candidate bytes and accepted revision without mutation or automatic approval',()=>{
 const input={accepted:[accepted()],candidates:[candidate()]},before=JSON.stringify(input);
 const result=previewReconciliation(input),item=result.items[0];
 assert.equal(item.action,'UNCHANGED');assert.equal(item.canReplaceAccepted,false);
 assert.equal(item.accepted.opportunityId,id(1));assert.equal(item.accepted.revisionId,id(2));assert.equal(item.accepted.rowVersion,3);
 assert.match(item.candidate.snapshotDigest,/^[a-f0-9]{64}$/);assert.match(item.itemDigest,/^[a-f0-9]{64}$/);
 assert.equal(result.previewDigest,previewReconciliation(input).previewDigest);
 assert.equal(JSON.stringify(input),before);assert.ok(Object.isFrozen(item));
 const moved=copy(eu);moved.provenance.observations[0].observedAt='2026-11-01T00:00:00.000Z';
 const later=preview(moved);assert.equal(later.items[0].action,'UNCHANGED');assert.notEqual(later.previewDigest,result.previewDigest);
});

test('changed facts and mappings require new approval bound to current revision, corrections and private references',()=>{
 const changed=copy(eu);changed.financing.allocations.value[0].money.amount='120001';
 const result=preview(changed),item=result.items[0];
 assert.equal(item.action,'CHANGE_REQUIRES_APPROVAL');assert.ok(item.changedFields.includes('/financing/allocations'));
 assert.notEqual(result.previewDigest,preview(changed,accepted(eu,{rowVersion:4})).previewDigest);
 const mapping=previewReconciliation({accepted:[accepted()],candidates:[candidate(eu,'candidate-1',{mappingDigest:'b'.repeat(64)})]});
 assert.equal(mapping.items[0].action,'CHANGE_REQUIRES_APPROVAL');assert.ok(mapping.items[0].reasonCodes.includes('MAPPING_IMPLEMENTATION_CHANGED'));
 const refs=[{organizationId:id(6),kind:'APPLICATION',id:id(7),revisionId:id(2),snapshotDigest:'c'.repeat(64)}];
 const linked=preview(changed,accepted(eu,{privateReferences:refs}));assert.notEqual(linked.previewDigest,result.previewDigest);
 const corrected=preview(changed,accepted(eu,{corrections:{closingDate:{value:'2028-01-01'}}}));
 assert.equal(corrected.items[0].action,'BLOCKED');assert.ok(corrected.items[0].reasonCodes.includes('EDITORIAL_CORRECTIONS_REQUIRE_REVIEW'));
 const resolved=preview(changed,accepted(eu,{resolutions:[{decisionId:id(8),kind:'KEEP_ACCEPTED'}]}));
 assert.equal(resolved.items[0].action,'BLOCKED');assert.ok(resolved.items[0].reasonCodes.includes('SOURCE_RESOLUTION_REQUIRES_REVIEW'));
});

test('new identity does not reuse an opportunity merely because title matches, and plan is separate from notice',()=>{
 const next=renamedCall('99999');
 const result=preview(next);assert.equal(result.items[0].action,'NEW');assert.equal(result.items[0].accepted,null);
 const plan=copy(pt);plan.description.title.value=eu.description.title.value;
 assert.equal(preview(plan).items[0].action,'NEW');
});

test('legacy migration always requires review and preserves original values, identity and protected metadata',()=>{
 const legacy={schemaVersion:1,title:eu.description.title.value,funderName:'Legacy funder',provenanceId:id(4),lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1',fundingAmountMin:'0',fundingAmountMax:'120000',currencyCode:'EUR'};
 const current=accepted(legacy,{identities:[{namespace:'EU_FUNDING_TENDERS',externalId:'CASCADE:11145'}],mappingDigest:null});
 const result=preview(eu,current);assert.equal(result.items[0].action,'CHANGE_REQUIRES_APPROVAL');
 assert.ok(result.items[0].reasonCodes.includes('LEGACY_MIGRATION_REQUIRES_REVIEW'));assert.equal(result.items[0].accepted.schemaVersion,1);
 assert.equal(current.snapshot.currencyCode,'EUR');
 assert.throws(()=>preview(eu,accepted(legacy)),{code:'OPPORTUNITY_RECONCILIATION_INVALID'});
 const sourceResolution={schemaVersion:1,resolutionId:id(8),decidedAt:'2026-10-30T12:00:00.000Z',sourceFingerprint:'a'.repeat(64),reason:'Editorial decision',note:'Preserve decision',sources:[{url:'https://example.org/source',title:'Source',locator:'Deadline'}]};
 assert.equal(preview(eu,{...current,snapshot:{...legacy,sourceResolution}}).items[0].action,'BLOCKED');
});

test('loss of accepted facts, conflicts and unresolved official document conflicts block replacement',()=>{
 const lost=copy(eu);lost.financing.allocations={state:'NOT_COLLECTED',value:null,reason:'SOURCE_READ_FAILED',evidenceRefs:[]};
 lost.quality.issues=lost.quality.issues.filter(x=>!x.field.startsWith('/financing/allocations/value/'));
 const result=preview(lost);assert.equal(result.items[0].action,'BLOCKED');assert.ok(result.items[0].retainedFields.includes('/financing/allocations'));
 const conflict=copy(lost);conflict.financing.allocations={state:'CONFLICT',value:null,reason:'CONFLICTING_AMOUNTS',evidenceRefs:['budget','monthly-support']};
 assert.equal(preview(conflict,null).items[0].action,'BLOCKED');
 const document=copy(eu);document.quality.issues.push({code:'OFFICIAL_DOCUMENT_TIME_CONFLICT_REQUIRES_REVIEW',field:'/schedule/deadlines',evidenceRefs:[]});
 assert.equal(preview(document,null).items[0].action,'BLOCKED');
});

test('duplicate candidate and ambiguous accepted identities are fully counted and blocked without winner selection',()=>{
 const result=previewReconciliation({accepted:[],candidates:[candidate(eu,'a'),candidate(eu,'b')]});
 assert.equal(result.items.length,2);assert.equal(result.counts.BLOCKED,2);
 assert.ok(result.items.every(x=>x.reasonCodes.includes('DUPLICATE_CANDIDATE_IDENTITY')));
 const ambiguous=previewReconciliation({accepted:[accepted(),accepted(eu,{opportunityId:id(3),revisionId:id(4)})],candidates:[candidate()]});
 assert.equal(ambiguous.items[0].action,'BLOCKED');assert.ok(ambiguous.items[0].reasonCodes.includes('AMBIGUOUS_ACCEPTED_IDENTITY'));
});

test('different source identities resolving to one accepted opportunity cannot select concurrent replacement winners',()=>{
 const current=accepted(eu,{identities:[{namespace:'EU_FUNDING_TENDERS',externalId:'CASCADE:11145'},{namespace:'PORTUGAL2030_PLAN',externalId:'8614'}]});
 const result=previewReconciliation({accepted:[current],candidates:[candidate(eu,'eu'),candidate(pt,'pt')]});
 assert.equal(result.counts.BLOCKED,2);assert.ok(result.items.every(x=>x.reasonCodes.includes('MULTIPLE_CANDIDATES_FOR_ACCEPTED_IDENTITY')));
});

test('only explicit evidence-backed aliases resolve identity, and cycles or split targets do not merge',()=>{
 const altered=renamedCall('99999');
 const alias={from:{namespace:'EU_FUNDING_TENDERS',externalId:'CASCADE:99999'},to:{namespace:'EU_FUNDING_TENDERS',externalId:'CASCADE:11145'},decisionId:id(9),evidenceDigest:'d'.repeat(64),relation:'SAME_OPPORTUNITY'};
 const result=previewReconciliation({accepted:[accepted()],candidates:[candidate(altered)],aliases:[alias]});
 assert.equal(result.items[0].accepted.opportunityId,id(1));assert.equal(result.items[0].action,'CHANGE_REQUIRES_APPROVAL');assert.ok(result.items[0].reasonCodes.includes('EXPLICIT_ALIAS_REQUIRES_REVIEW'));
 assert.throws(()=>previewReconciliation({accepted:[accepted()],candidates:[candidate(altered)],aliases:[{...alias,evidenceDigest:null}]}),{code:'OPPORTUNITY_RECONCILIATION_INVALID'});
 const cycle={...alias,from:alias.to,to:alias.from,decisionId:id(10)};
 const blocked=previewReconciliation({accepted:[accepted()],candidates:[candidate(altered)],aliases:[alias,cycle]});
 assert.equal(blocked.items[0].action,'BLOCKED');assert.ok(blocked.items[0].reasonCodes.includes('ALIAS_CYCLE'));
});

test('preview is independent of input ordering and reports accepted identities absent from this candidate batch without deletion',()=>{
 const input={accepted:[accepted(),accepted(pt,{opportunityId:id(3),revisionId:id(4)})],candidates:[candidate(pt,'plan'),candidate(eu,'eu')]};
 const a=previewReconciliation(input),b=previewReconciliation({accepted:[...input.accepted].reverse(),candidates:[...input.candidates].reverse()});
 assert.equal(a.previewDigest,b.previewDigest);
 const partial=previewReconciliation({...input,candidates:[candidate()]});
 assert.deepEqual(partial.unseenAcceptedOpportunityIds,[id(3)]);assert.equal(partial.canDeleteAccepted,false);
});

test('invalid bindings and hostile input fail before creating a misleading preview',()=>{
 const input={accepted:[accepted()],candidates:[candidate()]};
 assert.throws(()=>previewReconciliation({...input,approval:true}),{code:'OPPORTUNITY_RECONCILIATION_INVALID'});
 assert.throws(()=>previewReconciliation({...input,candidates:[candidate(eu,'bad',{mappingDigest:'not-a-digest'})]}),{code:'OPPORTUNITY_RECONCILIATION_INVALID'});
 assert.throws(()=>previewReconciliation({...input,candidates:[candidate(),candidate()]}),{code:'OPPORTUNITY_RECONCILIATION_INVALID'});
 assert.throws(()=>previewReconciliation({...input,accepted:[accepted(eu,{rowVersion:0})]}),{code:'OPPORTUNITY_RECONCILIATION_INVALID'});
 let getterCalled=false;const hostile={...input};Object.defineProperty(hostile,'aliases',{enumerable:true,get(){getterCalled=true;return [];}});
 assert.throws(()=>previewReconciliation(hostile));assert.equal(getterCalled,false);
});
