'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const contracts=require('../src/organizationalProfile/authoringContracts');
const {createPreparedAuthoringService,OPS}=require('../src/organizationalProfile/authoringService');
const {createProductionCatalogs}=require('../src/authorization/catalogs');
const {createAuthoringTelemetry}=require('../src/organizationalProfile/authoringTelemetry');
const create=()=>({draftId:randomUUID(),scopeId:null,items:[],idempotencyKey:randomUUID()});
test('authoring commands are closed, immutable and accept no caller authority',()=>{
 const valid=contracts.validateCreate(create());assert.ok(Object.isFrozen(valid));
 for(const key of ['actor','membershipId','organizationId','scopeType','correlationId','assurance','resourceId'])
  assert.throws(()=>contracts.validateCreate({...create(),[key]:randomUUID()}));
 assert.throws(()=>contracts.validateCreate(Object.assign(Object.create({}),create())));
 assert.throws(()=>contracts.validateEdit({draftId:randomUUID(),expectedRevision:0,items:[],idempotencyKey:randomUUID()}));
 assert.throws(()=>contracts.validateCreate({...create(),items:[{itemId:randomUUID(),itemVersionId:randomUUID(),domain:'TERRITORY',knowledgeStatus:'UNKNOWN',conceptId:null}]}));
 assert.throws(()=>contracts.validateCreate({...create(),items:[{itemId:randomUUID(),itemVersionId:randomUUID(),domain:'THEMATIC_AREA',knowledgeStatus:'KNOWN',conceptId:null}]}));
});
test('authoring uses three explicit F5 operations and keeps profile bundles empty',()=>{
 const c=createProductionCatalogs({catalogVersion:'f13'});for(const code of Object.values(OPS))assert.ok(c.operationCatalog.resolve(code));
 assert.ok(c.profileCatalog.profiles.every(p=>p.permissions.length===0));
});
test('prepared authoring service rejects raw clients before SQL or authorization',async()=>{
 let sql=0,authorization=0;const context={organizationId:randomUUID()},contexts=new WeakMap([[context,{}]]);
 const service=createPreparedAuthoringService({contexts,protectAuthorization(){authorization++;}});
 await assert.rejects(()=>service.execute({query(){sql++;}},'createDraft',create(),context));assert.equal(sql,0);assert.equal(authorization,0);
});
test('authoring F10 emits only closed operation and outcome labels',async()=>{
 const records=[],telemetry=createAuthoringTelemetry({metrics:{record(...r){records.push(r);}}});
 await telemetry.observe('profile.draft.create',async()=>({draftId:randomUUID()}));
 assert.deepEqual(records[0][2],{operation:'profile.draft.create',resultClass:'success'});
 await assert.rejects(()=>telemetry.observe(randomUUID(),async()=>{}));
});
test('authoring rejects accessors and revision overflow without executing caller code',()=>{
 let calls=0;const list=[];Object.defineProperty(list,'0',{get(){calls++;return{};},enumerable:true});
 assert.throws(()=>contracts.validateCreate({...create(),items:list}));assert.equal(calls,0);
 assert.throws(()=>contracts.validateCreate({...create(),draftId:{toString(){calls++;return randomUUID();}}}));assert.equal(calls,0);
 assert.throws(()=>contracts.validateSubmit({draftId:randomUUID(),expectedRevision:Number.MAX_SAFE_INTEGER,idempotencyKey:randomUUID()}));
});
test('authoring migration pins source, schema and exact compatibility without promoting full F13',()=>{
 const {manifest,migrationSql}=require('../src/security/tenantMigrationManifest'),entry=manifest[8];
 assert.equal(entry.version,'008_f13_profile_authoring_and_assertions');assert.equal(migrationSql(entry.version,'up').checksum,entry.sqlChecksum);
 assert.ok(entry.capabilities.includes('F13_PROFILE_AUTHORING'));assert.ok(!entry.capabilities.includes('F13_ORGANIZATIONAL_PROFILE'));
 assert.deepEqual(entry.compatibility.writeVersions,[entry.version]);
 assert.ok(migrationSql(entry.version,'down').sql.includes('F13_AUTHORING_008_DOWN_REFUSES_DATA_LOSS'));
});
test('authoring intentions separate organization, operation and content without identity authority',()=>{
 const {createAuthoringRepository}=require('../src/organizationalProfile/authoringRepository');
 const repo=organizationId=>createAuthoringRepository({organizationId,auditWriter:{append(){}}});
 const a=repo(randomUUID()),b=repo(randomUUID()),cmd=create();
 assert.notEqual(a.intention('createDraft',cmd).digest,b.intention('createDraft',cmd).digest);
 assert.notEqual(a.intention('editDraft',{...cmd,expectedRevision:1}).digest,a.intention('submitDraft',{...cmd,expectedRevision:1}).digest);
 assert.equal(a.intention('createDraft',cmd).digest,a.intention('createDraft',{...cmd,actor:{id:randomUUID()}}).digest);
});
