'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {buildProjection,emptyExtension,stableId}=require('../src/opportunities/catalogRead/model');
const {validate}=require('../src/opportunities/catalogRead/contractValidation');
const fixture=()=>JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../test/integration/catalog-read/snapshot-v2.json'),'utf8'));
const asOf='2027-01-20T12:00:00.000Z';
function setup(){const snapshot=fixture();const extension=emptyExtension(snapshot,{opportunityId:stableId('opportunity'),revisionId:stableId('revision'),extensionId:stableId('extension'),acceptanceDigest:'a'.repeat(64),recordedAt:'2027-01-20T11:00:00.000Z'});return {snapshot,extension};}
test('v2 maps to approved G1 detail without changing source or inventing currency',()=>{
 const {snapshot,extension}=setup(),before=structuredClone(snapshot),p=buildProjection(snapshot,extension,{asOf});
 assert.deepEqual(snapshot,before);assert.equal(validate('Detail',p.detail).valid,true);
 assert.equal(p.detail.summary.funding.value.amount,'120000');assert.equal(p.detail.summary.funding.value.currency,null);
 assert.equal(p.detail.summary.externalCode.value,'11145');assert.equal(p.detail.summary.kind,'cascade_call');
 assert.equal(p.collections.windows.length,7);assert.ok(p.collections.evidence.length>0);assert.ok(Object.isFrozen(p.detail.summary));
 assert.equal(p.collections.fundingRules.length,1);assert.match(p.collections.fundingRules[0].conditions,/1500/);assert.match(p.collections.fundingRules[0].conditions,/PER_PERSON_MONTH/);
});
test('same input generates identical projection identity and digest',()=>{const {snapshot,extension}=setup();assert.deepEqual(buildProjection(snapshot,extension,{asOf}),buildProjection(snapshot,extension,{asOf}));});
test('changed mapping inputs cannot reuse projection identity',()=>{const {snapshot,extension}=setup();const a=buildProjection(snapshot,extension,{asOf});extension.kind='cascade_call';const b=buildProjection(snapshot,extension,{asOf});assert.notEqual(a.projectionId,b.projectionId);});
test('wrong source digest rejected',()=>{const {snapshot,extension}=setup();extension.sourceDigest='b'.repeat(64);assert.throws(()=>buildProjection(snapshot,extension,{asOf}),{code:'CATALOG_READ_SOURCE_DIGEST_MISMATCH'});});
test('conditional local deadline preserves unknown zone and earlier windows',()=>{
 const {snapshot,extension}=setup(),base=buildProjection(snapshot,extension,{asOf});
 const w=structuredClone(base.collections.windows[0]);w.id=stableId('conditional');w.supersedesId=base.collections.windows[0].id;w.applicability='conditional';w.condition='Se houver verba';w.closing={state:'PRESENT',value:{kind:'local_datetime',local:'2027-02-26T18:00:00',timezone:null},evidenceIds:w.evidenceIds};extension.windows.items=[w];extension.windows.completeness='partial';
 const p=buildProjection(snapshot,extension,{asOf});assert.equal(p.collections.windows.length,8);assert.equal(p.detail.summary.status.code,'conditional');assert.equal(p.detail.summary.deadline.at.timezone,null);
});
test('missing evidence is rejected',()=>{const {snapshot,extension}=setup();const p=buildProjection(snapshot,extension,{asOf});const w=structuredClone(p.collections.windows[0]);w.id=stableId('x');w.evidenceIds=[stableId('missing')];extension.windows.items=[w];assert.throws(()=>buildProjection(snapshot,extension,{asOf}),{code:'CATALOG_READ_EVIDENCE_REFERENCE'});});
test('document versions retain partial supersession and hashes',()=>{
 const {snapshot,extension}=setup(),p=buildProjection(snapshot,extension,{asOf});
 const doc={id:stableId('doc1'),documentId:stableId('doc'),title:'Documento sintético',versionLabel:'1',role:'notice',contentSha256:'c'.repeat(64),publishedAt:{kind:'date',date:'2027-01-01'},effectiveAt:null,observedAt:'2027-01-20T11:00:00.000Z',sourceUrls:['https://example.org/notice'],supersedesVersionId:null,supersessionScope:null,preservation:'reference_only',evidenceIds:[p.collections.evidence[0].id]};
 extension.documents.items=[doc,{...doc,id:stableId('doc2'),versionLabel:'2',contentSha256:'d'.repeat(64),supersedesVersionId:doc.id,supersessionScope:'Cláusula de prazo'}];
 const r=buildProjection(snapshot,extension,{asOf});assert.equal(r.collections.documents.length,2);assert.notEqual(r.collections.documents[0].contentSha256,r.collections.documents[1].contentSha256);
 extension.documents.items[0].supersedesVersionId=extension.documents.items[1].id;extension.documents.items[0].supersessionScope='Prazo';assert.throws(()=>buildProjection(snapshot,extension,{asOf}),{code:'CATALOG_READ_SUPERSESSION_CYCLE'});
});
test('unresolved material deadline conflict prevents a supported summary date',()=>{
 const {snapshot,extension}=setup();const p=buildProjection(snapshot,extension,{asOf}),e=p.collections.evidence[0].id;
 extension.conflicts.items=[{id:stableId('conflict'),fieldPath:'schedule.closing',scopeLabel:'Aviso',severity:'material',status:'unresolved',reason:'Fontes divergentes',alternatives:[{id:stableId('a'),valueText:'2027-01-31',evidenceIds:[e]},{id:stableId('b'),valueText:'2027-02-26',evidenceIds:[e]}],selectedAlternativeId:null,decision:null}];
 const r=buildProjection(snapshot,extension,{asOf});assert.equal(r.detail.summary.deadline.state,'conflicted');assert.equal(r.detail.summary.deadline.at,null);assert.ok(r.detail.summary.quality.flags.includes('conflicted'));
});
test('future extension is rejected',()=>{const {snapshot,extension}=setup();extension.recordedAt='2027-01-21T12:00:00.000Z';assert.throws(()=>buildProjection(snapshot,extension,{asOf}),{code:'CATALOG_READ_EXTENSION_IN_FUTURE'});});
test('source cancellation is not reopened by a conditional extension',()=>{
 const {snapshot}=setup();snapshot.status.published.value='CANCELLED';
 const extension=emptyExtension(snapshot,{opportunityId:stableId('opportunity'),revisionId:stableId('revision'),extensionId:stableId('cancelled-ext'),acceptanceDigest:'a'.repeat(64),recordedAt:'2027-01-20T11:00:00.000Z'});
 const p=buildProjection(snapshot,extension,{asOf}),w=structuredClone(p.collections.windows[0]);w.id=stableId('cancelled-window');w.applicability='conditional';w.condition='Se houver verba';extension.windows.items=[w];
 assert.equal(buildProjection(snapshot,extension,{asOf}).detail.summary.status.code,'cancelled');
});
test('additional private fields rejected',()=>{const {snapshot,extension}=setup();extension.organizationId=stableId('private');assert.throws(()=>buildProjection(snapshot,extension,{asOf}),{code:'CATALOG_READ_EXTENSION_INVALID'});});
test('source ambiguity is retained, not silently converted into a call total',()=>{
 const {snapshot,extension}=setup();snapshot.financing.allocations.value.push({...structuredClone(snapshot.financing.allocations.value[0]),key:'allocation-other'});
 const ext=emptyExtension(snapshot,{...extension});const p=buildProjection(snapshot,ext,{asOf});assert.equal(p.detail.summary.funding.state,'UNSUPPORTED');assert.equal(p.collections.funding.length,2);
});
test('schema contains only approved optional presentation additions and retains every G2 case',()=>{
 const directory=path.resolve(__dirname,'../../experiments/catalog-read-g2');
 // Acceptance note: the user's 2026-11-02 request approves these display fields
 // as optional additions. Historical G2 schemas/fixtures remain immutable.
 const current=structuredClone(require('../src/opportunities/catalogRead/contract.schema.json'));
 const nullable=definition=>({anyOf:[definition,{type:'null'}]});
 assert.deepEqual(current.$defs.PresentationValue,{
  type:'object',properties:{
   value:nullable({type:'string',minLength:1,maxLength:8000}),
   source:{enum:['canonical','archived','unavailable']},
   sourceUrl:nullable({type:'string',minLength:1,maxLength:2048,format:'public-https'}),
   sourcePointer:nullable({type:'string',minLength:1,maxLength:500,pattern:'^/'}),
  },required:['value','source','sourceUrl','sourcePointer'],additionalProperties:false,
  allOf:[{if:{properties:{source:{const:'unavailable'}}},then:{properties:{value:{type:'null'},sourceUrl:{type:'null'},sourcePointer:{type:'null'}}},else:{properties:{value:{type:'string'},sourcePointer:{type:'string'}}}}],
 });
 for(const [definition,field,keys] of [
  ['Summary','presentation',['typification','areas']],
  ['Detail','callInformation',['topic','eligibleCandidates','duration','location']],
 ]){
  assert(!current.$defs[definition].required.includes(field),'Existing clients must not require '+field);
  assert.deepEqual(current.$defs[definition].properties[field],{type:'object',properties:Object.fromEntries(keys.map(key=>[key,{$ref:'#/$defs/PresentationValue'}])),required:keys,additionalProperties:false});
  delete current.$defs[definition].properties[field];
 }
 delete current.$defs.PresentationValue;
 // Anything beyond the exact whitelist above is still a breaking drift.
 assert.deepEqual(current,JSON.parse(fs.readFileSync(path.join(directory,'schemas/catalog-read.schema.json'),'utf8')));
 const valid=JSON.parse(fs.readFileSync(path.join(directory,'fixtures/valid.json'),'utf8'));
 const cases=JSON.parse(fs.readFileSync(path.join(directory,'fixtures/cases.json'),'utf8'));
 const {validateQuery}=require('../src/opportunities/catalogRead/contractValidation');
 for(const [name,v] of Object.entries(valid))assert.equal(validate(name,v).valid,true,name);
 for(const c of cases){
  const v=structuredClone(c.value===undefined?valid[c.schema]:c.value);
  for(const edit of c.edits||[]){let node=v;for(const k of edit.path.slice(0,-1))node=node[k];if(edit.op==='delete')delete node[edit.path.at(-1)];else node[edit.path.at(-1)]=structuredClone(edit.value);}
  assert.equal((c.pairs?validateQuery(c.schema,c.pairs):validate(c.schema,v)).valid,c.expected,c.id);
 }
});
