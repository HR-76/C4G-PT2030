'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {reviewerEligible}=require('../src/applications/assignedReviewEligibility');
const org='org-a', actor={id:'requester',organizationId:org};
const candidate={id:'reviewer',membershipId:'member-a',organizationId:org,membershipVersion:2,authorizationVersion:3};
const authority={membership:{id:'member-a',globalUserId:'reviewer',organizationId:org,status:'ACTIVE',membershipVersion:2,validUntil:2000},snapshot:{organizationId:org,membershipVersion:2,authorizationVersion:3},actor:candidate};
const allowed=()=>({allowed:true});
test('requires an active distinct reviewer and every operation on the exact resources',()=>{
 const calls=[];
 assert.equal(reviewerEligible({requester:actor,candidate:authority,application:{id:'app',organizationId:org},documents:[{id:'doc',organizationId:org}],now:1000,evaluate:(op,resource)=>{calls.push([op,resource.id]);return allowed()}}),true);
 assert.deepEqual(calls,[['APPLICATION_READ','app'],['APPLICATION_REVIEW_DECIDE','app'],['DOCUMENT_READ','doc']]);
});
test('fails closed for self review, foreign or inactive membership, or missing document permission',()=>{
 const base={requester:actor,candidate:authority,application:{id:'app',organizationId:org},documents:[{id:'doc',organizationId:org}],now:1000,evaluate:allowed};
 assert.equal(reviewerEligible({...base,requester:{...actor,id:'reviewer'}}),false);
 assert.equal(reviewerEligible({...base,candidate:{...authority,membership:{...authority.membership,organizationId:'org-b'}}}),false);
 assert.equal(reviewerEligible({...base,candidate:{...authority,membership:{...authority.membership,status:'SUSPENDED'}}}),false);
 assert.equal(reviewerEligible({...base,documents:[{id:'doc',organizationId:'org-b'}]}),false);
 assert.equal(reviewerEligible({...base,evaluate:op=>({allowed:op!=='DOCUMENT_READ'})}),false);
 assert.equal(reviewerEligible({...base,now:2000}),false);
 assert.equal(reviewerEligible({...base,candidate:{...authority,snapshot:{...authority.snapshot,authorizationVersion:4}}}),false);
 assert.equal(reviewerEligible({...base,candidate:{...authority,membership:{...authority.membership,membershipVersion:3}}}),false);
 assert.equal(reviewerEligible({...base,evaluate:()=>{throw Error('authority unavailable')}}),false);
 assert.equal(reviewerEligible({...base,documents:[]}),false);
 assert.equal(reviewerEligible({...base,candidate:{...authority,actor:{...candidate,id:'other'}}}),false);
});
test('accepts active memberships with no expiry and denies missing timestamps',()=>{
 const base={requester:actor,candidate:authority,application:{id:'app',organizationId:org},documents:[{id:'doc',organizationId:org}],now:1000,evaluate:allowed};
 assert.equal(reviewerEligible({...base,candidate:{...authority,membership:{...authority.membership,validUntil:Infinity}}}),true);
 assert.equal(reviewerEligible({...base,now:undefined}),false);
});
