'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {mergeGrants,updateSnapshot}=require('../scripts/interest-activation.cjs');
const org='11111111-1111-4111-8111-111111111111';
function fixture(){const row={organization_id:org,membership_id:'member',base_role_code:'ORG_ADMIN',membership_version:1,authorization_version:5,eligible:true,
 grants:[{permission:'application.read',scope:{type:'ORGANIZATION',id:org,organizationId:org}}],policy_version:'policy',assurance_requirements:{mfa:false}};
 const expected={membershipId:'member',profile:'ORG_ADMIN',membershipVersion:1,authorizationVersion:5,addPermissions:['opportunity_interest.read','opportunity_interest.register','opportunity_interest.manage'],authorityDigest:createHash('sha256').update(JSON.stringify({grants:row.grants,policy:row.policy_version,assurance:row.assurance_requirements})).digest('hex')};return {row,expected};}
test('activation appends exactly the planned grants and replays without duplicates',()=>{
 const {row,expected}=fixture(),before=structuredClone(row),merged=mergeGrants(row,expected,org);
 assert.deepEqual(row,before);assert.equal(merged.length,4);assert.deepEqual(merged[0],row.grants[0]);
 assert.deepEqual(mergeGrants({...row,authorization_version:6,grants:merged},expected,org),merged);
});
test('activation rejects authority, membership, profile, validity and version drift',()=>{
 for(const patch of [{eligible:false},{base_role_code:'VIEWER'},{membership_version:2},{authorization_version:7},{policy_version:'changed'},{assurance_requirements:{mfa:true}},{grants:[]},{organization_id:'foreign'}]){
  const {row,expected}=fixture();assert.throws(()=>mergeGrants({...row,...patch},expected,org));
 }
});
test('private snapshot update preserves identity, credentials and unrelated fields',()=>{
 const value={tenantId:'tenant',credentialRef:'opaque',other:{keep:true},schema:{currentVersion:'030'}};
 const updated=updateSnapshot(value,{currentVersion:'033'});assert.equal(value.schema.currentVersion,'030');
 assert.deepEqual({...updated,schema:value.schema},value);
});
