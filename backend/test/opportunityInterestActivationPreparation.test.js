'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {args,status,grantPlan,readonly,target}=require('../scripts/localPlatform/prepareOpportunityInterests');
const org=randomUUID(),row=profile=>({organization_id:org,membership_id:randomUUID(),base_role_code:profile,membership_version:2,authorization_version:3,eligible:true,grants:[],policy_version:'existing',assurance_requirements:{mfa:false}});
test('preparation selects a frozen canonical manifest accepting the exact historical baseline',()=>{
 const {baselineManifest}=require('../scripts/localPlatform/prepareOpportunityInterests');
 const {validateTenantLedger}=require('../src/security/tenantMigrationManifest');
 const rows=require('./fixtures/tenant030HistoricalLedger.json');
 const entries=baselineManifest('030_organization_notices');
 assert.ok(Object.isFrozen(entries));
 assert.equal(validateTenantLedger(rows,entries).currentVersion,'030_organization_notices');
});
test('preparation refuses execution, missing flags and alternate targets',()=>{
 for(const input of [[],['--apply'],['--prepare','--apply'],['--prepare','postgres://other']])assert.throws(()=>args(input));args(['--prepare']);
 assert.throws(()=>target({host:'elsewhere',port:5432,user:'synthetic',password:'synthetic',centralDatabase:'c4g_central_dev',tenantDatabase:'c4g_tenant_dev'},{}));
});
test('a failed preflight always blocks activation, even when the physical schema is known',()=>{
 assert.equal(status({passed:false},[]),'PREPARED_BASELINE_BLOCKED');
 assert.equal(status({passed:false},[31,32,33]),'PREPARED_BASELINE_BLOCKED');
 assert.equal(status({passed:true},[31,32,33]),'PREPARED_DEPENDENCIES_IDENTIFIED');
 assert.equal(status({passed:true},[33]),'PREPARED_NOT_APPLIED');
});
test('grant plan adds only profile-specific interest permissions and preserves unrelated grants',()=>{
 for(const [profile,count] of [['ORG_ADMIN',3],['FUNDING_MANAGER',3],['CONTRIBUTOR',2],['VIEWER',1]]){
  const member=row(profile);member.grants=[{permission:'application.read',scope:{type:'RESOURCE',id:randomUUID(),organizationId:org}}];const before=structuredClone(member);
  const plan=grantPlan(member,org);assert.equal(plan.addPermissions.length,count);assert.ok(plan.addPermissions.every(p=>p.startsWith('opportunity_interest.')));assert.deepEqual(member,before);
  member.grants.push(...plan.addPermissions.map(permission=>({permission,scope:{type:'ORGANIZATION',id:org,organizationId:org}})));
  assert.deepEqual(grantPlan(member,org).addPermissions,[]);
 }
});
test('inactive, foreign, missing authority and excessive existing interest grants never gain inferred access',()=>{
 const inactive={...row('VIEWER'),eligible:false};assert.deepEqual(grantPlan(inactive,org).addPermissions,[]);
 assert.throws(()=>grantPlan(row('ORG_ADMIN'),randomUUID()));assert.throws(()=>grantPlan({...row('VIEWER'),grants:null},org));
 assert.throws(()=>grantPlan({...row('VIEWER'),grants:[{permission:'opportunity_interest.manage'}]},org),/REQUIRES_REVIEW/);
 assert.throws(()=>grantPlan(row('PLATFORM_ADMIN'),org),/PROFILE_REQUIRES_REVIEW/);
});
test('preparation transactions are read-only and always rolled back, including on read failure',async()=>{
 for(const fails of [false,true]){const calls=[],client={query:async sql=>{calls.push(sql);return {rows:[]}},release:()=>calls.push('release')};
  const result=readonly({connect:async()=>client},async()=>{if(fails)throw Error('READ_FAILED');return 7});
  if(fails)await assert.rejects(result,/READ_FAILED/);else assert.equal(await result,7);
  assert.deepEqual(calls,['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','ROLLBACK','release']);
 }
});
