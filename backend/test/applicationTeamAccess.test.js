'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createTeamAccessPolicy}=require('../src/applications/teamAccess');
const {createTaxonomyAuthorization}=require('../src/authorization/resourceAuthorization');
const {validateProductionAuthorizationBootstrap}=require('../src/authorization/productionAuthorization');
const {resource}=require('../src/applications/repository');
function fixture(profileCode='CONTRIBUTOR'){
 const org=randomUUID(),app=randomUUID(),other=randomUUID(),source=randomUUID(),evaluation=randomUUID(),member=randomUUID(),id=randomUUID();
 const catalogs=validateProductionAuthorizationBootstrap(),events=[];
 const actor={type:'HUMAN',id,organizationId:org,membershipId:member,membershipVersion:1,authorizationVersion:1};
 const membership={id:member,globalUserId:id,organizationId:org,status:'ACTIVE',membershipVersion:1};
 const snapshot={organizationId:org,membershipVersion:1,authorizationVersion:1,profileCode,grants:[],sodRules:[],supportGrant:null};
 let active=true,broken=false,queries=0;
 const policy=createTeamAccessPolicy({operationCatalog:catalogs.operationCatalog,currentClient(expected){assert.equal(expected,org);return {async query(sql,params){queries++;if(broken)throw Error('DB_DOWN');assert.equal(params[0],org);assert.equal(params[1],member);return {rows:active&&[app,source,evaluation,undefined].includes(params[2])?[{exists:1}]:[]}}}}});
 const auth=createTaxonomyAuthorization({catalogs,exactResourceScope:false,snapshotForResource:policy,
  membershipPort:{async revalidate(){return membership}},authorizationDataPort:{async load(){return snapshot}},authorizationAuditPort:{async accept(e){events.push(e);return 'ACCEPTED'}},
  assurancePolicyVersion:'test',recentMfaRequirement:{mfa:false,maxAgeSeconds:300},clock:{now:()=>new Date()}});
 const read=(operationCode,target=app,type='APPLICATION')=>auth.authorize(operationCode,{actor,correlationId:randomUUID(),assuranceEvidence:{authTime:Date.now()/1000,acr:'test',amr:[]}},resource(target,org,type));
 const grant=permission=>({permission,scope:{type:'ORGANIZATION',id:org,organizationId:org}});
 return {org,app,other,source,evaluation,snapshot,membership,actor,auth,events,read,grant,queries:()=>queries,remove:()=>{active=false},restore:()=>{active=true},break:()=>{broken=true}};
}
test('team membership derives only application read and collection access, with no stored grants',async()=>{
 const f=fixture();assert.equal((await f.read('APPLICATION_READ',f.org)).allowed,true);
 for(const op of ['APPLICATION_READ','APPLICATION_WORK_READ','APPLICATION_DOCUMENT_READ'])assert.equal((await f.read(op)).allowed,true);
 for(const op of ['APPLICATION_EDIT','APPLICATION_WORK_EDIT','APPLICATION_TRANSITION','APPLICATION_REVIEW_DECIDE'])assert.equal((await f.read(op)).allowed,false);
 assert.equal((await f.read('APPLICATION_READ',f.other)).allowed,false);assert.deepEqual(f.snapshot.grants,[]);
 assert(f.events.some(e=>e.result==='ALLOW'));assert(f.events.some(e=>e.result==='DENY'));
});
test('broad old application grants cannot escape the current team, including writes',async()=>{
 const f=fixture();f.snapshot.grants=['application.read','application.edit','application.transition'].map(f.grant);
 assert.equal((await f.read('APPLICATION_EDIT')).allowed,true);
 assert.equal((await f.read('APPLICATION_EDIT',f.other)).allowed,false);
 assert.equal((await f.read('APPLICATION_TRANSITION',f.other)).allowed,false);
 f.remove();assert.equal((await f.read('APPLICATION_READ')).allowed,false);assert.equal((await f.read('APPLICATION_EDIT')).allowed,false);
 assert.equal(f.snapshot.grants.length,3);f.restore();assert.equal((await f.read('APPLICATION_READ')).allowed,true);
});
test('active technicians can read and send chat messages without editing the application',async()=>{
 const f=fixture();
 assert.equal((await f.read('APPLICATION_CHAT_READ')).allowed,true);
 assert.equal((await f.read('APPLICATION_CHAT_SEND')).allowed,true);
 assert.equal((await f.read('APPLICATION_WORK_EDIT')).allowed,false);
 assert.equal((await f.read('APPLICATION_CHAT_SEND',f.other)).allowed,false);
 f.remove();
 assert.equal((await f.read('APPLICATION_CHAT_READ')).allowed,false);
 assert.equal((await f.read('APPLICATION_CHAT_SEND')).allowed,false);
});
test('source dependencies are derived only for references in the active team; documents stay separate',async()=>{
 const f=fixture();assert.equal((await f.read('OPPORTUNITY_READ',f.source,'OPPORTUNITY')).allowed,true);
 assert.equal((await f.read('F14_PREQUALIFICATION_READ',f.evaluation,'PREQUALIFICATION_EVALUATION')).allowed,true);
 assert.equal((await f.read('OPPORTUNITY_READ',f.org,'OPPORTUNITY')).allowed,true);
 assert.equal((await f.read('OPPORTUNITY_READ',f.other,'OPPORTUNITY')).allowed,false);
 assert.equal((await f.read('DOCUMENT_READ',f.other,'DOCUMENT')).allowed,false);
 f.remove();assert.equal((await f.read('OPPORTUNITY_READ',f.source,'OPPORTUNITY')).allowed,false);
});
test('a technician who may start applications reads opportunities at organization level without opening individual ones',async()=>{
 const f=fixture();f.remove();f.snapshot.grants=[f.grant('application.create')];
 assert.equal((await f.read('OPPORTUNITY_READ',f.org,'OPPORTUNITY')).allowed,true);
 assert.equal((await f.read('OPPORTUNITY_READ',f.other,'OPPORTUNITY')).allowed,false);
 assert.equal((await f.read('APPLICATION_READ',f.other)).allowed,false);
 const without=fixture();without.remove();assert.equal((await without.read('OPPORTUNITY_READ',without.org,'OPPORTUNITY')).allowed,false);
 for(const scope of [{type:'RESOURCE',id:f.app,organizationId:f.org},{type:'ORGANIZATION',id:f.org,organizationId:randomUUID()}]){
  const scoped=fixture();scoped.remove();scoped.snapshot.grants=[{permission:'application.create',scope}];
  assert.equal((await scoped.read('OPPORTUNITY_READ',scoped.org,'OPPORTUNITY')).allowed,false);
 }
});
test('non-technician profiles retain explicit grants and do not query participation',async()=>{
 for(const profile of ['ORG_ADMIN','FUNDING_MANAGER','VIEWER']){const f=fixture(profile);f.snapshot.grants=[f.grant('application.read')];f.remove();assert.equal((await f.read('APPLICATION_READ',f.other)).allowed,true);assert.equal(f.queries(),0)}
});
test('central suspension, stale authority, wrong tenant and failed team query fail closed',async()=>{
 const f=fixture();f.membership.status='SUSPENDED';assert.equal((await f.read('APPLICATION_READ')).allowed,false);assert.equal(f.queries(),0);
 f.membership.status='ACTIVE';f.snapshot.authorizationVersion=2;assert.equal((await f.read('APPLICATION_READ')).allowed,false);
 f.snapshot.authorizationVersion=1;const otherOrg=randomUUID();assert.equal((await f.auth.authorize('APPLICATION_READ',{actor:f.actor,correlationId:randomUUID(),assuranceEvidence:null},resource(f.app,otherOrg))).allowed,false);
 f.break();assert.equal((await f.read('APPLICATION_READ')).allowed,false);
});
