'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
test('matching exposes the dedicated projection boundary without changing the public helpers',()=>{
 const matching=require('../src/organizationDirectory/matching'),projection=require('../src/organizationDirectory/matchingProjection');
 assert.equal(matching.projectMatchOpportunity,projection.projectMatchOpportunity);
 assert.equal(matching.currentForMatching,projection.currentForMatching);
 const opportunity={title:'Synthetic',lifecycleState:'ACTIVE',closingDate:'2027-12-31'};
 const result=projection.projectMatchOpportunity(opportunity,{origin:'CENTRAL',opportunityId:'synthetic',asOf:'2026-11-09T00:00:00.000Z'});
 assert.equal(result.href,'/catalogo/synthetic');assert.equal(projection.currentForMatching(result,'2026-11-09'),true);
});
