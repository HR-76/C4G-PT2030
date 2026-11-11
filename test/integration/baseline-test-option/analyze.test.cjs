'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {analyze}=require('./analyze.cjs');
const start=Date.parse('2026-01-01T00:00:00Z'),day=86400000,sourceHash='a'.repeat(64);
function entry(i,override={}){return {sourceHash,cleanup:'PASS',variant:'B',report:{startedAt:new Date(start+i*day).toISOString(),status:'COMPLETE',integrity:{unchanged:true},pages:Array.from({length:3},(_,j)=>({route:'/candidaturas',mode:'load',ms:i*3+j+1,requests:[{path:'/api/applications/browse',status:200}]})),...override}};}
test('complete thirty-day synthetic window computes nearest-rank p95 with full coverage',()=>{const result=analyze(Array.from({length:30},(_,i)=>entry(i)),{startMs:start,nowMs:start+30*day});assert.equal(result.status,'COMPLETE');assert.equal(result.opening.samples,90);assert.equal(result.opening.p95Ms,86);});
test('missing days, unfinished windows, failures and source drift cannot produce a passing baseline',()=>{
 const full=Array.from({length:30},(_,i)=>entry(i));
 for(const [data,now] of [[full.slice(1),start+30*day],[full,start+29*day],[[...full.slice(0,29),entry(29,{status:'FAIL'})],start+30*day],[[...full.slice(0,29),{...entry(29),sourceHash:'b'.repeat(64)}],start+30*day]]){
  const result=analyze(data,{startMs:start,nowMs:now});assert.equal(result.status,'INSUFFICIENT_EVIDENCE');assert.equal(result.opening.p95Ms,null);
 }
});
test('outside-window runs are not credited and HTTP errors remain failed evidence',()=>{
 const report=entry(0);report.report.pages[0].requests[0].status=503;
 const result=analyze([report,entry(30)],{startMs:start,nowMs:start+30*day});assert.equal(result.coverage.failedRuns,1);assert.equal(result.coverage.outsideWindow,1);assert.equal(result.opening.samples,0);
});
test('duplicate reports and missing primary HTTP responses cannot inflate coverage',()=>{
 const item={...entry(0),id:'same'};assert.throws(()=>analyze([item,item],{startMs:start,nowMs:start+day}),/Duplicate/);
 const missing=entry(0);missing.report.pages[0].requests=[];const result=analyze([missing],{startMs:start,nowMs:start+day});assert.equal(result.coverage.failedRuns,1);assert.equal(result.opening.samples,0);
});
test('unconfirmed container cleanup cannot count as a successful run',()=>{const result=analyze([{...entry(0),cleanup:'FAIL'}],{startMs:start,nowMs:start+day});assert.equal(result.coverage.failedRuns,1);});
