'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createTransitionCapability}=require('../src/applications/browseAuthority');
const {validateProductionAuthorizationBootstrap}=require('../src/authorization/productionAuthorization');
const {resource}=require('../src/applications/repository');
function fixture(){
 const org=randomUUID(),id=randomUUID(),member=randomUUID(),allowed=randomUUID(),other=randomUUID(),now=new Date();let current=true,reads=0;
 const context={actor:{type:'HUMAN',id,organizationId:org,membershipId:member,membershipVersion:1,authorizationVersion:1},assuranceEvidence:null};
 const membership={id:member,globalUserId:id,organizationId:org,membershipVersion:1,status:'ACTIVE',validUntil:Infinity};
 const snapshot={organizationId:org,membershipVersion:1,authorizationVersion:1,profileCode:'ORG_ADMIN',grants:[{permission:'application.transition',resourceId:allowed,resourceType:'APPLICATION',scope:{type:'ORGANIZATION',id:org,organizationId:org}}],sodRules:[],supportGrant:null};
 const check=createTransitionCapability({catalogs:validateProductionAuthorizationBootstrap(),policyVersion:'test-policy',recentMfaRequirement:{mfa:false,maxAgeSeconds:300,acceptedAcr:[],acceptedAmr:[],amrMode:'all'},data:{membershipPort:{async revalidate(){reads++;return membership}},authorizationDataPort:{async load(){reads++;return snapshot}}},context,assertCurrent(){if(!current)throw Error('STALE_GUARD')},clock:{now:()=>now}});
 return{org,allowed,other,check,membership,snapshot,expire:()=>{current=false},reads:()=>reads};
}
test('transition capability respects exact grant bindings and never survives the request guard',async()=>{
 const f=fixture();assert.equal(await f.check(resource(f.allowed,f.org)),true);assert.equal(await f.check(resource(f.other,f.org)),false);assert.equal(f.reads(),2);
 assert.equal(await f.check(resource(f.allowed,randomUUID())),false);assert.equal(await f.check(resource(f.allowed,f.org,'OPPORTUNITY')),false);
 f.expire();await assert.rejects(f.check(resource(f.allowed,f.org)),/STALE_GUARD/);
});
test('transition capability rejects expired membership and changed authority versions',async()=>{
 const f=fixture();f.membership.validUntil=0;assert.equal(await f.check(resource(f.allowed,f.org)),false);
 const g=fixture();g.snapshot.authorizationVersion=2;assert.equal(await g.check(resource(g.allowed,g.org)),false);
});
test('detail capabilities evaluate their own permission without turning UI checks into commands',async()=>{
 const f=fixture(),target=resource(f.allowed,f.org);
 assert.equal(await f.check(target,'APPLICATION_EDIT'),false);
 f.snapshot.grants.push({...f.snapshot.grants[0],permission:'application.edit'});
 assert.equal(await f.check(target,'APPLICATION_EDIT'),true);
 assert.equal(await f.check(resource(f.other,f.org),'APPLICATION_EDIT'),false);
 assert.equal(await f.check(target,'APPLICATION_WORK_EDIT'),true);
 assert.equal(await f.check(target,'APPLICATION_DOCUMENT_EDIT'),true);
 assert.equal(await f.check(target,'APPLICATION_REVIEW_DECIDE'),false);
 assert.equal(await f.check(target,'APPLICATION_READ'),false);
 f.expire();await assert.rejects(f.check(target,'APPLICATION_EDIT'),/STALE_GUARD/);
});
