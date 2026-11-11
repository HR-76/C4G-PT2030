'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createPolicyStore,createExposureControl}=require('../src/opportunities/catalogRead/exposureControl');
const org=randomUUID(),generation=randomUUID(),admin={organizationId:org,baseRoleCode:'ORG_ADMIN',scope:'verified-membership',expiresAt:999999};
function setup(){let now=1000;const store=createPolicyStore(),control=createExposureControl({store,clock:()=>now});return {store,...control,setNow:n=>now=n};}
test('default off, admin membership only, CAS and lease expiry',async()=>{
 const f=setup();await assert.rejects(f.reader.begin(admin),{code:'ACCESS_DENIED'});
 await f.operator.enable({expectedRevision:0,organizations:[org],roles:['ORG_ADMIN'],leaseMs:10000});
 const ticket=await f.reader.begin(admin);assert.equal(ticket.revision,1);
 await assert.rejects(f.reader.begin({...admin,organizationId:randomUUID()}),{code:'ACCESS_DENIED'});
 await assert.rejects(f.reader.begin({...admin,baseRoleCode:'CONTRIBUTOR'}),{code:'ACCESS_DENIED'});
 await assert.rejects(f.operator.disable({expectedRevision:0}),/POLICY_VERSION_CONFLICT/);
 f.setNow(11000);await assert.rejects(f.reader.check(ticket,admin,generation),{code:'ACCESS_DENIED'});
});
test('rollback invalidates in-flight work and withdrawn generations stay blocked after reopening',async()=>{
 const f=setup();await f.operator.enable({expectedRevision:0,organizations:[org],roles:['ORG_ADMIN']});const ticket=await f.reader.begin(admin);
 await f.operator.disable({expectedRevision:1});await f.operator.enable({expectedRevision:2,organizations:[org],roles:['ORG_ADMIN']});
 await assert.rejects(f.reader.check(ticket,admin,generation),{code:'ACCESS_DENIED'});
 await f.operator.withdraw({expectedRevision:3,generationId:generation});const fresh=await f.reader.begin(admin);
 await assert.rejects(f.reader.check(fresh,admin,generation),{code:'SNAPSHOT_UNAVAILABLE'});
 await f.operator.disable({expectedRevision:4});await f.operator.enable({expectedRevision:5,organizations:[org],roles:['ORG_ADMIN']});
 await assert.rejects(f.reader.check(await f.reader.begin(admin),admin,generation),{code:'SNAPSHOT_UNAVAILABLE'});
});
test('independent readers observe shared policy and storage failure closes access',async()=>{
 const f=setup(),second=createExposureControl({store:f.store,clock:()=>1000});await f.operator.enable({expectedRevision:0,organizations:[org],roles:['ORG_ADMIN']});const t=await second.reader.begin(admin);
 await f.operator.disable({expectedRevision:1});await assert.rejects(second.reader.check(t,admin,generation),{code:'ACCESS_DENIED'});
 const broken=createExposureControl({store:{read:async()=>{throw Error('unavailable')},compareAndSet:async()=>{}},clock:()=>1000});await assert.rejects(broken.reader.begin(admin),{code:'CATALOG_UNAVAILABLE'});
});

test('invalid or excessive leases and malformed policies cannot open the reader',async()=>{
 const f=setup();assert.throws(()=>f.operator.enable({expectedRevision:0,organizations:[org],leaseMs:300001}),/INVALID_EXPOSURE_LEASE/);
 await assert.rejects(f.operator.enable({expectedRevision:0,organizations:[org],roles:['C4G_ADMIN']}),/INVALID_EXPOSURE_POLICY/);
 const rogue=createExposureControl({store:{read:async()=>({revision:1,mode:'COHORT',organizations:[org],roles:['ORG_ADMIN'],blockedGenerations:[],expiresAt:999999999}),compareAndSet:async()=>{}},clock:()=>1000});
 await assert.rejects(rogue.reader.begin(admin),{code:'CATALOG_UNAVAILABLE'});
 const malformed=createExposureControl({store:{read:async()=>({mode:'COHORT'}),compareAndSet:async()=>{}},clock:()=>1000});await assert.rejects(malformed.reader.begin(admin),{code:'CATALOG_UNAVAILABLE'});
});
