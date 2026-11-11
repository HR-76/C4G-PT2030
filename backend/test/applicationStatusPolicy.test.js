'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPolicyAuthority}=require('../src/applications/statusEmails/policyAuthority');
const {resource}=require('../src/applications/repository');
function fixture(){const subject={organizationId:'org',membershipId:'member',userId:'user'};
 const membership={id:'member',globalUserId:'user',organizationId:'org',membershipVersion:1,status:'ACTIVE',validUntil:Infinity};
 const snapshot={organizationId:'org',membershipVersion:1,authorizationVersion:1,profileCode:'ORG_ADMIN',grants:[{permission:'application.read',resourceId:'app',scope:{type:'ORGANIZATION',id:'org',organizationId:'org'}}],sodRules:[],supportGrant:null};
 const check=createPolicyAuthority({catalogs:require('../src/authorization/productionAuthorization').validateProductionAuthorizationBootstrap(),policyVersion:'fixture',recentMfaRequirement:{mfa:false,maxAgeSeconds:300,acceptedAcr:[],acceptedAmr:[],amrMode:'all'},load:async()=>({membership,snapshot}),resource:async({subject,resourceId})=>resource(resourceId,subject.organizationId)});
 return {membership,snapshot,check,input:{subject,operationCode:'APPLICATION_READ',resourceId:'app',applicationId:'app'}};}
test('real policy respects exact resource binding and sees revocation without caching',async()=>{const f=fixture();assert.equal(await f.check(f.input),'ALLOW');assert.equal(await f.check({...f.input,resourceId:'other'}),'DENY');f.snapshot.grants=[];assert.equal(await f.check(f.input),'DENY');});
test('real policy rejects stale membership, expired membership and foreign identity',async()=>{for(const change of [{membershipVersion:2},{validUntil:0},{globalUserId:'other'},{organizationId:'other'},{status:'SUSPENDED'}]){const f=fixture();Object.assign(f.membership,change);assert.equal(await f.check(f.input),'DENY');}});
test('non-read operation never authorizes recipient email',async()=>{const f=fixture();assert.equal(await f.check({...f.input,operationCode:'APPLICATION_TRANSITION'}),'DENY');});
