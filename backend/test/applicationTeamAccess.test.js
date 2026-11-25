'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createTeamAccessPolicy,applicantOpportunityReadPolicy}=require('../src/applications/teamAccess');
const {createTaxonomyAuthorization}=require('../src/authorization/resourceAuthorization');
const {validateProductionAuthorizationBootstrap}=require('../src/authorization/productionAuthorization');
const {resource}=require('../src/applications/repository');
function fixture(profileCode='CONTRIBUTOR'){
 const org=randomUUID(),app=randomUUID(),other=randomUUID(),source=randomUUID(),evaluation=randomUUID(),member=randomUUID(),id=randomUUID();
 const catalogs=validateProductionAuthorizationBootstrap(),events=[];
 const actor={type:'HUMAN',id,organizationId:org,membershipId:member,membershipVersion:1,authorizationVersion:1};
 const membership={id:member,globalUserId:id,organizationId:org,status:'ACTIVE',membershipVersion:1};
 const snapshot={organizationId:org,membershipVersion:1,authorizationVersion:1,profileCode,grants:[],sodRules:[],supportGrant:null};
 let active=true,broken=false,queries=0;const created=new Set();
 const policy=createTeamAccessPolicy({operationCatalog:catalogs.operationCatalog,currentClient(expected){assert.equal(expected,org);return {async query(sql,params){queries++;if(broken)throw Error('DB_DOWN');assert.equal(params[0],org);if(sql.includes('created_by')){assert.equal(params[2],id);return {rows:active&&created.has(params[1])?[{exists:1}]:[]}}assert.equal(params[1],member);return {rows:active&&[app,source,evaluation,undefined].includes(params[2])?[{exists:1}]:[]}}}}});
 const auth=createTaxonomyAuthorization({catalogs,exactResourceScope:false,snapshotForResource:policy,
  membershipPort:{async revalidate(){return membership}},authorizationDataPort:{async load(){return snapshot}},authorizationAuditPort:{async accept(e){events.push(e);return 'ACCEPTED'}},
  assurancePolicyVersion:'test',recentMfaRequirement:{mfa:false,maxAgeSeconds:300},clock:{now:()=>new Date()}});
 const read=(operationCode,target=app,type='APPLICATION')=>auth.authorize(operationCode,{actor,correlationId:randomUUID(),assuranceEvidence:{authTime:Date.now()/1000,acr:'test',amr:[]}},resource(target,org,type));
 const grant=permission=>({permission,scope:{type:'ORGANIZATION',id:org,organizationId:org}});
 return {org,app,other,source,evaluation,snapshot,membership,actor,auth,events,read,grant,created,queries:()=>queries,remove:()=>{active=false},restore:()=>{active=true},break:()=>{broken=true}};
}
test('team membership reads applications and writes them; review decisions stay with managers',async()=>{
 const f=fixture();assert.equal((await f.read('APPLICATION_READ',f.org)).allowed,true);
 for(const op of ['APPLICATION_READ','APPLICATION_WORK_READ','APPLICATION_DOCUMENT_READ'])assert.equal((await f.read(op)).allowed,true);
 for(const op of ['APPLICATION_EDIT','APPLICATION_WORK_EDIT','APPLICATION_TRANSITION','APPLICATION_DOCUMENT_EDIT'])assert.equal((await f.read(op)).allowed,true);
 assert.equal((await f.read('APPLICATION_REVIEW_DECIDE')).allowed,false);
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
test('active technicians can read and send chat messages; review decisions stay with managers',async()=>{
 const f=fixture();
 assert.equal((await f.read('APPLICATION_CHAT_READ')).allowed,true);
 assert.equal((await f.read('APPLICATION_CHAT_SEND')).allowed,true);
 assert.equal((await f.read('APPLICATION_REVIEW_DECIDE')).allowed,false);
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

test('the interest module derives the same organization-level opportunity read for applicants, without a database',async()=>{
 const org=randomUUID(),actor={type:'HUMAN',organizationId:org},root={id:org,organizationId:org,resourceType:'OPPORTUNITY'};
 const grant=(permission,extra={})=>({permission,scope:{type:'ORGANIZATION',id:org,organizationId:org},...extra});
 const policy=(profileCode,grants,resource=root,operationCode='OPPORTUNITY_READ',who=actor)=>applicantOpportunityReadPolicy({actor:who,snapshot:{organizationId:org,profileCode,grants},resource,operationCode});
 const derived=policy('CONTRIBUTOR',[grant('application.create')]);
 assert.ok(derived.grants.some(g=>g.permission==='opportunity.read'&&g.resourceId===org&&g.scope.type==='ORGANIZATION'));
 const unchanged=[policy('CONTRIBUTOR',[]),policy('CONTRIBUTOR',[grant('application.create')],{...root,id:randomUUID()}),
  policy('CONTRIBUTOR',[grant('application.create')],root,'OPPORTUNITY_INTEREST_READ'),policy('CONTRIBUTOR',[grant('application.create')],{...root,resourceType:'APPLICATION'}),
  policy('CONTRIBUTOR',[grant('application.create',{resourceId:randomUUID()})]),policy('CONTRIBUTOR',[grant('application.create')],root,'OPPORTUNITY_READ',{...actor,type:'SERVICE'}),
  policy('VIEWER',[grant('application.create')])];
 for(const snapshot of unchanged)assert.ok(!snapshot.grants.some(g=>g.permission==='opportunity.read'));
});
test('the interest authorizer installs the applicant read policy',()=>{
 assert.match(require('node:fs').readFileSync(require.resolve('../src/opportunityInterests/composition'),'utf8'),/snapshotForResource:\s*applicantOpportunityReadPolicy/);
});
test('a participating technician runs the application: data, team, tasks, state and documents, never the review decision',async()=>{
 const f=fixture();
 for(const op of ['APPLICATION_EDIT','APPLICATION_WORK_EDIT','APPLICATION_TRANSITION','APPLICATION_DOCUMENT_EDIT'])assert.equal((await f.read(op)).allowed,true);
 assert.equal((await f.read('APPLICATION_REVIEW_DECIDE')).allowed,false);
 assert.equal((await f.read('APPLICATION_EDIT',f.other)).allowed,false);
 f.remove();
 for(const op of ['APPLICATION_EDIT','APPLICATION_TRANSITION'])assert.equal((await f.read(op)).allowed,false);
 f.restore();assert.equal((await f.read('APPLICATION_TRANSITION')).allowed,true);
 assert.deepEqual(f.snapshot.grants,[]);
});
test('a technician outside the team cannot write to an application of the same organization',async()=>{
 const f=fixture();
 for(const op of ['APPLICATION_EDIT','APPLICATION_WORK_EDIT','APPLICATION_TRANSITION'])assert.equal((await f.read(op,f.other)).allowed,false);
});
