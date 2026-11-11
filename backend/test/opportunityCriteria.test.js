'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {validate,findings}=require('../src/opportunityCriteria/contracts');
test('stored recovery projections never forward internal fields',()=>{
 const {projectReceipt}=require('../src/opportunityCriteria/contracts');
 const value={setId:randomUUID(),revisionId:randomUUID(),revisionNumber:1,state:'DRAFT'};
 assert.deepEqual(projectReceipt({...value,intention_digest:'restricted'}),value);
 assert.throws(()=>projectReceipt({...value,revisionNumber:0}),{code:'SERVICE_UNAVAILABLE'});
});
function command(){return {requestId:randomUUID(),expectedHeadRevision:0,opportunityRevisionId:randomUUID(),criteria:[{criterionId:randomUUID(),kind:'COMPETENCY_REQUIREMENT',interpretationText:''}],sources:[]};}
test('criteria drafts preserve unknown evidence; confirmation findings never imply failure of a requirement',()=>{
 const input=validate('save',command(),randomUUID());assert.deepEqual(findings(input).map(x=>x.code),['INTERPRETATION_REQUIRED','REFERENCE_REQUIRED','EVIDENCE_INCOMPLETE','TIME_REQUIRED']);
});
test('criteria closed input refuses evaluation fields, duplicate kind, foreign authority and secret URI',()=>{
 for(const mutate of [c=>c.score=1,c=>c.authority='CENTRAL',c=>c.criteria.push({...c.criteria[0],criterionId:randomUUID()}),c=>c.sources.push({sourceId:randomUUID(),label:'source',sourceKind:'EDITORIAL_TRANSCRIPTION',reference:'https://user:secret@example.invalid',versionLabel:'1',capturedText:'text'})]){const c=command();mutate(c);assert.throws(()=>validate('save',c,randomUUID()),{code:'INVALID_INPUT'});}
});
test('criteria confirmation requires exact nonzero revision and lookup does not accept arbitrary operation',()=>{
 assert.throws(()=>validate('confirm',{requestId:randomUUID(),expectedHeadRevision:0,opportunityRevisionId:randomUUID()},randomUUID(),randomUUID()));
 assert.throws(()=>validate('lookup',{requestId:randomUUID(),resourceId:randomUUID(),operation:'PUBLISH'},randomUUID()));
});
test('criteria recovery browser envelope rejects secrets and is bound to user organization and opportunity',async()=>{
 const {saveIntention,findIntention,removeIntention}=await import('../../frontend/src/pages/OpportunityCriteria/intentions.js');
 const values=new Map(),storage={get length(){return values.size},key:i=>[...values.keys()][i],getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const v={userId:randomUUID(),organizationId:randomUUID(),opportunityId:randomUUID(),requestId:randomUUID(),resourceId:randomUUID(),operation:'SAVE_REVISION'};
 assert.throws(()=>saveIntention({...v,token:'secret'},storage));saveIntention(v,storage);
 const {userId,organizationId,opportunityId}=v;assert.deepEqual(findIntention({userId,organizationId,opportunityId},storage),v);
 for(const key of ['userId','organizationId','opportunityId'])assert.equal(findIntention({userId,organizationId,opportunityId,[key]:randomUUID()},storage),null);
 removeIntention(v.requestId,storage);assert.equal(storage.length,0);
});

 test('criteria invalid canonical text is an input refusal, before authorization or recovery',()=>{
  for(const value of ['e\u0301','\ud800']){const c=command();c.criteria[0].interpretationText=value;assert.throws(()=>validate('save',c,randomUUID()),{code:'INVALID_INPUT'});}
 });
 test('editorial audit accepts a denial without a resource reference',async()=>{
  const {AsyncLocalStorage}=require('node:async_hooks'),scope=new AsyncLocalStorage();
  const sentinel=Error('APPEND_REACHED');const port=require('../src/organizationalProfile/editorialUiAudit').createEditorialUiAudit({scope,catalogs:{operationCatalog:{resolve:()=>({resourceType:'OPPORTUNITY'})}},clock:{now:()=>new Date()},policyVersion:'test-v1'});
  await scope.run({organizationId:randomUUID(),sequence:0,client:{query:async()=>{throw sentinel;}}},()=>assert.rejects(port.accept({operationCode:'OPPORTUNITY_READ',eventType:'AUTHORIZATION_DENIED',actorId:randomUUID(),membershipId:randomUUID(),result:'DENY',reasonCode:'NOT_AUTHORIZED',correlationId:require('../src/audit/uuidV7').createUuidV7()}),e=>e===sentinel));
 });

test('criteria pagination accepts only decimal limits',()=>{
 const id=randomUUID();for(const limit of [1,50,'1','50'])assert.equal(validate('list',{limit},id).limit,Number(limit));
 for(const limit of [true,[1],null,'',' 1','1.0',0,51])assert.throws(()=>validate('list',{limit},id),{code:'INVALID_INPUT'});
});
