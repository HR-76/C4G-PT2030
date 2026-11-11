'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {coordinateSessionStore}=require('../src/security/coordinatedSessionStore');
function fixture(){
 let now=100000,epoch=0,active=true,validationDelay=0,tail=Promise.resolve();const rows=new Map();
 const copy=v=>v==null?v:JSON.parse(JSON.stringify(v));
 const transaction=work=>{const result=tail.then(work);tail=result.catch(()=>{});return result;};
 const coordinator={sessionKey:sid=>'SESSION:'+sid,withAuthority:transaction,write:(_keys,work)=>transaction(()=>{epoch++;return work();})};
 const raw={get(sid,cb){queueMicrotask(()=>cb(null,copy(rows.get(sid))));},set(sid,v,cb){rows.set(sid,copy(v));queueMicrotask(()=>cb(null));},destroy(sid,cb){rows.delete(sid);queueMicrotask(()=>cb(null));}};
 const store=coordinateSessionStore(raw,{coordinator,idleMs:1000,now:()=>now,validateSession:async()=>{now+=validationDelay;return active;}});
 const call=(name,...args)=>new Promise((resolve,reject)=>store[name](...args,(error,v)=>error?reject(error):resolve(v)));
 const session={cookie:{expires:new Date(now+1000).toISOString(),originalMaxAge:1000},auth:{user:{id:'user'},revocationVersion:1,absoluteExpiresAt:now+10000}};
 return {call,session,rows,advance:ms=>{now+=ms;},epoch:()=>epoch,revoke:()=>{active=false;},delayValidation:ms=>{validationDelay=ms;}};
}
test('rolling idle expiry preserves auth, physical expiry and epochs across concurrent reads',async()=>{
 const f=fixture();await f.call('set','sid',f.session);const before=structuredClone(f.rows.get('sid')),epoch=f.epoch();
 const stale=await f.call('get','sid');stale.unrelated='stale request data';f.advance(500);
 await Promise.all(Array.from({length:8},()=>f.call('touch','sid',stale)));
 const after=f.rows.get('sid');assert.deepEqual(after.auth,before.auth);assert.equal(after.cookie.expires,before.cookie.expires);
 assert.equal(after.c4gExpiry.idleUntil,before.c4gExpiry.idleUntil+500);assert.equal(after.unrelated,undefined);assert.equal(f.epoch(),epoch);
 f.advance(600);assert(await f.call('get','sid'),'session survives original idle deadline');
 f.advance(400);assert.equal(await f.call('get','sid'),null,'renewed idle deadline is enforced');
});
test('renewal never exceeds absolute expiry or revives idle/absolute expiry',async()=>{
 const f=fixture();f.session.auth.absoluteExpiresAt=101500;await f.call('set','sid',f.session);const stale=await f.call('get','sid');
 f.advance(900);await f.call('touch','sid',stale);assert.equal(f.rows.get('sid').c4gExpiry.idleUntil,101500);
 f.advance(600);await f.call('touch','sid',stale);assert.equal(await f.call('get','sid'),null);
 const g=fixture();await g.call('set','sid',g.session);g.advance(1001);await g.call('touch','sid',g.session);assert.equal(await g.call('get','sid'),null);
 const h=fixture();await h.call('set','sid',h.session);h.advance(900);h.delayValidation(101);
 await h.call('touch','sid',h.session);assert.equal(await h.call('get','sid'),null,'expiry during central validation must not be revived');
});
test('revoked or replaced auth cannot be renewed by an older request',async()=>{
 const f=fixture();await f.call('set','sid',f.session);const original=structuredClone(f.rows.get('sid'));f.advance(500);f.revoke();
 await f.call('touch','sid',f.session);assert.deepEqual(f.rows.get('sid'),original);
 const g=fixture();await g.call('set','sid',g.session);g.rows.get('sid').auth.revocationVersion=2;g.advance(500);
 await g.call('touch','sid',g.session);assert.equal(g.rows.get('sid').auth.revocationVersion,2);assert.equal(g.rows.get('sid').c4gExpiry.idleUntil,101000);
});
test('logout races cannot resurrect a session through touch or a stale save; writes still change epochs',async()=>{
 for(const reverse of [false,true]){
  const f=fixture();await f.call('set','sid',f.session);const stale=await f.call('get','sid'),epoch=f.epoch();f.advance(500);
  await Promise.all(reverse?[f.call('destroy','sid'),f.call('touch','sid',stale)]:[f.call('touch','sid',stale),f.call('destroy','sid')]);
  assert.equal(await f.call('get','sid'),null);await f.call('set','sid',stale);assert.equal(await f.call('get','sid'),null);assert(f.epoch()>epoch);
 }
});
test('legacy sessions convert once through the writer, then refresh without changing epochs',async()=>{
 const f=fixture();f.rows.set('sid',structuredClone(f.session));f.advance(100);await f.call('touch','sid',f.session);
 assert.equal(f.epoch(),1);assert.equal(f.rows.get('sid').c4gExpiry.version,1);f.advance(100);await f.call('touch','sid',f.session);assert.equal(f.epoch(),1);
 const g=fixture();g.rows.set('sid',structuredClone(g.session));const stale=await g.call('get','sid');await g.call('destroy','sid');
 await g.call('set','sid',stale);assert.equal(await g.call('get','sid'),null,'legacy stale save cannot recreate the SID');
});
test('malformed persisted expiry is rejected and storage failures reach the caller',async()=>{
 const f=fixture();await f.call('set','sid',f.session);f.rows.get('sid').c4gExpiry.idleUntil=Infinity;assert.equal(await f.call('get','sid'),null);
 const failure=Error('synthetic');const store=coordinateSessionStore({get(_sid,cb){cb(failure);},set(){},destroy(){}},
  {coordinator:{withAuthority:fn=>fn()},idleMs:1000,validateSession:async()=>true});
 await assert.rejects(new Promise((resolve,reject)=>store.get('sid',(error,v)=>error?reject(error):resolve(v))),e=>e===failure);
});
test('a fresh anonymous OIDC attempt survives the previous physical expiry',async()=>{
 const f=fixture();delete f.session.auth;
 f.session.oidcTransaction={state:'first',createdAt:100000};
 await f.call('set','sid',f.session);const old=structuredClone(f.rows.get('sid'));
 f.advance(900);const retry=await f.call('get','sid');
 retry.oidcTransaction={state:'second',createdAt:100900};
 await f.call('set','sid',retry);
 assert(f.rows.get('sid').c4gExpiry.storeUntil>old.c4gExpiry.storeUntil);
 f.advance(200);assert.equal((await f.call('get','sid'))?.oidcTransaction.state,'second');
 f.advance(800);assert.equal(await f.call('get','sid'),null,'the renewed idle deadline still applies');
});
test('anonymous touch and repeated save of the same OIDC attempt preserve physical expiry',async()=>{
 const f=fixture();delete f.session.auth;f.session.oidcTransaction={state:'first',createdAt:100000};
 await f.call('set','sid',f.session);const original=f.rows.get('sid').c4gExpiry.storeUntil;
 const value=await f.call('get','sid');f.advance(500);
 await f.call('touch','sid',value);assert.equal(f.rows.get('sid').c4gExpiry.storeUntil,original);
 await f.call('set','sid',value);assert.equal(f.rows.get('sid').c4gExpiry.storeUntil,original);
});
test('fresh OIDC attempts cannot resurrect an expired or deleted anonymous session',async()=>{
 for(const deleted of [false,true]){
  const f=fixture();delete f.session.auth;f.session.oidcTransaction={state:'first',createdAt:100000};
  await f.call('set','sid',f.session);const stale=await f.call('get','sid');
  if(deleted)await f.call('destroy','sid');else f.advance(1000);
  stale.oidcTransaction={state:'second',createdAt:101000};await f.call('set','sid',stale);
  assert.equal(await f.call('get','sid'),null);
 }
});
test('starting OIDC within an authenticated session cannot extend its physical or absolute expiry',async()=>{
 const f=fixture();f.session.auth.absoluteExpiresAt=101000;
 await f.call('set','sid',f.session);const original=structuredClone(f.rows.get('sid'));
 f.advance(900);const value=await f.call('get','sid');value.oidcTransaction={state:'step-up',createdAt:100900};
 await f.call('set','sid',value);assert.equal(f.rows.get('sid').c4gExpiry.storeUntil,original.c4gExpiry.storeUntil);
 assert.equal(f.rows.get('sid').auth.absoluteExpiresAt,original.auth.absoluteExpiresAt);
 f.advance(100);assert.equal(await f.call('get','sid'),null);
});
test('authenticated authority bounds protected operation deadlines by server-side idle expiry',async()=>{
 const {randomUUID}=require('node:crypto'),{createTaxonomySessionAuthority}=require('../src/security/authenticatedAuthority');
 const user=randomUUID(),org=randomUUID(),member=randomUUID(),sid='idle-authority-test';let now=100000;
 const context={organizationId:org,membershipId:member,membershipVersion:1};
 const stored={cookie:{expires:new Date(101000).toISOString()},auth:{user:{id:user},revocationVersion:1,absoluteExpiresAt:200000,
  organizationContext:context,policyVersion:'policy-v1',evidence:{policyVersion:'policy-v1'}}};
 const authority=createTaxonomySessionAuthority({sessionStore:{get(_sid,cb){cb(null,stored);}},
  sessionRegistry:{validateSession:async()=>true,resolveOrganizationContext:async()=>({state:'VALID',context,expiresAt:200000})},
  membershipPort:{revalidate:async()=>({id:member,organizationId:org,globalUserId:user,membershipVersion:1,status:'ACTIVE',validUntil:null})},
  authorizationDataPort:{load:async()=>({organizationId:org,membershipVersion:1,authorizationVersion:1})},policyVersion:'policy-v1',clock:{now:()=>new Date(now)}});
 const handle=await authority.captureAuthenticatedRequest({sessionID:sid,user:{id:user},authContext:{sessionId:sid},organizationContext:context});
 assert.equal((await authority.guardIdentity(handle)).expiresAt,101000);now=101000;
 await assert.rejects(()=>authority.guardIdentity(handle),e=>e.code==='AUTHORITY_REQUIRED');
});
