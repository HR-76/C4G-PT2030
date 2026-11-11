'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createAuthorityCoordinator}=require('../../../backend/src/security/authorityCoordinator');
const protocol=require('../../../backend/src/security/authorityProtocolQueries');
const lookup='SELECT sess FROM "public"."application_session_store" WHERE sid = $1 AND expire >= to_timestamp($2)';
const remove='DELETE FROM "public"."application_session_store" WHERE sid = $1';
async function prove({db,isolatedAdmission}){
 const sid='isolated-concurrency-'+randomUUID();let release,held=0,writerPid=null,probeDone=false;
 const barrier=new Promise(r=>release=r),readers=[];
 const wait=async predicate=>{const until=Date.now()+5000;while(!await predicate()){if(Date.now()>until)throw Error('SESSION_CONCURRENCY_PROOF_TIMEOUT');await new Promise(r=>setTimeout(r,10));}};
 const wrapped=kind=>({query:(...args)=>db.central.authorityPool.query(...args),async connect(){
  const c=await db.central.authorityPool.connect();
  return {on:(...args)=>c.on(...args),removeListener:(...args)=>c.removeListener(...args),release:(...args)=>c.release(...args),async query(sql,values){
   if(kind==='writer'&&sql==='SELECT pg_advisory_xact_lock(43001306,1)')writerPid=c.processID;
   const result=await c.query(sql,values);
   if(kind==='reader'&&sql==='SELECT pg_advisory_xact_lock_shared(43001306,1)'){
    assert.equal((await c.query('SHOW transaction_read_only')).rows[0].transaction_read_only,'on');
    if(!probeDone){probeDone=true;await c.query('SAVEPOINT readonly_probe');await assert.rejects(protocol.execute(c,remove,[sid]),{code:'25006'});await c.query('ROLLBACK TO SAVEPOINT readonly_probe');await c.query('RELEASE SAVEPOINT readonly_probe');}
    held++;await barrier;
   }
   return result;
  }};
 }});
 const make=kind=>createAuthorityCoordinator({pool:wrapped(kind),permitSecret:db.central.permitSecret,isolatedCatalogAdmission:isolatedAdmission,isolatedSessionReadConcurrency:true});
 const reader=make('reader'),writer=make('writer');let writing;
 try{
  await writer.write([writer.sessionKey(sid)],()=>writer.pool.query('INSERT INTO "public"."application_session_store" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid',[{synthetic:true},Math.floor(Date.now()/1000)+300,sid]));
  writerPid=null;
  readers.push(reader.pool.query(lookup,[sid,Math.floor(Date.now()/1000)]));readers.push(reader.pool.query(lookup,[sid,Math.floor(Date.now()/1000)]));
  // Attach rejection handlers immediately while the proof deliberately holds locks.
  readers.forEach(p=>p.catch(()=>{}));await wait(()=>held===2);
  writing=writer.write([writer.sessionKey(sid)],()=>writer.pool.query(remove,[sid]));writing.catch(()=>{});
  await wait(async()=>writerPid&&(await db.central.pool.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND classid=43001306 AND objid=1 AND mode='ExclusiveLock' AND NOT granted) AS waiting",[writerPid])).rows[0].waiting);
  assert.equal(held,2);release();const result=await Promise.all(readers);assert(result.every(r=>r.rows.length===1));await writing;
  assert.equal((await reader.pool.query(lookup,[sid,Math.floor(Date.now()/1000)])).rows.length,0);
  return {simultaneousReaders:2,exclusiveWriterWaitObserved:true,readOnlyWriteRejected:true,postDeleteReadEmpty:true};
 }finally{release();await Promise.allSettled([...readers,...(writing?[writing]:[])]);}
}
module.exports={prove};
