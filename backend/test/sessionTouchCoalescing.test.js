"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {coordinateSessionStore}=require('../src/security/coordinatedSessionStore');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture({enabled=true}={}){
 let now=100000,valid=true,error=null,tail=Promise.resolve(),jobs=0,sets=0,validations=0,validationGate=null;
 const gate=deferred(),entered=deferred(),rows=new Map();
 const value={auth:{user:{id:'user'},revocationVersion:1,absoluteExpiresAt:110000},c4gExpiry:{version:1,idleUntil:101000,storeUntil:110000},cookie:{expires:new Date(110000).toISOString()}};
 rows.set('sid',structuredClone(value));
 const transaction=work=>{jobs++;const result=tail.then(()=>gate.promise).then(work);tail=result.catch(()=>{});return result;};
 const coordinator={withAuthority:transaction,write:(_keys,work)=>transaction(work),sessionKey:x=>x};
 const store=coordinateSessionStore({get(sid,cb){queueMicrotask(()=>cb(error,structuredClone(rows.get(sid))));},set(sid,v,cb){sets++;rows.set(sid,structuredClone(v));queueMicrotask(()=>cb(null));},destroy(sid,cb){rows.delete(sid);cb(null);}},
 {coordinator,idleMs:1000,now:()=>now,coalesceTouches:enabled,validateSession:async()=>{validations++;entered.resolve();if(validationGate)await validationGate.promise;return valid;}});
 const touch=(sid='sid',v=value)=>new Promise((resolve,reject)=>store.touch(sid,v,e=>e?reject(e):resolve()));
 return {rows,value,touch,release:gate.resolve,entered:entered.promise,blockValidation(){validationGate=deferred();return validationGate.resolve;},advance(ms){now+=ms;},revoke(){valid=false;},fail(e){error=e;},stats:()=>({jobs,sets,validations}),destroy:()=>new Promise((resolve,reject)=>store.destroy('sid',e=>e?reject(e):resolve()))};
}
test('queued identical authenticated touches share one fresh renewal; default remains separate',async()=>{
 for(const enabled of [true,false]){const f=fixture({enabled});f.advance(300);const calls=Array.from({length:10},()=>f.touch());assert.equal(f.stats().jobs,enabled?1:10);f.release();await Promise.all(calls);assert.equal(f.stats().sets,enabled?1:10);assert.equal(f.stats().validations,enabled?1:10);assert.equal(f.rows.get('sid').c4gExpiry.idleUntil,101300);assert.equal(f.rows.get('sid').c4gExpiry.storeUntil,110000);await f.touch();assert.equal(f.stats().jobs,enabled?2:11,'no completed-result cache');}
});
test('different auth, session id, anonymous and legacy touches never join an incompatible group',async()=>{
 const f=fixture();const changed=structuredClone(f.value);changed.auth.revocationVersion++;
 const anon={cookie:f.value.cookie,c4gExpiry:f.value.c4gExpiry};const legacy={...f.value,c4gExpiry:undefined};
 const calls=[f.touch(),f.touch('sid',changed),f.touch('other'),f.touch('sid',anon),f.touch('sid',legacy)];assert.equal(f.stats().jobs,5);f.release();await Promise.all(calls);
});
test('a renewal already validating cannot absorb a later touch',async()=>{
 const f=fixture(),releaseValidation=f.blockValidation();f.release();const first=f.touch();await f.entered;const second=f.touch();assert.equal(f.stats().jobs,2);releaseValidation();await Promise.all([first,second]);assert.equal(f.stats().validations,2);
});
test('storage failure reaches all joined callers and does not poison retry',async()=>{
 const f=fixture(),error=Error('synthetic');f.fail(error);const calls=[f.touch(),f.touch()];const results=Promise.allSettled(calls);assert.equal(f.stats().jobs,1);f.release();assert((await results).every(r=>r.status==='rejected'&&r.reason===error));f.fail(null);await f.touch();assert.equal(f.stats().jobs,2);assert.equal(f.stats().sets,1);
});
test('revocation, deletion and expiry still prevent renewal; current data and deadlines are preserved',async()=>{
 for(const action of ['revoke','delete','idle','absolute']){const f=fixture();const before=structuredClone(f.value);const calls=[f.touch(),f.touch()];if(action==='revoke')f.revoke();if(action==='delete')f.rows.delete('sid');if(action==='idle')f.advance(1000);if(action==='absolute')f.advance(10000);f.release();await Promise.all(calls);assert.equal(f.stats().sets,0);if(action!=='delete')assert.deepEqual(f.rows.get('sid'),before);}
 const f=fixture();const done=f.destroy();const calls=[f.touch(),f.touch()];f.release();await Promise.all([done,...calls]);assert.equal(f.rows.has('sid'),false);
});
test('expiry during validation and mutation of stale request cannot resurrect or replace auth',async()=>{
 const f=fixture(),release=f.blockValidation();f.release();const calls=[f.touch(),f.touch()];await f.entered;f.advance(1000);release();await Promise.all(calls);assert.equal(f.stats().sets,0);
 const g=fixture();const calls2=[g.touch(),g.touch()];g.value.auth.revocationVersion=42;g.rows.get('sid').currentOnly='preserve';g.advance(500);g.release();await Promise.all(calls2);assert.equal(g.rows.get('sid').auth.revocationVersion,1);assert.equal(g.rows.get('sid').currentOnly,'preserve');assert.equal(g.stats().sets,1);
});
test('pending-group limit falls back safely without dropping a renewal',async()=>{
 const f=fixture(),calls=[];for(let i=0;i<257;i++){const sid='sid'+i;f.rows.set(sid,structuredClone(f.value));calls.push(f.touch(sid));}calls.push(f.touch('sid256'));assert.equal(f.stats().jobs,258);f.release();await Promise.all(calls);assert.equal(f.stats().sets,258);
});

test('production composition refuses coalescing without a genuine isolated capability',()=>{
 const {createProductionComposition}=require('../src/productionComposition');
 for(const isolatedCatalogAdmission of [null,{}, {isolated:true}])assert.throws(()=>createProductionComposition({isolatedSessionTouchCoalescing:true,isolatedCatalogAdmission}),/Isolated admission required for session touch coalescing/);
});

test('capturing a pending auth context must preserve strict equality including undefined fields',async()=>{
 const f=fixture();f.value.auth.extra=undefined;const call=f.touch();f.release();await call;assert.equal(f.stats().sets,0,'normalizing away a field must not turn unequal auth into equal auth');
});
