'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {install,category}=require('./resource-hooks.cjs');
test('instrumentation preserves values, callbacks, failures, leases and touch completion',async()=>{
 class Client{query(...a){const cb=typeof a.at(-1)==='function'?a.at(-1):a[0]?.callback;const fail=a[0]==='fail';if(a[0]==='throw')throw Error('sync');if(cb){cb(fail?Error('async'):null,42);return 'callback-result';}return fail?Promise.reject(Error('async')):Promise.resolve(42);}}
 class Pool{constructor(){this.options={user:'gcni_acceptance_reader'};}connect(cb){if(this.fail){if(cb)return cb(Error('connect'));return Promise.reject(Error('connect'));}const c=new Client();c.release=()=>{this.releases=(this.releases||0)+1;};if(cb)return cb(null,c,c.release);return Promise.resolve(c);}}
 const session={coordinateSessionStore(){return {touch(id,s,cb){if(id==='throw')throw Error('touch sync');if(!cb)return id==='fail'?Promise.reject(Error('touch async')):Promise.resolve('done');queueMicrotask(()=>cb(null,'done'));}};}};
 const oq=Client.prototype.query,oc=Pool.prototype.connect,h=install({Pool,Client,session});
 const c=new Client(),p=new Pool();h.start();assert.equal(await c.query('SELECT 1'),42);assert.equal(c.query('SELECT 1',(e,v)=>{assert.equal(e,null);assert.equal(v,42);}), 'callback-result');
 assert.equal(c.query({text:'SELECT 1',callback:(e,v)=>assert.equal(v,42)}),'callback-result');await assert.rejects(c.query('fail'),/async/);assert.throws(()=>c.query('throw'),/sync/);
 const acquired=await p.connect();assert.equal(h.pending,1);acquired.release();assert.equal(p.releases,1);
 p.connect((e,client,release)=>{assert.equal(e,null);release();});assert.equal(p.releases,2);
 assert.throws(()=>p.connect((e,client,release)=>{release();throw Error('consumer');}),/consumer/);assert.equal(h.pending,0);
 p.fail=true;await assert.rejects(p.connect(),/connect/);p.connect(e=>assert.match(e.message,/connect/));assert.equal(h.pending,0);
 const store=session.coordinateSessionStore();await new Promise(resolve=>store.touch('x',{},(e,value)=>{assert.equal(value,'done');resolve();}));assert.equal(await store.touch('x',{}),'done');await assert.rejects(store.touch('fail',{}),/touch async/);assert.throws(()=>store.touch('throw',{}),/touch sync/);assert.equal(h.touches,0);
 const result=h.finish();assert.equal(result.metrics['query:other'].count,5);assert.equal(result.metrics['query:other'].errors,2);assert.equal(result.metrics['pool_wait:catalog'].count,5);assert.equal(result.metrics['pool_hold:catalog'].count,3);assert.equal(result.unsupported,0);h.restore();assert.equal(Client.prototype.query,oq);assert.equal(Pool.prototype.connect,oc);
});
test('SQL classifiers keep lock type and schema classes distinct',()=>{assert.equal(category('SELECT pg_advisory_xact_lock_shared(1)'),'shared_lock');assert.equal(category('SELECT pg_advisory_xact_lock(1)'),'exclusive_lock');assert.equal(category('SELECT x AS "tables"'),'core_schema');assert.equal(category('SELECT x AS "relations"'),'projection_schema');});
