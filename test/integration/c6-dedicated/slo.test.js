'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateAdmissionSlo}=require('./slo');
const slo={approvalStatus:'APPROVED_BY_USER',p95WaitMsMaximum:3000,maxWaitMsMaximum:4000,minObservedHeadroomMs:1000,admissionErrorsMaximum:0,httpFailuresMaximum:0};
const run=(waits,overrides={})=>({index:1,errors:0,host:{controlledChecksPass:true},admissionSlo:{waits,failures:[],dataComplete:true},...overrides});
test('nearest-rank p95 and maximum accept the exact approved boundaries',()=>{
 const r=evaluateAdmissionSlo([run([...Array(18).fill(1000),3000,4000])],slo);
 assert.equal(r.p95Ms,3000);assert.equal(r.maxMs,4000);assert.equal(r.minHeadroomMs,1000);assert.equal(r.verdict,'PASS');
});
test('a low p95 cannot hide a maximum that leaves insufficient headroom',()=>{
 const r=evaluateAdmissionSlo([run([...Array(19).fill(1000),4500])],slo);
 assert.equal(r.p95Ms,1000);assert.equal(r.verdict,'FAIL');assert.deepEqual(r.burstsExceedingMax,[1]);
});
test('p95 above the target fails even when every wait is below the maximum',()=>{
 const r=evaluateAdmissionSlo([run([...Array(18).fill(1000),3100,3500])],slo);
 assert.equal(r.maxMs,3500);assert.equal(r.verdict,'FAIL');
});
test('admission and HTTP failures are not filtered away by good timings',()=>{
 const admission=run([100]);admission.admissionSlo.failures.push({code:'POOL_EXHAUSTED',ms:100});
 assert.equal(evaluateAdmissionSlo([admission],slo).verdict,'FAIL');
 assert.equal(evaluateAdmissionSlo([run([100],{errors:1})],slo).verdict,'FAIL');
});
test('interference or missing measurements cannot produce PASS',()=>{
 const r=evaluateAdmissionSlo([run([100],{host:{controlledChecksPass:false}})],slo);
 assert.equal(r.observedCriteriaPass,true);assert.equal(r.verdict,'INVALID_ENVIRONMENT');
 assert.equal(evaluateAdmissionSlo([run([])],slo).verdict,'INCOMPLETE_EVIDENCE');
 assert.equal(evaluateAdmissionSlo([run([NaN])],slo).verdict,'INCOMPLETE_EVIDENCE');
 assert.equal(evaluateAdmissionSlo([],slo).verdict,'INCOMPLETE_EVIDENCE');
});
test('an unapproved SLO is refused',()=>{
 assert.throws(()=>evaluateAdmissionSlo([run([100])],{...slo,approvalStatus:'PENDING'}),{message:'SLO_NOT_APPROVED'});
});
test('presentation rounding cannot turn a sub-millisecond breach into PASS',()=>{
 assert.equal(evaluateAdmissionSlo([run([...Array(19).fill(1000),4000.001])],slo).verdict,'FAIL');
 assert.equal(evaluateAdmissionSlo([run([...Array(18).fill(1000),3000.001,3500])],slo).verdict,'FAIL');
});
