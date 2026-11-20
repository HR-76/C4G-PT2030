'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createOrganizationMatching}=require('../src/organizationDirectory/matching');
const area=require('../src/organizationDirectory/thematicAreas');
function fixture(options={}){
 const state={central:0,privateReads:0,directory:0,fail:false,elapsed:0,hold:null};
 const areaId=(area.areas||area.catalog||[])[0]?.id||'area';
 const service=createOrganizationMatching({
  directory:{execute:async()=>{state.directory++;return {person:{active:true},profile:{areaIds:[areaId]}};}},
  opportunities:{list:async()=>{state.privateReads++;return {items:[]};}},
  central:{list:async()=>{state.central++;if(state.hold)await state.hold;if(state.fail)throw Object.assign(Error('central unavailable'),{code:'SERVICE_UNAVAILABLE'});return {items:[]};}},
  clock:()=>new Date('2026-11-14T12:00:00Z'),centralPagesNow:()=>state.elapsed,...options});
 return {state,service};
}
test('without a reuse period every matching reads the central catalogue',async()=>{
 const {state,service}=fixture();
 await service.execute({},{});await service.execute({},{});
 assert.equal(state.central,2);
});
test('the central catalogue is reused for the period; the person and the private opportunities are read every time',async()=>{
 const {state,service}=fixture({centralPagesReuseMs:30000});
 assert.equal((await service.execute({},{})).state,'READY');
 state.elapsed=29999;await service.execute({},{});
 assert.equal(state.central,1);assert.equal(state.privateReads,2);assert.equal(state.directory,4,'the profile is read before and revalidated after each matching');
 state.elapsed=30000;await service.execute({},{});
 assert.equal(state.central,2);assert.equal(state.privateReads,3);
});
test('simultaneous matchings share one central read',async()=>{
 const {state,service}=fixture({centralPagesReuseMs:30000});
 let release;state.hold=new Promise(resolve=>{release=resolve;});
 const answers=Promise.all([service.execute({},{}),service.execute({},{}),service.execute({},{})]);
 await new Promise(resolve=>setTimeout(resolve,50));release();
 for(const answer of await answers)assert.equal(answer.state,'READY');
 assert.equal(state.central,1);assert.equal(state.privateReads,3);
});
test('a failed central read is never reused',async()=>{
 const {state,service}=fixture({centralPagesReuseMs:30000});
 state.fail=true;await assert.rejects(service.execute({},{}));
 state.fail=false;assert.equal((await service.execute({},{})).state,'READY');
 assert.equal(state.central,2);
});
