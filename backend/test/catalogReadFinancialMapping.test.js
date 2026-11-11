'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildProjection,emptyExtension,stableId}=require('../src/opportunities/catalogRead/model');
const {validate}=require('../src/opportunities/catalogRead/contractValidation');
const fixture=require('../../test/integration/catalog-read/snapshot-v2.json');
function project(change){const s=structuredClone(fixture);change(s);const e=emptyExtension(s,{opportunityId:stableId('financial-opp'),revisionId:stableId('financial-rev'),extensionId:stableId('financial-ext'),acceptanceDigest:'a'.repeat(64),recordedAt:'2027-01-20T11:00:00.000Z'});return buildProjection(s,e,{asOf:'2027-01-20T12:00:00.000Z'});}
test('support units, exact decimals and original conditions reach G1 without becoming total funding',()=>{
 for(const unit of ['PER_PROJECT','PER_PERSON','PER_MONTH','PER_PERSON_MONTH','OTHER']){
  const p=project(s=>{s.financing.support.value[0].unit=unit;s.financing.support.value[0].minimum='0';s.financing.support.value[0].maximum='999999999999999999999999.12345678';});
  const row=p.collections.fundingRules[0];assert.match(row.conditions,/999999999999999999999999\.12345678/);assert(row.conditions.includes(unit));assert.match(row.conditions,/Mínimo publicado: 0/);assert.equal(row.baseRate.state,'NOT_APPLICABLE');assert.equal(p.detail.summary.funding.value.amount,'120000');assert.equal(validate('FundingRule',row).valid,true);
 }
});
test('rate ranges and point rates do not invent base, bonus or cap semantics',()=>{
 for(const bounds of [[null,'80'],['20',null],['20','80'],['80','80'],['0','0']]){
  const p=project(s=>{s.financing.rates={state:'PRESENT',value:[{minimumPercent:bounds[0],maximumPercent:bounds[1],scope:'PME',conditions:'Conforme região'}],evidenceRefs:['budget'],reason:null};});
  const r=p.collections.fundingRules[1];assert.equal(r.baseRate.state,'UNSUPPORTED');assert.equal(r.capRate.value,null);assert.match(r.conditions,/PME/);assert.match(r.conditions,/Conforme região/);for(const bound of bounds)if(bound!==null)assert(r.conditions.includes(bound+'%'));assert.equal(validate('FundingRule',r).valid,true);
 }
});
test('eligible costs retain bounds, unknown currency and evidence, without summing allocations',()=>{
 const p=project(s=>{s.financing.eligibleCosts={state:'PRESENT',value:[{minimum:'100',maximum:'200',currency:structuredClone(s.financing.allocations.value[0].money.currency),scope:'Operação',conditions:'Despesa elegível'}],evidenceRefs:['budget'],reason:null};s.financing.allocations.value[0].period='2026–2027';});
 const row=p.collections.fundingRules[1];assert.match(row.conditions,/100/);assert.match(row.conditions,/200/);assert.match(row.conditions,/NOT_FOUND/);assert.equal(row.evidenceIds.length,2);assert.equal(p.collections.funding[0].period,'2026–2027');
});
test('financial conflicts remain explicit in rules and quality',()=>{
 const p=project(s=>{s.financing.rates={state:'CONFLICT',value:null,evidenceRefs:['budget','monthly-support'],reason:'DIVERGENT_VALUES'};});
 assert.equal(p.collections.fundingRules[1].baseRate.state,'CONFLICT');assert(p.detail.summary.quality.flags.includes('conflicted'));
});
test('shared allocations retain qualifiers and do not masquerade as a call total',()=>{
 const p=project(s=>{const a=s.financing.allocations.value[0];a.scope='TOPIC_OR_SHARED';a.aggregation='SHARED';a.sharedGroup='shared-programme';a.qualifiers=['ESTIMATE'];});
 assert.equal(p.detail.summary.funding.state,'UNSUPPORTED');assert(p.collections.funding[0].money.value.sharedGroupId);assert.match(p.collections.fundingRules[0].conditions,/SHARED/);assert.match(p.collections.fundingRules[0].conditions,/ESTIMATE/);assert.equal(p.collections.funding.length,1);
});
test('unexplained zero remains explicitly qualified instead of implying no funding',()=>{
 const p=project(s=>{const a=s.financing.allocations.value[0];a.money.amount='0';a.money.interpretation='ZERO_UNEXPLAINED';});
 assert.match(p.collections.fundingRules[0].conditions,/ZERO_UNEXPLAINED/);
 assert.equal(p.detail.summary.funding.state,'UNSUPPORTED');
});
