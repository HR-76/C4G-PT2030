'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomBytes}=require('node:crypto');
const {createReadService}=require('../src/opportunities/catalogRead/readService');
const {createExposureControl,createPolicyStore}=require('../src/opportunities/catalogRead/exposureControl');
const {buildProjection,emptyExtension,stableId}=require('../src/opportunities/catalogRead/model');
const source=require('../../test/integration/catalog-read/snapshot-v2.json');
function setup(){
 const now=Date.parse('2027-01-20T12:00:00.000Z'),org=stableId('control-org'),generationId=stableId('control-generation'),asOf=new Date(now).toISOString();
 const e=emptyExtension(source,{opportunityId:stableId('control-o'),revisionId:stableId('control-r'),extensionId:stableId('control-e'),acceptanceDigest:'a'.repeat(64),recordedAt:asOf}),p=buildProjection(source,e,{asOf});
 const control=createExposureControl({store:createPolicyStore(),clock:()=>now});let calls=0,hook=async()=>{};
 const service=createReadService({repository:{load:async()=>{calls++;await hook();return {id:generationId,asOf,rows:[p]};}},authorize:async principal=>({scope:'current-membership',organizationId:org,baseRoleCode:principal==='admin'?'ORG_ADMIN':'CONTRIBUTOR',expiresAt:now+900000}),key:randomBytes(32),clock:()=>now,exposure:control.reader});
 return {control,org,generationId,get:(path='/opportunities',pairs=[],principal='admin')=>service.request({path,pairs,principal}),calls:()=>calls,hook:f=>hook=f};
}
test('off and non-admin have no repository access; availability exposes no membership identifiers',async()=>{
 const f=setup();await assert.rejects(f.get(),{code:'ACCESS_DENIED'});assert.equal(f.calls(),0);
 await f.control.operator.enable({expectedRevision:0,organizations:[f.org]});await assert.rejects(f.get('/opportunities',[],'client'),{code:'ACCESS_DENIED'});assert.equal(f.calls(),0);
 const a=await f.get('/availability');assert.equal(a.available,true);assert(!JSON.stringify(a).includes(f.org));assert.equal(f.calls(),0);assert.equal((await f.get()).data.length,1);
});
test('disable then re-enable while a read is in flight never releases its prepared response',async()=>{
 const f=setup();await f.control.operator.enable({expectedRevision:0,organizations:[f.org]});let enter,release;const entered=new Promise(r=>enter=r),wait=new Promise(r=>release=r);f.hook(async()=>{enter();await wait});
 const pending=f.get();await entered;await f.control.operator.disable({expectedRevision:1});await f.control.operator.enable({expectedRevision:2,organizations:[f.org]});release();await assert.rejects(pending,{code:'ACCESS_DENIED'});
});
test('a withdrawn generation is denied before repository access even with a previously valid snapshot',async()=>{
 const f=setup();await f.control.operator.enable({expectedRevision:0,organizations:[f.org]});const first=await f.get(),before=f.calls();await f.control.operator.withdraw({expectedRevision:1,generationId:f.generationId});
 await assert.rejects(f.get('/opportunities',[['snapshot',first.meta.snapshot]]),{code:'SNAPSHOT_UNAVAILABLE'});assert.equal(f.calls(),before);
});
