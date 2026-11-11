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
