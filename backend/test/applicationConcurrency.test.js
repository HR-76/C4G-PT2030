'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {APPLICATION_OPERATIONS,acquireApplicationMutationLock}=require('../src/applications/composition');

test('every application operation has explicit closed access metadata',()=>{
 const methods=Object.entries(APPLICATION_OPERATIONS);
 assert.ok(methods.length>0);
 for(const [method,descriptor] of methods){
  assert.equal(Object.isFrozen(descriptor),true,method);
  assert.deepEqual(Object.keys(descriptor),['code','access'],method);
  assert.match(descriptor.code,/^[A-Z][A-Z0-9_]*$/,method);
  assert.ok(['read','write'].includes(descriptor.access),method);
  if(descriptor.access==='read')assert.match(descriptor.code,/_READ$/,method);
  else assert.doesNotMatch(descriptor.code,/_READ$/,method);
 }
});

test('semantic application reads never acquire the organization advisory lock',async()=>{
 const queries=[],client={query:async(...args)=>{queries.push(args);return{rows:[]}}},organizationId=randomUUID();
 const reads=Object.entries(APPLICATION_OPERATIONS).filter(([,descriptor])=>descriptor.access==='read');
 assert.ok(reads.length>0);
 for(const [method] of reads)assert.equal(await acquireApplicationMutationLock(client,method,organizationId),false,method);
 assert.deepEqual(queries,[]);
});

test('every application command retains the organization advisory lock',async()=>{
 const queries=[],client={query:async(...args)=>{queries.push(args);return{rows:[]}}},organizationId=randomUUID();
 const writes=Object.entries(APPLICATION_OPERATIONS).filter(([,descriptor])=>descriptor.access==='write');
 assert.ok(writes.length>0);
 for(const [method] of writes)assert.equal(await acquireApplicationMutationLock(client,method,organizationId),true,method);
 assert.equal(queries.length,writes.length);
 for(const [sql,params] of queries){
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.deepEqual(params,[organizationId]);
 }
});

