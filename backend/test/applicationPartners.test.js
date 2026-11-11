'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {parse}=require('../src/applications/partners');
const person={id:null,name:'Ana',role:'OUTRO',research_area:'Gestão',contact:'210000000',email:'ana@example.org'};
const partner={entity_name:'Parceiro',country:'Portugal',research_area_interest:'Interesse',responsible_person:'Ana',contact:'',email:'',people:[person]};
const command=()=>({expectedRevision:1,idempotencyKey:randomUUID(),partner});
test('validates exact commands, contacts, stable people IDs and limits',()=>{
 assert.equal(parse('partnerCreate',command()).partner.people[0].role,'OUTRO');
 for(const value of [{...command(),unexpected:true},{...command(),expectedRevision:0},{...command(),partner:{...partner,entity_name:''}},{...command(),partner:{...partner,email:'invalid'}},{...command(),partner:{...partner,people:[{...person,role:'ADMIN'}]}},{...command(),partner:{...partner,people:Array(51).fill(person)}}])assert.throws(()=>parse('partnerCreate',value),{code:'INVALID_INPUT'});
 const id=randomUUID();assert.throws(()=>parse('partnerCreate',{...command(),partner:{...partner,people:[{...person,id},{...person,id}]}}),{code:'INVALID_INPUT'});
 assert.equal(parse('partnerEdit',{...command(),partnerId:randomUUID(),partner:{...partner,people:[{...person,id}]}}).partner.people[0].id,id);
});
test('rejects arbitrary filters, query arrays and non-pilot roles',()=>{
 assert.deepEqual(parse('partnersBrowse',{q:' Ana ',country:'Portugal',person_role:'RESPONSAVEL'}),{q:'Ana',country:'Portugal',person_role:'RESPONSAVEL',cursor:null});
 for(const v of [{country:['Portugal']},{organizationId:randomUUID()},{person_role:'ADMIN'},{cursor:'x'.repeat(4097)}])assert.throws(()=>parse('partnersBrowse',v),{code:'INVALID_INPUT'});
 assert.throws(()=>parse('partnersHistory',{partnerId:randomUUID()}),{code:'INVALID_INPUT'});
});
