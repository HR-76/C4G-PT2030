'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createProtectedAuthoritySnapshot:create}=require('../src/applications/protectedAuthoritySnapshot');
function fixture(){let active=true,now=0,loads=0,groups=0;const actor={id:'user',organizationId:'org',membershipId:'member',membershipVersion:1,authorizationVersion:1};
 const data={membershipPort:{async revalidate(){loads++;return {status:'ACTIVE',validUntil:100}}},authorizationDataPort:{async load(){loads++;return {grants:[{permission:'read'}]}}}};
 const options={actor,data,clock:{now:()=>new Date(now)},assertCurrent:()=>{if(!active)throw Error('stale guard')},withAuthority:async work=>{groups++;return work()}};
 return {actor,data,options,port:create(options),counts:()=>({loads,groups}),expire:()=>{now=100},invalidate:()=>{active=false}};
}
test('protected snapshot loads once per operation but never memoizes decisions or crosses operations',async()=>{
 const f=fixture();await f.port.membershipPort.revalidate(f.actor);const snapshot=await f.port.authorizationDataPort.load(f.actor);
 assert.deepEqual(f.counts(),{loads:2,groups:1});assert(Object.isFrozen(snapshot.grants[0]));
 await f.port.membershipPort.revalidate(f.actor);assert.deepEqual(f.counts(),{loads:2,groups:1});
 await create(f.options).authorizationDataPort.load(f.actor);assert.deepEqual(f.counts(),{loads:4,groups:2});
 await assert.rejects(f.port.membershipPort.revalidate({...f.actor,organizationId:'other'}));
 await assert.rejects(f.port.authorizationDataPort.load({...f.actor,authorizationVersion:2}));
});
for(const fault of ['expire','invalidate'])test('protected snapshot refuses '+fault+' even after loading',async()=>{
 const f=fixture();await f.port.membershipPort.revalidate(f.actor);f[fault]();await assert.rejects(f.port.authorizationDataPort.load(f.actor));
});
test('protected snapshot does not read policy for inactive membership or retry a failed load',async()=>{
 const f=fixture();f.data.membershipPort.revalidate=async()=>null;f.data.authorizationDataPort.load=async()=>assert.fail('inactive');
 assert.equal(await f.port.membershipPort.revalidate(f.actor),null);
 const g=fixture();let calls=0;g.data.membershipPort.revalidate=async()=>{calls++;throw Error('unavailable')};
 await assert.rejects(g.port.membershipPort.revalidate(g.actor));await assert.rejects(g.port.authorizationDataPort.load(g.actor));assert.equal(calls,1);
});
test('a guard invalidated while central reads are in flight cannot publish the snapshot',async()=>{
 const f=fixture();f.data.authorizationDataPort.load=async()=>{f.invalidate();return {grants:[]}};
 await assert.rejects(f.port.membershipPort.revalidate(f.actor),/stale guard/);
});
