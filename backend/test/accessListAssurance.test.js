'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createProductionCatalogs}=require('../src/authorization/catalogs');
const {createTaxonomyAuthorization}=require('../src/authorization/resourceAuthorization');
const {accessSnapshot}=require('../src/organizationDirectory/accessProfiles');
const {resource}=require('../src/organizationDirectory/repository');
const {RECOGNIZED_ASSURANCE_POLICIES:policies}=require('../src/security/authConfig');
const f=require('./support/f5AuthorizationFixtures');
const now=new Date('2030-01-15T12:00:00Z'),version='c4g-user-mfa-v1';
async function authorize(operationCode,{profileCode='ORG_ADMIN',organizationId=f.ORGANIZATION_A,status='ACTIVE',membershipVersion=3}={}){
 const port=createTaxonomyAuthorization({catalogs:createProductionCatalogs({catalogVersion:'f13'}),exactResourceScope:false,snapshotForResource:accessSnapshot,
  membershipPort:{async revalidate(){return f.membership({globalUserId:f.ACTOR_ID,membershipVersion,status})}},
  authorizationDataPort:{async load(){return f.snapshot({profileCode,grants:[]})}},
  authorizationAuditPort:{async accept(){return 'ACCEPTED'}},assurancePolicyVersion:version,
  recentMfaRequirement:policies[version].policy['recent-auth'],clock:{now:()=>now}});
 return port.authorize(operationCode,{actor:f.actor(),correlationId:'access-list-regression',
  assuranceEvidence:{authTime:now.getTime()/1000-600,acr:'c4g-loa1',amr:['pwd'],policyVersion:version}},resource(organizationId));
}
test('eligible access readers retain a valid session after recent authentication expires',async()=>{
 for(const profileCode of ['ORG_ADMIN','FUNDING_MANAGER'])assert.equal((await authorize('ORGANIZATION_MEMBERSHIP_READ',{profileCode})).allowed,true);
});
test('access mutations still require recent authentication',async()=>{
 const decision=await authorize('ORGANIZATION_MEMBERSHIP_MANAGE');
 assert.equal(decision.allowed,false);assert.equal(decision.reasonCode,'AUTH_EVIDENCE_EXPIRED');
});
test('access read rejects other profiles, foreign organizations, revoked and stale memberships',async()=>{
 for(const change of [{profileCode:'CONTRIBUTOR'},{profileCode:'VIEWER'},{organizationId:f.ORGANIZATION_B},{status:'SUSPENDED'},{membershipVersion:4}])
  assert.equal((await authorize('ORGANIZATION_MEMBERSHIP_READ',change)).allowed,false);
});
