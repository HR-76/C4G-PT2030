'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {profiles,capabilities,grantsForProfile,accessSnapshot}=require('../src/organizationDirectory/accessProfiles');
const {createProductionCatalogs}=require('../src/authorization/catalogs');
const org=randomUUID(),actor=randomUUID(),target=randomUUID();
test('closed profiles use admitted permissions and never platform authority',()=>{
 const catalogs=createProductionCatalogs({catalogVersion:'f13'});
 for(const p of profiles){const grants=grantsForProfile({organizationId:org,profileCode:p.code});
  for(const g of grants){assert(catalogs.permissionCatalog.resolve(g.permission));assert.equal(g.scope.organizationId,org);assert(!g.permission.includes('central')&&!g.permission.includes('cross_organization'));}
 }
 assert.throws(()=>grantsForProfile({organizationId:org,profileCode:'C4G_ADMIN'}),{code:'INVALID_INPUT'});
});
test('manager manages only technicians and legacy viewers; no escalation or self modification',()=>{
 for(const role of ['ORG_ADMIN','FUNDING_MANAGER'])assert.deepEqual(capabilities('FUNDING_MANAGER',actor,{membershipId:target,profileCode:role}),{canChangeStatus:false,profileOptions:[]});
 for(const role of ['CONTRIBUTOR','VIEWER']){const c=capabilities('FUNDING_MANAGER',actor,{membershipId:target,profileCode:role});assert.equal(c.canChangeStatus,role==='CONTRIBUTOR');assert.deepEqual(c.profileOptions.map(p=>p.code),['CONTRIBUTOR']);}
 for(const role of profiles.map(p=>p.code)){assert.equal(capabilities(role,actor,{membershipId:actor,profileCode:role}).canChangeStatus,false);assert.equal(capabilities('CONTRIBUTOR',actor,{membershipId:target,profileCode:role}).profileOptions.length,0)}
 assert.equal(capabilities('ORG_ADMIN',actor,{membershipId:target,profileCode:'FUNDING_MANAGER'}).profileOptions.length,3);
});
test('downgrade removes general management grants and preserves specific work',()=>{
 const scoped={permission:'application.edit',resourceId:randomUUID(),scope:{type:'ORGANIZATION',id:org,organizationId:org}};
 const before=[...grantsForProfile({organizationId:org,profileCode:'ORG_ADMIN'}),scoped];
 const after=grantsForProfile({organizationId:org,profileCode:'CONTRIBUTOR',previousProfile:'ORG_ADMIN',previousGrants:before});
 assert(after.some(g=>g.resourceId===scoped.resourceId));assert(!after.some(g=>g.permission==='organization_membership.manage'));assert(!after.some(g=>g.permission==='application.edit'&&!g.resourceId));assert.equal(before.length,grantsForProfile({organizationId:org,profileCode:'ORG_ADMIN'}).length+1);
});
test('existing technician work grant survives assignment to another fixed profile',()=>{
 const grant={permission:'application.edit',scope:{type:'ORGANIZATION',id:org,organizationId:org}};
 assert(grantsForProfile({organizationId:org,profileCode:'FUNDING_MANAGER',previousProfile:'CONTRIBUTOR',previousGrants:[grant]}).some(g=>g.permission==='application.edit'));
});
test('access authority derives only membership management for eligible local profiles',()=>{
 for(const code of ['ORG_ADMIN','FUNDING_MANAGER','CONTRIBUTOR','VIEWER']){
  const snapshot={organizationId:org,profileCode:code,grants:[]};
  assert.equal(accessSnapshot({snapshot,resource:{organizationId:org}}).grants.length,['ORG_ADMIN','FUNDING_MANAGER'].includes(code)?1:0);
  assert.equal(accessSnapshot({snapshot,resource:{organizationId:randomUUID()}}),snapshot);assert.deepEqual(snapshot.grants,[]);
 }
});
