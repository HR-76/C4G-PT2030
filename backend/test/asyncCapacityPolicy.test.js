'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createCapacityPolicy}=require('../src/async/capacityPolicy');

test('non-critical admissions preserve reserved capacity and recover when capacity is freed',()=>{
 const policy=createCapacityPolicy({capacity:10,reserved:3});
 assert.equal(policy.decide({pending:6,category:'NORMAL'}),'ACCEPT');
 assert.equal(policy.decide({pending:7,category:'NORMAL'}),'RETRY_LATER');
 assert.equal(policy.decide({pending:6,category:'NORMAL'}),'ACCEPT');
});
test('critical work uses the reserve but does not exceed total capacity',()=>{
 const policy=createCapacityPolicy({capacity:10,reserved:3});
 assert.equal(policy.decide({pending:7,category:'CRITICAL'}),'ACCEPT');
 assert.equal(policy.decide({pending:9,category:'CRITICAL'}),'ACCEPT');
 assert.equal(policy.decide({pending:10,category:'CRITICAL'}),'RETRY_LATER');
});
test('invalid capacity, pending count, and unknown classifications fail closed',()=>{
 for(const options of [{capacity:0,reserved:0},{capacity:10,reserved:10},{capacity:10,reserved:-1},{capacity:1.5,reserved:0}])assert.throws(()=>createCapacityPolicy(options),TypeError);
 const policy=createCapacityPolicy({capacity:10,reserved:3});
 for(const input of [{pending:-1,category:'NORMAL'},{pending:0.1,category:'NORMAL'},{pending:0,category:'OTHER'},{pending:NaN,category:'CRITICAL'}])assert.throws(()=>policy.decide(input),TypeError);
});
