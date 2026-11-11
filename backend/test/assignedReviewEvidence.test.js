'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createAssignedReviewEvidence}=require('../src/applications/assignedReviewEvidence');
const {createPolicyEngine}=require('../src/authorization/policyEngine');
const {createProductionCatalogs}=require('../src/authorization/catalogs');
const org='10000000-0000-4000-8000-000000000001', subject='20000000-0000-4000-8000-000000000002', member='30000000-0000-4000-8000-000000000003';
const app='40000000-0000-4000-8000-000000000004', doc='50000000-0000-4000-8000-000000000005', opportunity='60000000-0000-4000-8000-000000000006';
function fixture(denied,stale=false){
 const checks=[],epochs={POLICY:'1',[`ORG:${org}`]:'1',[`SUBJECT:${subject}`]:'1',[`MEMBER:${member}`]:'1'};
 const membership={id:member,globalUserId:subject,organizationId:org,status:'ACTIVE',membershipVersion:1,validUntil:Infinity};
 const snapshot={organizationId:org,membershipVersion:1,authorizationVersion:2,grants:[]};
 const evidence=createAssignedReviewEvidence({coordinator:{withAuthority:fn=>fn(),snapshotEpochs:async()=>epochs,validateEpochs:async value=>{assert.deepEqual(value,epochs);if(stale)throw Error('AUTHORITY_STALE')}},
  load:async()=>({membership,snapshot}),evaluate:(operation,target)=>{checks.push([operation,target.id]);return {allowed:operation!==denied}},
  versions:{policyVersion:'policy',permissionCatalogVersion:'permissions',operationCatalogVersion:'operations'},now:()=>1000});
 const input={requester:{id:'70000000-0000-4000-8000-000000000007',organizationId:org},subjectId:subject,membershipId:member,
  application:{id:app,organizationId:org,resourceType:'APPLICATION'},opportunity:{id:opportunity,organizationId:org,resourceType:'OPPORTUNITY'},documents:[{id:doc,organizationId:org,resourceType:'DOCUMENT'}],intentionDigest:'a'.repeat(64)};
 return {evidence,input,checks,membership,snapshot};
}
test('binds current reviewer authority and all required resources to the request',async()=>{
 const f=fixture();const result=await f.evidence(f.input);
 assert.equal(result.subjectId,subject);assert.equal(result.membershipId,member);assert.equal(result.applicationId,app);assert.equal(result.intentionDigest,'a'.repeat(64));assert.equal(result.validUntil,null);
 assert.deepEqual(f.checks,[['APPLICATION_READ',app],['APPLICATION_REVIEW_DECIDE',app],['DOCUMENT_READ',doc],['OPPORTUNITY_READ',opportunity]]);
});
test('refuses missing authority, self assignment and changed epochs',async()=>{
 const f=fixture('DOCUMENT_READ');await assert.rejects(f.evidence(f.input),/REVIEWER_NOT_ELIGIBLE/);
 const g=fixture();await assert.rejects(g.evidence({...g.input,requester:{id:subject,organizationId:org}}),/REVIEWER_NOT_ELIGIBLE/);
 const h=fixture();h.membership.status='SUSPENDED';await assert.rejects(h.evidence(h.input),/REVIEWER_NOT_ELIGIBLE/);
 const stale=fixture(null,true);await assert.rejects(stale.evidence(stale.input),/AUTHORITY_STALE/);
});
test('production policy rejects a missing exact document grant',async()=>{
 const catalogs=createProductionCatalogs({catalogVersion:'f13'});
 const policy=createPolicyEngine({permissionCatalog:catalogs.permissionCatalog,profileCatalog:catalogs.profileCatalog,assurancePolicyVersion:'policy',recentMfaRequirement:{}});
 const f=fixture();
 f.snapshot.profileCode='CONTRIBUTOR';f.snapshot.sodRules=[];
 f.snapshot.grants=['application.read','application.review.decide','opportunity.read','document.read'].map(permission=>({permission,scope:{type:'ORGANIZATION',id:org,organizationId:org}}));
 const epochs={POLICY:'1',[`ORG:${org}`]:'1',[`SUBJECT:${subject}`]:'1',[`MEMBER:${member}`]:'1'};
 const evidence=createAssignedReviewEvidence({coordinator:{withAuthority:fn=>fn(),snapshotEpochs:async()=>epochs,validateEpochs:async()=>{}},
  load:async()=>({membership:f.membership,snapshot:f.snapshot}),
  evaluate:(code,target,context)=>policy.evaluate({...context,operation:catalogs.operationCatalog.resolve(code),resource:{...target,status:'ACTIVE'},now:new Date(context.now),assuranceEvidence:null}),
  versions:{policyVersion:'policy',permissionCatalogVersion:'permissions',operationCatalogVersion:'operations'},now:()=>1000});
 await evidence(f.input);
 f.snapshot.grants=f.snapshot.grants.filter(grant=>grant.permission!=='document.read');
 await assert.rejects(evidence(f.input),/REVIEWER_NOT_ELIGIBLE/);
});
