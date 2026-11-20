'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createProductionAccountReadiness}=require('../src/platformOnboarding/productionReadiness');

test('production invitations require the exact registered account lifecycle schema on every readiness check',async()=>{
 const pool={},calls=[],failure=Error('schema drift');let fail=false;
 const ready=createProductionAccountReadiness({env:{CENTRAL_RUNTIME_PROFILE:'production-v1',MEMBER_ONBOARDING_RUNTIME:'central'},pool,
  assertSchema:async(...args)=>{calls.push(args);if(fail)throw failure;return {version:'058_platform_account_lifecycle'};}});
 await ready();fail=true;
 await assert.rejects(ready,error=>error===failure);
 assert.deepEqual(calls,[[pool,['058_platform_account_lifecycle']],[pool,['058_platform_account_lifecycle']]]);
});

test('production deletion with invitations shares the same exact schema gate',async()=>{
 const calls=[],pool={};
 const ready=createProductionAccountReadiness({env:{CENTRAL_RUNTIME_PROFILE:'production-v1',MEMBER_ONBOARDING_RUNTIME:'central',USER_DELETION_RUNTIME:'central'},pool,
  assertSchema:async(...args)=>calls.push(args)});
 await ready();assert.deepEqual(calls,[[pool,['058_platform_account_lifecycle']]]);
});

test('production deletion cannot be selected without its invitation worker runtime',()=>{
 for(const memberSelection of [undefined,'disabled']){
  assert.throws(()=>createProductionAccountReadiness({env:{CENTRAL_RUNTIME_PROFILE:'production-v1',MEMBER_ONBOARDING_RUNTIME:memberSelection,USER_DELETION_RUNTIME:'central'},pool:{}}),/PRODUCTION_DELETION_REQUIRES_MEMBER_RUNTIME/);
 }
});

test('production selectors are closed before any schema operation',()=>{
 for(const field of ['MEMBER_ONBOARDING_RUNTIME','USER_DELETION_RUNTIME']){
  assert.throws(()=>createProductionAccountReadiness({env:{CENTRAL_RUNTIME_PROFILE:'production-v1',[field]:'unknown'},pool:{}}),/PRODUCTION_ACCOUNT_RUNTIME_INVALID/);
 }
});

test('disabled production and existing nonproduction runtimes do not require the new production package',async()=>{
 for(const env of [{CENTRAL_RUNTIME_PROFILE:'production-v1'},
  {MEMBER_ONBOARDING_RUNTIME:'central',USER_DELETION_RUNTIME:'central'},{}]){
  const ready=createProductionAccountReadiness({env,pool:{},assertSchema:async()=>{throw Error('unexpected schema operation');}});
  await ready();
 }
});

test('production composition includes the account lifecycle gate in database readiness',()=>{
 const composition=fs.readFileSync(path.join(__dirname,'../src/productionComposition.js'),'utf8');
 assert.match(composition,/require\('\.\/platformOnboarding\/productionReadiness'\)\.createProductionAccountReadiness\(\{env,pool:centralPool\}\)/);
 assert.match(composition,/assertDatabaseReadiness:async\(\)=>\{[^\n]*await readyAccountLifecycle\(\)/);
});
