"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {createTiming}=require('../src/security/sessionTiming');
test('diagnostic observer failures do not replace successful or failed work',async()=>{
 for(const observer of [()=>{throw Error('observer');},async()=>{throw Error('observer');}]){const t=createTiming(observer);assert.equal(await t.measure('touch.total',async()=>42),42);const e=Error('work');await assert.rejects(t.measure('touch.total',async()=>{throw e;}),x=>x===e);await new Promise(setImmediate);}
});
test('diagnostics isolate windows, preserve samples and reject unbounded labels',()=>{
 const d=require('../../test/integration/catalog-acceptance/session-diagnostics.cjs').createDiagnostics();d.observe('touch.total',42);d.start();d.observe('touch.total',1);d.observe('touch.total',3);assert.throws(()=>d.observe('user-id',3));assert.throws(()=>d.observe('touch.total',NaN));const a=d.finish();assert.equal(a.phases['touch.total'].count,2);assert.equal(a.phases['touch.total'].meanMs,2);d.start();assert.deepEqual(d.finish().phases,{});
});
