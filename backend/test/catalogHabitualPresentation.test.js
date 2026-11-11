 'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadPresentation}=require('../src/opportunities/catalogRead/presentation');
const metadata=require('../../context/references/opportunity-v2/evidence/eu-11145.metadata.json');
const raw=require('../../context/references/opportunity-v2/evidence/eu-11145.json');
const eu=require('../src/fundingTenders/adapterV2').adaptEuOpportunityV2(require('../src/fundingTenders/sourceEvidence').buildEvidence(metadata.externalIdentifier,raw.results),{observedAt:metadata.observedAt});
const pt=require('../../context/references/opportunity-v2/examples/pt2030-8614.json');
test('habitual catalog reuses canonical and verified archived fields without changing revisions',()=>{
 const before=JSON.stringify(eu),present=loadPresentation();
 const list=present.presentSnapshot(eu),detail=present.presentSnapshot(eu,{detail:true});
 assert.ok(list.presentation.areas.value);assert.equal(list.description,undefined);
 assert.equal(detail.callInformation.duration.source,'archived');
 // Mapping v2.1 already carries the narrative; the archived detail is never shorter.
 assert.ok(detail.description.value.length>=eu.description.summary.value.length);assert.notEqual(eu.description.summary.value,eu.description.title.value);
 assert.deepEqual(detail.presentation,list.presentation);assert.equal(JSON.stringify(eu),before);
});
test('habitual catalog refuses archive enrichment for a different revision and keeps PT fields',()=>{
 const present=loadPresentation(),changed=structuredClone(eu);changed.description.title.value+=' changed';
 const data=present.presentSnapshot(changed,{detail:true});
 assert.equal(data.callInformation.duration.source,'unavailable');assert.equal(data.description,undefined);
 const planned=present.presentSnapshot(pt,{detail:true});assert.ok(planned.presentation.typification.value);assert.equal(planned.callInformation.duration.value,null);
});
