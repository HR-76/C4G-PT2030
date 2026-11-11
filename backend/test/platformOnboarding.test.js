'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {input,token,view}=require('../src/platformOnboarding/contracts');
test('onboarding rejects credential role and database configuration injection',()=>{
 const value={requestId:randomUUID(),name:'Entity',legalName:'Entity Legal',slug:'entity',type:'COMPANY',country:'PT',currency:'EUR',adminName:'Person',adminEmail:'PERSON@example.invalid'};
 assert.equal(input(value).adminEmail,'person@example.invalid');
 for(const field of ['password','profileCode','databaseRef','credentialRef','issuer','subject','organizationId','expectedSubject'])assert.throws(()=>input({...value,[field]:'injected'}),/ONBOARDING_INPUT_INVALID/);
 for(const field of ['country','currency','legalName']){const incomplete={...value};delete incomplete[field];assert.throws(()=>input(incomplete),/ONBOARDING_INPUT_INVALID/);}
});
test('activation secrets require full entropy encoding and never appear in metadata',()=>{
 assert.throws(()=>token('short'),/ACTIVATION_INVALID/);assert.throws(()=>token({digest:'a'.repeat(64)}),/ACTIVATION_INVALID/);
 const secret='a'.repeat(64);assert.notEqual(token(secret),secret);
 assert.deepEqual(view({id:'id',organization_id:'org',phase:'READY',status:'WAITING',revision:'2',input:{password:secret},receipt:{subject:secret},digest:secret}),{id:'id',organizationId:'org',phase:'READY',status:'WAITING',revision:2,errorCode:null});
});
test('onboarding requires a genuine authority coordinator and explicit middleware composition',()=>{
 assert.throws(()=>require('../src/platformOnboarding/service').createOnboardingService({coordinator:{write(){}}}),/ONBOARDING_COMPOSITION_INVALID/);
 assert.throws(()=>require('../src/routes/platformOnboardingRoutes').createPlatformOnboardingRoutes({service:{}}),/composition is incomplete/);
});
