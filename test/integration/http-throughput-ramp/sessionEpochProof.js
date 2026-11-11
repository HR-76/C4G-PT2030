'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {coordinateSessionStore}=require('../../../backend/src/security/coordinatedSessionStore');
async function verify({sid,client,http,central,check,report}){
 const PgStore=require('../../../backend/node_modules/connect-pg-simple')(require('../../../backend/node_modules/express-session'));
 const raw=new PgStore({pool:central.coordinator.pool,schemaName:'public',tableName:'application_session_store',createTableIfMissing:false,pruneSessionInterval:false});
 const store=coordinateSessionStore(raw,{coordinator:central.coordinator,idleMs:1800000,validateSession:central.registry.validateSession});
 const call=(name,...args)=>new Promise((resolve,reject)=>store[name](...args,(e,v)=>e?reject(e):resolve(v)));
 const snapshot=async key=>(await central.pool.query('SELECT sess,expire FROM public.application_session_store WHERE sid=$1',[key])).rows[0];
 const epoch=async key=>(await central.pool.query('SELECT epoch::text FROM public.authority_scope_epoch WHERE scope_key=$1',[central.coordinator.sessionKey(key)])).rows[0]?.epoch;
 const before=await snapshot(sid),beforeEpoch=await epoch(sid);
 const responses=await Promise.all(Array.from({length:4},()=>http(client,'/api/auth/session')));
 assert(responses.every(r=>r.status===200));const after=await snapshot(sid);
 assert.deepEqual(before.sess.auth,after.sess.auth);assert.equal(+before.expire,+after.expire);
 assert(after.sess.c4gExpiry.idleUntil>before.sess.c4gExpiry.idleUntil);assert.equal(await epoch(sid),beforeEpoch);
 check('parallel HTTP renewals extend idle expiry with unchanged auth physical expiry and epochs');
 // The existing SQL trigger still rejects changes of physical expiry/auth.
 for(const payload of [{...after.sess,auth:{...after.sess.auth,revocationVersion:999}},after.sess]){
  await assert.rejects(()=>central.coordinator.withAuthority(()=>central.coordinator.pool.query(
   'INSERT INTO "public"."application_session_store" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid',
   [payload,(+after.expire)/1000+(payload===after.sess?1:0),sid])),e=>e.message==='AUTHORITY_COORDINATOR_REQUIRED');
 }
 check('real triggers still reject auth or physical expiry mutations without write permits');
 let instant=Date.now()+3600000,validationDelay=0;const syntheticSid=randomUUID();
 const boundaryStore=coordinateSessionStore(new PgStore({pool:central.coordinator.pool,schemaName:'public',tableName:'application_session_store',createTableIfMissing:false,pruneSessionInterval:false}),
  {coordinator:central.coordinator,idleMs:1000,validateSession:async args=>{
   const valid=await central.registry.validateSession(args);instant+=validationDelay;return valid;
  },now:()=>instant});
 const boundary=(name,...args)=>new Promise((resolve,reject)=>boundaryStore[name](...args,(e,v)=>e?reject(e):resolve(v)));
 const value=await call('get',sid);delete value.c4gExpiry;value.auth.absoluteExpiresAt=instant+1500;
 try{
  await central.registry.bindSession({sid:syntheticSid,globalUserId:value.auth.user.id,revocationVersion:value.auth.revocationVersion,expiresAt:value.auth.absoluteExpiresAt});
  await boundary('set',syntheticSid,value);const original=await boundary('get',syntheticSid);instant+=900;
  await boundary('touch',syntheticSid,original);const renewed=await boundary('get',syntheticSid);
  assert.equal(renewed.c4gExpiry.idleUntil,value.auth.absoluteExpiresAt);
  instant+=600;assert.equal(await boundary('get',syntheticSid),null);await boundary('touch',syntheticSid,original);
  assert.equal(await boundary('get',syntheticSid),null);
  check('real SQL session adapter caps idle renewal at absolute expiry and refuses expired sessions');
  const oldEpoch=await epoch(syntheticSid);
  await boundary('destroy',syntheticSid);await boundary('touch',syntheticSid,original);await boundary('set',syntheticSid,original);
  assert.equal(await snapshot(syntheticSid),undefined);assert(BigInt(await epoch(syntheticSid))>BigInt(oldEpoch));
  check('logout writer advances epochs and stale SQL touch or save cannot resurrect its SID');
 }finally{await boundary('destroy',syntheticSid);}
 const revokedSid=randomUUID();value.auth.absoluteExpiresAt=instant+10000;
 try{
  await central.registry.bindSession({sid:revokedSid,globalUserId:value.auth.user.id,revocationVersion:value.auth.revocationVersion,expiresAt:value.auth.absoluteExpiresAt});
  await boundary('set',revokedSid,value);const old=await boundary('get',revokedSid),before=await snapshot(revokedSid);
  await central.registry.revokeSession(revokedSid);const revokedEpoch=await epoch(revokedSid);instant+=100;
  await boundary('touch',revokedSid,old);
  assert.deepEqual(await snapshot(revokedSid),before);assert.equal(await epoch(revokedSid),revokedEpoch);
  assert.equal(await central.registry.validateSession({sid:revokedSid,globalUserId:value.auth.user.id,revocationVersion:value.auth.revocationVersion,now:instant}),false);
  check('real revocation prevents idle renewal and remains invalid in the central registry');
 }finally{await boundary('destroy',revokedSid);}
 const crossingSid=randomUUID();value.auth.absoluteExpiresAt=instant+10000;
 try{
  await central.registry.bindSession({sid:crossingSid,globalUserId:value.auth.user.id,revocationVersion:value.auth.revocationVersion,expiresAt:value.auth.absoluteExpiresAt});
  await boundary('set',crossingSid,value);const original=await boundary('get',crossingSid),before=await snapshot(crossingSid);
  instant+=900;validationDelay=101;await boundary('touch',crossingSid,original);validationDelay=0;
  assert.equal(await boundary('get',crossingSid),null);assert.deepEqual(await snapshot(crossingSid),before);
  check('idle expiry crossing during real central validation is rejected at renewal finalization');
 }finally{validationDelay=0;await boundary('destroy',crossingSid);}
 report.sessionRenewal={parallelRequests:responses.length,idleExtended:true,physicalExpiryUnchanged:true,authUnchanged:true,epochUnchanged:true,criticalSqlMutationsRejected:true};
}
module.exports={verify};
