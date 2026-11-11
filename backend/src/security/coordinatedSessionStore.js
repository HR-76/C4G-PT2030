'use strict';
const {isDeepStrictEqual}=require('node:util');

// The physical expiry is immutable between authority writes. Only the idle
// deadline rolls; changing auth/physical expiry still requires the SQL permits.
function coordinateSessionStore(store,{coordinator,idleMs,validateSession,now=Date.now,observeTiming=null,coalesceTouches=false}) {
  const timing=require('./sessionTiming').createTiming(observeTiming);
  const raw=Object.fromEntries(['get','set','destroy'].map(name=>[name,store[name].bind(store)]));
  const call=(name,...args)=>new Promise((resolve,reject)=>raw[name](...args,(error,value)=>error?reject(error):resolve(value)));
  const respond=(promise,callback=()=>{})=>promise.then(value=>callback(null,value),callback);
  const copy=value=>JSON.parse(JSON.stringify(value));
  const expiry=value=>new Date(value?.cookie?.expires).getTime();
  function live(value,instant) {
    if(!value)return false;
    const limits=value.c4gExpiry;
    if(limits && (limits.version!==1 || !Number.isSafeInteger(limits.idleUntil)
      || !Number.isSafeInteger(limits.storeUntil) || limits.idleUntil>limits.storeUntil))return false;
    const idleUntil=limits?limits.idleUntil:expiry(value);
    return Number.isFinite(idleUntil)&&idleUntil>instant
      && (!value.auth || (Number.isSafeInteger(value.auth.absoluteExpiresAt)&&value.auth.absoluteExpiresAt>instant));
  }
  function encode(value,instant,previous=null) {
    const result=copy(value);
    const absolute=value.auth?.absoluteExpiresAt;
    const storeUntil=previous?.c4gExpiry?.storeUntil
      ?? Math.ceil((absolute ?? (instant+idleMs))/1000)*1000;
    const idleUntil=Math.min(instant+idleMs,absolute??Infinity,storeUntil);
    if(!Number.isSafeInteger(idleUntil)||idleUntil<=instant)throw Object.assign(Error('SESSION_EXPIRED'),{code:'SESSION_EXPIRED'});
    result.c4gExpiry={version:1,idleUntil,storeUntil};
    // connect-pg-simple derives the physical expire column from cookie.expires.
    // get() restores the idle cookie before handing the session to Express.
    result.cookie={...result.cookie,expires:new Date(storeUntil).toISOString()};
    return result;
  }
  store.get=(sid,callback)=>respond(call('get',sid).then(value=>{
    if(!live(value,now()))return null;
    // Mark a legacy read as previously persisted too, so a late save cannot
    // recreate it after deletion. Version 0 is never written to the store.
    if(!value.c4gExpiry)value.c4gExpiry={version:0,idleUntil:expiry(value),storeUntil:expiry(value)};
    value.cookie={...value.cookie,expires:new Date(value.c4gExpiry.idleUntil).toISOString()};
    return value;
  }),callback);
  store.set=(sid,value,callback)=>respond(coordinator.write([coordinator.sessionKey(sid)],async()=>{
    const previous=await call('get',sid),instant=now();
    // A stale request cannot recreate a previously stored SID after logout.
    if(value.c4gExpiry && !live(previous,instant))return;
    // A fresh anonymous login gets its own idle window under the write permit.
    // Touch and authenticated sessions must retain their physical deadline.
    const freshAnonymousLogin=!value.auth && !previous?.auth
      && typeof value.oidcTransaction?.state==='string' && value.oidcTransaction.state.length>0
      && value.oidcTransaction.state!==previous?.oidcTransaction?.state;
    return call('set',sid,encode(value,instant,freshAnonymousLogin?null:previous));
  }),callback);
  store.destroy=(sid,callback)=>respond(coordinator.write([coordinator.sessionKey(sid)],()=>call('destroy',sid)),callback);
  async function renew(sid,request,legacy=false) {
    const current=await timing.measure('touch.get',()=>call('get',sid)),instant=now();
    if(!live(current,instant)||!isDeepStrictEqual(current.auth,request.auth))return;
    if(!current.c4gExpiry&&!legacy)return 'LEGACY';
    if(current.auth&&!await timing.measure('touch.validate',()=>validateSession({sid,globalUserId:current.auth.user.id,
      revocationVersion:current.auth.revocationVersion,now:instant})))return;
    const finalInstant=now();
    if(!live(current,finalInstant))return;
    // Merge from the current persisted value, never the stale request payload.
    return timing.measure('touch.set',()=>call('set',sid,encode(current,finalInstant,current)));
  }
  const pendingTouches=new Map();
  async function runTouch(sid,value,onStart=()=>{}) {
    const result=await coordinator.withAuthority(()=>{onStart();return renew(sid,value);});
    if(result==='LEGACY')await coordinator.write([coordinator.sessionKey(sid)],()=>renew(sid,value,true));
  }
  function touch(sid,value) {
    // Only waiting, identical maintenance writes can join. The group closes
    // before reading persisted state and validating revocation under the lock.
    // No finished result or authorization decision is retained.
    if(!coalesceTouches||!value?.auth||value.c4gExpiry?.version!==1)return runTouch(sid,value);
    const current=pendingTouches.get(sid);
    if(current&&isDeepStrictEqual(current.auth,value.auth)){
      timing.record('touch.joined',0);return current.promise;
    }
    if(current||pendingTouches.size>=256)return runTouch(sid,value);
    const entry={auth:structuredClone(value.auth),promise:null};
    const remove=()=>{if(pendingTouches.get(sid)===entry)pendingTouches.delete(sid);};
    pendingTouches.set(sid,entry);
    entry.promise=runTouch(sid,{auth:entry.auth},remove).finally(remove);
    return entry.promise;
  }
  store.touch=(sid,value,callback)=>respond(timing.measure('touch.total',()=>touch(sid,value)),callback);
  return store;
}
module.exports={coordinateSessionStore};
