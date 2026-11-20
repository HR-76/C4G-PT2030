'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {parse}=require('../src/organizationDirectory/contracts');
const {validateProductionAuthorizationBootstrap}=require('../src/authorization/productionAuthorization');
const person=()=>({idempotencyKey:randomUUID(),name:'Pessoa C4G',email:'',functionLabel:'',active:true,unitIds:[],primaryUnitId:null});
test('directory accepts admitted document schemas without bypassing tenant or capability checks',()=>{
 const {DIRECTORY_SCHEMA_VERSIONS}=require('../src/organizationDirectory/composition');
 const {snapshotEligible}=require('../src/security/tenantResolver');
 const {validSnapshot}=require('./support/tenantRuntimeDoubles');
 const operation={workload:'API',compatibleSchemaVersions:DIRECTORY_SCHEMA_VERSIONS,allowedCompatibilityStates:['COMPATIBLE'],requiredCapabilities:['ORGANIZATION_DIRECTORY']};
 const snapshot=structuredClone(validSnapshot());
 const policy={allows:()=>true};
 for(const version of ['031_application_document_transport','032_document_worker_runtime']){
  snapshot.schema.currentVersion=version;snapshot.schema.verifiedCapabilities.ORGANIZATION_DIRECTORY=true;
  assert.equal(snapshotEligible(snapshot,snapshot.organizationId,operation,policy),true);
  assert.equal(snapshotEligible(snapshot,randomUUID(),operation,policy),false);
  snapshot.schema.verifiedCapabilities.ORGANIZATION_DIRECTORY=false;
  assert.equal(snapshotEligible(snapshot,snapshot.organizationId,operation,policy),false);
 }
 snapshot.schema.verifiedCapabilities.ORGANIZATION_DIRECTORY=true;snapshot.schema.currentVersion='033_unknown';
 assert.equal(snapshotEligible(snapshot,snapshot.organizationId,operation,policy),false);
});
test('strategy migration preserves directory and chat compatibility only with verified schema evidence',()=>{
 const {organizationStrategyManifest,APPLICATION_CHAT_SCHEMA_VERSION}=require('../src/security/tenantMigrationManifest');
 const {DIRECTORY_SCHEMA_VERSIONS}=require('../src/organizationDirectory/composition');
 const {snapshotEligible}=require('../src/security/tenantResolver');
 const {validSnapshot}=require('./support/tenantRuntimeDoubles');
 const entry=organizationStrategyManifest.at(-1),snapshot=structuredClone(validSnapshot());
 snapshot.schema.currentVersion=entry.version;
 snapshot.schema.schemaFingerprint=entry.schemaFingerprint;
 snapshot.schema.verifiedCapabilities=Object.fromEntries(entry.capabilities.map(code=>[code,true]));
 const policy={allows:()=>true};
 const directory={workload:'API',compatibleSchemaVersions:DIRECTORY_SCHEMA_VERSIONS,allowedCompatibilityStates:['COMPATIBLE'],requiredCapabilities:['ORGANIZATION_DIRECTORY']};
 const chat={...directory,compatibleSchemaVersions:[APPLICATION_CHAT_SCHEMA_VERSION],requiredCapabilities:['APPLICATION_TEAM_CHAT']};
 for(const operation of [directory,chat])assert(snapshotEligible(snapshot,snapshot.organizationId,operation,policy));
 snapshot.schema.verifiedCapabilities.ORGANIZATION_STRATEGY=false;
 assert.equal(snapshotEligible(snapshot,snapshot.organizationId,directory,policy),false);
});
test('people are not accounts and do not accept caller-supplied authority',()=>{
 assert.equal(parse('personCreate',person()).name,'Pessoa C4G');for(const key of ['organizationId','actor','membershipId','role','permissions'])assert.throws(()=>parse('personCreate',{...person(),[key]:randomUUID()}),{code:'INVALID_INPUT'});
});
test('unit affiliations require a unique list and an exact primary',()=>{
 const unit=randomUUID();assert.throws(()=>parse('personCreate',{...person(),unitIds:[unit]}));
 assert.throws(()=>parse('personCreate',{...person(),unitIds:[unit,unit],primaryUnitId:unit}));
 assert.deepEqual(parse('personCreate',{...person(),unitIds:[unit],primaryUnitId:unit}).unitIds,[unit]);
 assert.throws(()=>parse('personCreate',{...person(),unitIds:Array.from({length:51},randomUUID)}));
});
test('profile URLs cannot inject scripts or credentials and revisions are strict',()=>{
 const input={idempotencyKey:randomUUID(),description:'Descrição',email:'',website:'',expectedRevision:0};
 assert.equal(parse('profileEdit',input).expectedRevision,0);
 for(const website of ['javascript:alert(1)','file:///c:/secret','https://user:pass@example.com'])assert.throws(()=>parse('profileEdit',{...input,website}));
 for(const expectedRevision of ['1',-1,1.5])assert.throws(()=>parse('profileEdit',{...input,expectedRevision}));
});
test('organization strategy validates dated objectives and binds them to selected areas',()=>{
 const {areas}=require('../src/organizationDirectory/thematicAreas');
 const selected=areas[0].id,unselected=areas[1].id;
 const objective={id:randomUUID(),title:'Dois pilotos',target:'2',deadline:'2028-02-29',areaIds:[selected]};
 const input={idempotencyKey:randomUUID(),expectedRevision:0,areaIds:[selected],interests:['Telemonitorização'],objectives:[objective]};
 assert.deepEqual(parse('strategyEdit',input).objectives,[objective]);
 assert.throws(()=>parse('strategyEdit',{...input,organizationId:randomUUID()}),{code:'INVALID_INPUT'});
 for(const change of [{deadline:'2027-02-29'},{areaIds:[unselected]},{title:' '}]){
  assert.throws(()=>parse('strategyEdit',{...input,objectives:[{...objective,...change}]}),{code:'INVALID_INPUT'});
 }
});
test('scope contract and labels keep the existing limits',()=>{
 const unit={idempotencyKey:randomUUID(),label:'Departamento',parentScopeId:null,stableCode:'DEP_1'};
 assert.equal(parse('unitCreate',unit).stableCode,'DEP_1');assert.throws(()=>parse('unitCreate',{...unit,stableCode:'novo código'}));
 assert.throws(()=>parse('unitCreate',{...unit,label:'  nome'}));assert.throws(()=>parse('personCreate',{...person(),name:'pessoa\nsegunda'}));
});
test('directory access uses explicit grants and does not grant permissions by role',()=>{
 const c=validateProductionAuthorizationBootstrap();assert(c.permissionCatalog.resolve('organization_directory.edit'));
 assert(c.profileCatalog.profiles.every(p=>p.permissions.length===0));assert.deepEqual(c.permissionCatalog.resolve('organization_directory.read').scopes,['ORGANIZATION']);
 assert(c.permissionCatalog.resolve('organizational_scope.rename').scopes.includes('ORGANIZATION'));
});

