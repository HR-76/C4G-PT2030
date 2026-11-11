'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createIdentityRepository}=require('../src/security/identityRepository');
const {createAuthorityCoordinator}=require('../src/security/authorityCoordinator');
test('identity cannot be composed with a generic/admin SQL pool',()=>{
  assert.throws(()=>createIdentityRepository({query(){}}),/authority coordinator required/);
});
test('missing validated OIDC identity does not consult authority',async()=>{
  let calls=0;
  const coordinator=createAuthorityCoordinator({pool:{query(){calls++;throw Error('unexpected');},connect(){calls++;throw Error('unexpected');}},permitSecret:'synthetic-test-only-not-a-deployed-secret'});
  const repo=createIdentityRepository(coordinator);
  for(const claims of [null,{}, {iss:'x'}, {iss:'x',sub:''}, {iss:17,sub:'y'}])assert.equal(await repo.resolve(claims),null);
  assert.equal(calls,0);
});
test('identity operations cannot be replaced by arbitrary SQL at the protocol boundary',async()=>{
  const protocol=require('../src/security/authorityProtocolQueries');let calls=0;
  await assert.rejects(()=>protocol.execute({query(){calls++;}},'SELECT * FROM public.auth_identity_ref'),e=>e.code==='42501');
  assert.equal(calls,0);
});
