'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {compileReadAuthority,createReadAuthority}=require('../src/applications/readAuthority');
const {validateProductionAuthorizationBootstrap}=require('../src/authorization/productionAuthorization');
const {id}=require('./support/httpSqlFixture');
function fixture(profileCode='VIEWER'){
 const org=id(100),member=id(101),user=id(102),catalogs=validateProductionAuthorizationBootstrap();
 return {catalogs,policyVersion:'p',recentMfaRequirement:{mfa:false,maxAgeSeconds:300,acceptedAcr:[],acceptedAmr:[],amrMode:'all'},
  context:{actor:{type:'HUMAN',id:user,organizationId:org,membershipId:member,membershipVersion:1,authorizationVersion:1}},
  membership:{id:member,globalUserId:user,organizationId:org,status:'ACTIVE',membershipVersion:1,validUntil:Infinity},
  snapshot:{organizationId:org,membershipVersion:1,authorizationVersion:1,profileCode,grants:[],sodRules:[],supportGrant:null},now:new Date()};
}
test('SQL read authority preserves exact resource bindings and never turns unit/team grants into global access',()=>{
 const f=fixture(),org=f.context.actor.organizationId;
 f.snapshot.grants=[{permission:'application.read',resourceId:id(1),resourceType:'APPLICATION',scope:{type:'ORGANIZATION',id:org,organizationId:org}},
  {permission:'opportunity.read',scope:{type:'RESOURCE',id:id(2),organizationId:org}},
  {permission:'application.read',scope:{type:'UNIT',id:id(3),organizationId:org}}];
 const result=compileReadAuthority(f);assert.equal(result.application.all,false);assert.deepEqual(result.application.ids,[id(1)]);
 assert.equal(result.opportunity.all,false);assert.deepEqual(result.opportunity.ids,[id(2)]);assert.equal(result.teamOnly,false);
});
test('technicians require participation even with broad old grants and sources derive only from visible rows',()=>{
 const f=fixture('CONTRIBUTOR');f.snapshot.grants=[{permission:'application.read',scope:{type:'ORGANIZATION',id:f.snapshot.organizationId,organizationId:f.snapshot.organizationId}}];
 const result=compileReadAuthority(f);assert.equal(result.teamOnly,true);assert.equal(result.membershipId,f.membership.id);
 assert(result.application.all&&result.opportunity.all&&result.evaluation.all);
});
test('expired, suspended, stale and cross-tenant membership never broaden SQL visibility',()=>{
 for(const mutate of [f=>f.membership.validUntil=0,f=>f.snapshot.authorizationVersion++,f=>f.membership.globalUserId=id(300)]){
  const f=fixture();mutate(f);assert.throws(()=>compileReadAuthority(f),{code:'SERVICE_UNAVAILABLE'});
 }
 for(const mutate of [f=>f.membership.status='SUSPENDED',f=>f.membership.organizationId=id(300)]){
  const f=fixture();mutate(f);const result=compileReadAuthority(f);assert.equal(result.application.all,false);assert.deepEqual(result.application.ids,[]);
 }
});
test('authority data is loaded in one batch and is unusable after guard revocation',async()=>{
 const f=fixture();let reads=0,current=true;
 const read=createReadAuthority({...f,clock:{now:()=>f.now},data:{membershipPort:{revalidate:async()=>{reads++;return f.membership;}},authorizationDataPort:{load:async()=>{reads++;return f.snapshot;}}},assertCurrent(){if(!current)throw Error('revoked');}});
 await read();await read();assert.equal(reads,2);current=false;await assert.rejects(read(),/revoked/);
});
test('compiled selectors agree with the existing audited resource policy for profiles, scoped grants and team membership',async()=>{
 const {createTaxonomyAuthorization}=require('../src/authorization/resourceAuthorization');
 const {createTeamAccessPolicy}=require('../src/applications/teamAccess');
 const {resource}=require('../src/applications/repository');
 for(const profile of ['ORG_ADMIN','FUNDING_MANAGER','VIEWER','CONTRIBUTOR']){
  const f=fixture(profile),org=f.context.actor.organizationId,participating=id(1),source=id(2),evaluation=id(3);
  f.snapshot.grants=[{permission:'application.read',resourceId:participating,scope:{type:'ORGANIZATION',id:org,organizationId:org}},
   {permission:'opportunity.read',resourceType:'OPPORTUNITY',scope:{type:'RESOURCE',id:source,organizationId:org}},
   {permission:'prequalification.read',resourceId:evaluation,scope:{type:'ORGANIZATION',id:org,organizationId:org}}];
  const compiled=compileReadAuthority(f);
  const auth=createTaxonomyAuthorization({catalogs:f.catalogs,assurancePolicyVersion:f.policyVersion,recentMfaRequirement:f.recentMfaRequirement,clock:{now:()=>f.now},exactResourceScope:false,
   membershipPort:{revalidate:async()=>f.membership},authorizationDataPort:{load:async()=>f.snapshot},authorizationAuditPort:{accept:async()=> 'ACCEPTED'},
   snapshotForResource:createTeamAccessPolicy({operationCatalog:f.catalogs.operationCatalog,currentClient:()=>({query:async(sql,params)=>({rows:[participating,source,evaluation,undefined].includes(params[2])?[{}]:[]})})})});
  for(const [code,type,key,allowedId] of [['APPLICATION_READ','APPLICATION','application',participating],['OPPORTUNITY_READ','OPPORTUNITY','opportunity',source],['F14_PREQUALIFICATION_READ','PREQUALIFICATION_EVALUATION','evaluation',evaluation]]){
   // Sources are evaluated only for an application already admitted by SQL's team EXISTS.
   for(const target of key==='application'?[allowedId,id(99)]:[allowedId]){
    const expected=await auth.authorize(code,{...f.context,correlationId:id(999)},resource(target,org,type));
    const actual=(compiled[key].all||compiled[key].ids.includes(target))&&(!compiled.teamOnly||key!=='application'||target===participating);
    assert.equal(actual,expected.allowed,`${profile} ${code} ${target}`);
   }
  }
 }
});

test('visibility and transition projections share only the protected operation snapshot',async()=>{
 const f=fixture(),org=f.context.actor.organizationId;let reads=0,groups=0,current=true;
 f.snapshot.grants=['application.read','application.transition','opportunity.read'].map(permission=>({permission,scope:{type:'ORGANIZATION',id:org,organizationId:org}}));
 const assertCurrent=()=>{if(!current)throw Error('stale')},clock={now:()=>f.now};
 const source={membershipPort:{async revalidate(){reads++;return f.membership}},authorizationDataPort:{async load(){reads++;return f.snapshot}}};
 const data=require('../src/applications/protectedAuthoritySnapshot').createProtectedAuthoritySnapshot({actor:f.context.actor,data:source,withAuthority:async work=>{groups++;return work()},assertCurrent,clock});
 const read=createReadAuthority({...f,data,clock,assertCurrent});
 const transition=require('../src/applications/browseAuthority').createTransitionCapability({...f,data,clock,assertCurrent});
 assert((await read()).application.all);assert(await transition(require('../src/applications/repository').resource(id(1),org)));
 assert.equal(reads,2);assert.equal(groups,1);current=false;
 await assert.rejects(read());await assert.rejects(transition(require('../src/applications/repository').resource(id(1),org)));
});
