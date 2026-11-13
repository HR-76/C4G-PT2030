'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {command}=require('../src/applications/contracts');
const {parse}=require('../src/applications/browse');
const {validateProductionAuthorizationBootstrap}=require('../src/authorization/productionAuthorization');
const {grantsForProfile}=require('../src/organizationDirectory/accessProfiles');
const base=()=>({origin:'CENTRAL',centralRevisionId:randomUUID(),opportunityId:randomUUID(),evaluationId:null,title:'Projeto',responsibleMembershipId:randomUUID(),deadline:'2026-12-31',idempotencyKey:randomUUID()});
test('interest conversion is explicit and preserves absent keys in old intentions',()=>{
 const old=base();assert.deepEqual(command('create',old),old);
 const sourceInterestId=randomUUID(),unitIds=[randomUUID(),randomUUID()].sort();
 assert.deepEqual(command('create',{...old,sourceInterestId,sourceInterestRevision:2,unitIds,includeResponsibleInTeam:true}),{...old,sourceInterestId,sourceInterestRevision:2,unitIds,includeResponsibleInTeam:true});
 for(const extra of [{sourceInterestId},{sourceInterestRevision:2},{sourceInterestId,sourceInterestRevision:0},{unitIds:[unitIds[0],unitIds[0]]},{unitIds:[randomUUID(),'foreign']},{includeResponsibleInTeam:'true'}])assert.throws(()=>command('create',{...old,...extra}),{code:'INVALID_INPUT'});
 const {origin,centralRevisionId,...privateInput}=old;
 assert.throws(()=>command('create',{...privateInput,sourceInterestId,sourceInterestRevision:2,unitIds:[]}),{code:'INVALID_INPUT'});
});
test('application units are optional in edits and exact in browse filters',()=>{
 const old={title:'Projeto',responsibleMembershipId:randomUUID(),deadline:'2026-12-31',expectedRevision:2,idempotencyKey:randomUUID()};
 assert.deepEqual(command('edit',old),old);
 assert.deepEqual(command('edit',{...old,unitIds:[]}).unitIds,[]);
 assert.throws(()=>command('edit',{...old,sourceInterestId:randomUUID()}),{code:'INVALID_INPUT'});
 assert.equal(parse({unitId:'NONE'}).unitId,'NONE');
 const id=randomUUID();assert.equal(parse({unitId:id}).unitId,id);
 assert.throws(()=>parse({unitId:'all'}),{code:'INVALID_INPUT'});
 assert.equal(Object.hasOwn(parse({}),'unitId'),false);
});
test('interest permissions are distinct and install least privilege for each profile',()=>{
 const catalogs=validateProductionAuthorizationBootstrap(),org=randomUUID();
 for(const action of ['read','register','manage'])assert.equal(catalogs.permissionCatalog.resolve('opportunity_interest.'+action).sensitive,false);
 assert.equal(catalogs.operationCatalog.resolve('OPPORTUNITY_INTEREST_REGISTER').resourceType,'OPPORTUNITY_INTEREST');
 const perms=profileCode=>grantsForProfile({organizationId:org,profileCode}).map(g=>g.permission);
 for(const p of ['ORG_ADMIN','FUNDING_MANAGER'])for(const op of ['read','register','manage'])assert.ok(perms(p).includes('opportunity_interest.'+op));
 // 12/11/2026: the Técnico may manage interests and start applications; the rest of the management set stays out.
 for(const p of ['opportunity_interest.register','opportunity_interest.manage','application.create'])assert.ok(perms('CONTRIBUTOR').includes(p),p);
 assert.ok(!perms('CONTRIBUTOR').includes('opportunity.read'),'source reads stay derived from the team');
 for(const p of ['organization_directory.read','organization_directory.edit','organization_membership.manage','opportunity.private.create','opportunity.archive','application.transition'])assert.ok(!perms('CONTRIBUTOR').includes(p),p);
 assert.ok(!perms('VIEWER').includes('opportunity_interest.manage')&&!perms('VIEWER').includes('application.create'));
 assert.ok(perms('VIEWER').includes('opportunity_interest.read'));
 assert.ok(!perms('VIEWER').includes('opportunity_interest.register'));
});

test('the navigation policy is decided by the backend: partners, calendar and the dashboard variant per profile',()=>{
 const {navigationFor}=require('../src/organizationDirectory/accessProfiles');
 assert.deepEqual(navigationFor('CONTRIBUTOR'),{partners:false,calendar:false,dashboard:'TECHNICIAN'});
 assert.deepEqual(navigationFor('ORG_ADMIN'),{partners:true,calendar:true,dashboard:'ORGANIZATION'});
 for(const profile of ['FUNDING_MANAGER','VIEWER'])assert.deepEqual(navigationFor(profile),{partners:true,calendar:false,dashboard:'ORGANIZATION'});
 assert.equal(navigationFor('UNKNOWN'),null);
});
