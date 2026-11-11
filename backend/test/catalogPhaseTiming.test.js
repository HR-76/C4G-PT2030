'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPhaseTiming}=require('../src/opportunities/catalogRead/phaseTiming');
test('phase timing preserves results and original failures even when the observer throws',async()=>{
 const events=[],timed=createPhaseTiming((phase,ms)=>{events.push({phase,ms});throw Error('observer')});const value={ok:true};
 assert.equal(await timed('membership',async()=>value),value);const failure=Error('original');
 await assert.rejects(timed('controls',async()=>{throw failure}),e=>e===failure);
 assert.deepEqual(events.map(e=>e.phase),['membership','controls']);assert(events.every(e=>e.ms>=0));
 assert.equal(await createPhaseTiming(null)('read',()=>value),value);
});
test('profiler separates simultaneous request contexts and only emits fixed numeric phase fields',async()=>{
 const p=require('../../test/integration/catalog-acceptance/phase-profiler.cjs').createProfiler();
 const result=await Promise.all([1,2].map(n=>new Promise(resolve=>p.middleware({}, {},async()=>{p.enter();await new Promise(r=>setTimeout(r,3-n));p.observe('controls',n);p.observe('secret',123);resolve(p.header());}))));
 assert(result[0].includes('controls;dur=1.000'));assert(result[1].includes('controls;dur=2.000'));assert(result.every(v=>!v.includes('secret')));
});
test('an asynchronously failing observer cannot create an unhandled rejection',async()=>{
 const timed=createPhaseTiming(async()=>{throw Error('async observer')});
 assert.equal(await timed('read',async()=>42),42);await new Promise(r=>setImmediate(r));
});