test('directory units belong to the active organization root and cannot be moved',()=>{
 const input={idempotencyKey:randomUUID(),label:'Departamento',parentScopeId:null,stableCode:null};
 assert.equal(parse('unitCreate',input).parentScopeId,null);
 assert.throws(()=>parse('unitCreate',{...input,parentScopeId:randomUUID()}),{code:'INVALID_INPUT'});
 assert.throws(()=>parse('unitCreate',{...input,organizationId:randomUUID()}),{code:'INVALID_INPUT'});
 for(const parentScopeId of [null,randomUUID()])assert.throws(()=>parse('unitMove',{idempotencyKey:randomUUID(),expectedRevision:1,parentScopeId}),{code:'INVALID_INPUT'});
 assert.equal(parse('unitRename',{idempotencyKey:randomUUID(),expectedRevision:1,label:'Nome novo'}).label,'Nome novo');
});
test('organization strategy accepts application links on objectives and refuses malformed ones',()=>{
 const {areas}=require('../src/organizationDirectory/thematicAreas');
 const first=randomUUID(),second=randomUUID(),linked=[first,second].sort();
 const objective={id:randomUUID(),title:'Dois pilotos',target:'',deadline:null,areaIds:[]};
 const input={idempotencyKey:randomUUID(),expectedRevision:1,areaIds:[areas[0].id],interests:[],objectives:[objective]};
 assert.equal(Object.hasOwn(parse('strategyEdit',input).objectives[0],'applicationIds'),false);
 assert.deepEqual(parse('strategyEdit',{...input,objectives:[{...objective,applicationIds:[...linked].reverse()}]}).objectives[0].applicationIds,linked);
 for(const applicationIds of [[first,first],['candidatura'],first,null,Array.from({length:201},()=>randomUUID())]){
  assert.throws(()=>parse('strategyEdit',{...input,objectives:[{...objective,applicationIds}]}),{code:'INVALID_INPUT'});
 }
});
test('a strategy edit without application links keeps the links already stored',async()=>{
 const {createDirectoryRepository}=require('../src/organizationDirectory/repository');
 const org=randomUUID(),kept=randomUUID(),replaced=randomUUID(),application=randomUUID(),other=randomUUID();
 let saved;
 const client={query:async(sql,params)=>{
  if(sql.includes('directory_receipt')&&sql.startsWith('SELECT'))return {rows:[]};
  if(sql.includes('FOR UPDATE'))return {rows:[{revision:3,strategy:{areaIds:[],interests:[],objectives:[
   {id:kept,title:'A',target:'',deadline:null,areaIds:[],applicationIds:[application]},
   {id:replaced,title:'B',target:'',deadline:null,areaIds:[],applicationIds:[application]}]}}]};
  if(sql.includes('SET strategy')){saved=params[1];return {rows:[{strategy:saved,revision:4}]};}
  return {rows:[]};
 }};
 const repository=createDirectoryRepository({organizationId:org,actor:{id:randomUUID()},authorize:async()=>true,protect:async()=>{},
  audit:async()=>{},supportsStrategy:true});
 const added=randomUUID();
 const input=parse('strategyEdit',{idempotencyKey:randomUUID(),expectedRevision:3,areaIds:[],interests:[],objectives:[
  {id:kept,title:'A',target:'',deadline:null,areaIds:[]},
  {id:replaced,title:'B',target:'',deadline:null,areaIds:[],applicationIds:[other]},
  {id:added,title:'C',target:'',deadline:null,areaIds:[]}]});
 const result=await repository.strategyEdit(client,input);
 assert.equal(result.revision,4);
 assert.deepEqual(saved.objectives.map(objective=>objective.applicationIds),[[application],[other],[]]);
});
test('department profile validates interests and objectives bound to the department areas',()=>{
 const {areas}=require('../src/organizationDirectory/thematicAreas');
 const first=areas[0].id,second=areas[1].id,strategic=[randomUUID(),randomUUID()].sort();
 const objective={id:randomUUID(),title:'Formar a equipa',target:'10 pessoas',deadline:'2027-06-30',areaIds:[first],objectiveIds:[...strategic].reverse()};
 const input={idempotencyKey:randomUUID(),expectedRevision:2,areaIds:[first],objectives:[objective]};
 assert.deepEqual(parse('departmentProfileEdit',input).objectives,[{...objective,objectiveIds:strategic}]);
 assert.deepEqual(parse('departmentProfileEdit',{...input,objectives:[{...objective,objectiveIds:[]}]}).objectives[0].objectiveIds,[]);
 for(const change of [{areaIds:[second]},{title:''},{deadline:'2027-02-30'},{objectiveIds:[strategic[0],strategic[0]]},{objectiveIds:['x']},{objectiveIds:undefined},{applicationIds:[]}]){
  assert.throws(()=>parse('departmentProfileEdit',{...input,objectives:[{...objective,...change}]}),{code:'INVALID_INPUT'});
 }
 assert.throws(()=>parse('departmentProfileEdit',{...input,unitId:randomUUID()}),{code:'INVALID_INPUT'});
 assert.throws(()=>parse('departmentProfileEdit',{...input,objectives:Array.from({length:21},()=>({...objective,id:randomUUID()}))}),{code:'INVALID_INPUT'});
});
function strategyFixture(strategy,{unit={lifecycle:'ACTIVE'},revision=3,supportsStrategy=true}={}){
 const {createDirectoryRepository}=require('../src/organizationDirectory/repository');
 const org=randomUUID(),calls=[];let saved=null;
 const client={query:async(sql,params)=>{
  calls.push(sql);
  if(sql.includes('directory_receipt')&&sql.startsWith('SELECT'))return {rows:[]};
  if(sql.includes('organizational_scope.scope'))return {rows:unit?[unit]:[]};
  if(sql.includes('FOR UPDATE'))return {rows:[{revision,strategy}]};
  if(sql.includes('SET strategy')){saved=params[1];return {rows:[{strategy:saved,revision:revision+1}]};}
  return {rows:[]};
 }};
 const repository=createDirectoryRepository({organizationId:org,actor:{id:randomUUID()},authorize:async()=>true,protect:async()=>{},audit:async()=>{},supportsStrategy});
 return {org,client,calls,repository,saved:()=>saved};
}
test('a department profile is stored inside the strategy and checked against it',async()=>{
 const {areas}=require('../src/organizationDirectory/thematicAreas');
 const strategicArea=areas[0].id,other=areas[1].id,goal=randomUUID(),unitId=randomUUID(),otherUnit=randomUUID();
 const strategy={areaIds:[strategicArea],interests:['Energia'],objectives:[{id:goal,title:'Meta',target:'',deadline:null,areaIds:[],applicationIds:[]}],
  units:{[otherUnit]:{areaIds:[strategicArea],objectives:[]}}};
 const objective={id:randomUUID(),title:'Formar',target:'',deadline:null,areaIds:[other],objectiveIds:[goal]};
 const body=(change={})=>parse('departmentProfileEdit',{idempotencyKey:randomUUID(),expectedRevision:3,areaIds:[strategicArea,other],objectives:[objective],...change});
 const f=strategyFixture(strategy);
 const result=await f.repository.departmentProfileEdit(f.client,body(),unitId);
 assert.equal(result.revision,4);
 assert.deepEqual(f.saved(),{...strategy,units:{[otherUnit]:strategy.units[otherUnit],[unitId]:{areaIds:[strategicArea,other].sort(),objectives:[objective]}}});
 await assert.rejects(f.repository.departmentProfileEdit(f.client,body({areaIds:[other],objectives:[]}),unitId),{code:'STRATEGIC_AREA_REQUIRED'});
 await assert.rejects(f.repository.departmentProfileEdit(f.client,body({objectives:[{...objective,objectiveIds:[randomUUID()]}]}),unitId),{code:'STRATEGIC_OBJECTIVE_UNAVAILABLE'});
 await assert.rejects(f.repository.departmentProfileEdit(f.client,body({expectedRevision:2}),unitId),{code:'STALE_REVISION'});
 const open=strategyFixture({...strategy,areaIds:[]});
 await open.repository.departmentProfileEdit(open.client,body({areaIds:[other],objectives:[]}),unitId);
 assert.deepEqual(open.saved().units[unitId],{areaIds:[other],objectives:[]});
 for(const [options,code] of [[{unit:null},'RESOURCE_NOT_AVAILABLE'],[{unit:{lifecycle:'ARCHIVED'}},'UNIT_UNAVAILABLE'],[{supportsStrategy:false},'RESOURCE_NOT_AVAILABLE']]){
  const refused=strategyFixture(strategy,options);
  await assert.rejects(refused.repository.departmentProfileEdit(refused.client,body(),unitId),{code});
  assert.equal(refused.saved(),null);
 }
});
test('editing the entity strategy keeps department profiles and drops only links to removed objectives',async()=>{
 const keptGoal=randomUUID(),removedGoal=randomUUID(),unitId=randomUUID(),area=require('../src/organizationDirectory/thematicAreas').areas[0].id;
 const goal=id=>({id,title:'Meta',target:'',deadline:null,areaIds:[]});
 const department={areaIds:[area],objectives:[{id:randomUUID(),title:'Formar',target:'',deadline:null,areaIds:[area],objectiveIds:[keptGoal,removedGoal]}]};
 const f=strategyFixture({areaIds:[area],interests:[],objectives:[goal(keptGoal),goal(removedGoal)],units:{[unitId]:department}});
 await f.repository.strategyEdit(f.client,parse('strategyEdit',{idempotencyKey:randomUUID(),expectedRevision:3,areaIds:[],interests:[],objectives:[goal(keptGoal)]}));
 assert.deepEqual(f.saved().units,{[unitId]:{areaIds:[area],objectives:[{...department.objectives[0],objectiveIds:[keptGoal]}]}});
});
test('the personal read brings the objectives of the person\'s active departments and only the titles of the strategy they support',async()=>{
 const {createDirectoryRepository}=require('../src/organizationDirectory/repository');
 const org=randomUUID(),personId=randomUUID(),active=randomUUID(),archived=randomUUID(),empty=randomUUID(),goal=randomUUID(),gone=randomUUID();
 const objective={id:randomUUID(),title:'Formar a equipa',target:'10 pessoas',deadline:'2027-06-30',areaIds:['a'],objectiveIds:[goal,gone]};
 const strategy={areaIds:['a'],interests:['Reservado'],objectives:[{id:goal,title:'Qualificar',target:'Reservada',deadline:null,areaIds:[],applicationIds:[randomUUID()]}],
  units:{[active]:{areaIds:['a','b'],objectives:[objective]},[archived]:{areaIds:['a'],objectives:[objective]}}};
 const client={query:async sql=>{
  if(sql.includes('FROM organizational_scope.person_profile WHERE organization_id=$1 AND membership_id'))return {rows:[{person_id:personId}]};
  if(sql.includes('FROM organizational_scope.person WHERE'))return {rows:[{name:'Pessoa',email:'',function_label:'',active:true}]};
  if(sql.includes('person_unit'))return {rows:[{scopeId:active,label:'Informática',isPrimary:true,lifecycle:'ACTIVE'},{scopeId:archived,label:'Antiga',isPrimary:false,lifecycle:'ARCHIVED'},{scopeId:empty,label:'Nova',isPrimary:false,lifecycle:'ACTIVE'}]};
  if(sql.includes('organization_card'))return {rows:[{strategy}]};
  return {rows:[]};
 }};
 const build=supportsStrategy=>createDirectoryRepository({organizationId:org,actor:{id:randomUUID(),membershipId:randomUUID()},authorize:async()=>false,protect:async()=>{},audit:async()=>{},supportsStrategy});
 const result=await build(true).self(client);
 assert.deepEqual(result.units,[{scopeId:active,label:'Informática',isPrimary:true},{scopeId:archived,label:'Antiga',isPrimary:false},{scopeId:empty,label:'Nova',isPrimary:false}]);
 assert.deepEqual(result.departments,[
  {scopeId:active,label:'Informática',isPrimary:true,areaIds:['a','b'],objectives:[{id:objective.id,title:'Formar a equipa',target:'10 pessoas',deadline:'2027-06-30',areaIds:['a'],strategicObjectives:[{id:goal,title:'Qualificar'}]}]},
  {scopeId:empty,label:'Nova',isPrimary:false,areaIds:[],objectives:[]}]);
 assert.equal(JSON.stringify(result.departments).includes('Reservad'),false);
 assert.equal(Object.hasOwn(await build(false).self(client),'departments'),false);
});
